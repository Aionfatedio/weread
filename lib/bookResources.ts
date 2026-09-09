import { db } from '@/store';
import { BOOK_RESOURCES_STORE_NAME, READER_SETTINGS_STORE_NAME } from '@/lib/readerStoreNames';

export interface BookResourceRecord {
  bookId: string;
  resourceKey: string;
  mediaType: string;
  blob: Blob;
  size: number;
}

const RESOURCE_DB_NAME = 'weread-book-resources';

const RESOURCE_STORE_NAME = 'resources';

const RESOURCE_MIGRATION_KEY = 'weread-book-resources-migrated';

// Cap the in-memory Blob URL cache so long reading sessions cannot leak
// unbounded amounts of memory. Evicted URLs are NOT revoked immediately —
// they're parked in `pendingRevoke` because the DOM may still reference them
// (a virtualised list, an in-flight image decode, a transition animation).
// Revocation happens lazily the next time we mint a URL, by which point the
// referencing element has almost certainly been replaced and the browser has
// finished any pending decode.
const MAX_BLOB_URL_CACHE_SIZE = 256;
const PENDING_REVOKE_BATCH_SIZE = 64;

const blobUrlCache = new Map<string, string>();
const pendingRevoke: string[] = [];
// Concurrent requests for the same key (e.g. StrictMode double-invoked
// effects) must share one mint; two independent createObjectURL calls would
// leak whichever URL loses the cache race.
const inflightUrlRequests = new Map<string, Promise<string | undefined>>();

const buildPrimaryKey = (bookId: string, resourceKey: string): string => `${bookId}\u0000${resourceKey}`;

export const migrateBookResources = async (): Promise<void> => {
  const marker = await db.readByCursor({
    storeName: READER_SETTINGS_STORE_NAME,
    keyRange: IDBKeyRange.only(RESOURCE_MIGRATION_KEY),
  });
  if (marker.error) throw new Error(marker.message);
  if (marker.data.length > 0) return;

  const databases = await indexedDB.databases();
  let records: BookResourceRecord[] = [];
  if (databases.some((database) => database.name === RESOURCE_DB_NAME)) {
    const previousDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(RESOURCE_DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      records = await new Promise<BookResourceRecord[]>((resolve, reject) => {
        const request = previousDatabase.transaction(RESOURCE_STORE_NAME).objectStore(RESOURCE_STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      previousDatabase.close();
    }
  }

  // The marker commits with the copy. A second tab or an interrupted upgrade
  // must never re-copy old resources over books imported after migration.
  await new Promise<void>((resolve, reject) => {
    const transaction = db.database!.transaction([BOOK_RESOURCES_STORE_NAME, READER_SETTINGS_STORE_NAME], 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Resource migration aborted'));
    const settings = transaction.objectStore(READER_SETTINGS_STORE_NAME);
    const request = settings.get(RESOURCE_MIGRATION_KEY);
    request.onsuccess = () => {
      if (request.result) return;
      try {
        const resources = transaction.objectStore(BOOK_RESOURCES_STORE_NAME);
        records.forEach(({ bookId, resourceKey, mediaType, blob, size }) =>
          resources.add({ bookId, resourceKey, mediaType, blob, size }),
        );
        settings.put({ key: RESOURCE_MIGRATION_KEY, value: 'true', updatedAt: Date.now() });
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
  });
  indexedDB.deleteDatabase(RESOURCE_DB_NAME);
};

export const loadBookResource = async (
  bookId: string,
  resourceKey: string,
): Promise<BookResourceRecord | undefined> => {
  try {
    return await new Promise<BookResourceRecord | undefined>((resolve) => {
      const store = db.database!.transaction(BOOK_RESOURCES_STORE_NAME).objectStore(BOOK_RESOURCES_STORE_NAME);
      const request = store.get([bookId, resourceKey]);
      request.onsuccess = () => {
        const result = request.result as BookResourceRecord | undefined;
        resolve(result || undefined);
      };
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
};

export const listBookResources = async (bookId: string): Promise<BookResourceRecord[]> => {
  const records = await db.readByCursor<BookResourceRecord>({
    storeName: BOOK_RESOURCES_STORE_NAME,
    indexName: 'bookId',
    keyRange: IDBKeyRange.only(bookId),
  });
  if (records.error) throw new Error(records.message);
  return records.data;
};

export const getBookResourceUrl = (bookId: string, resourceKey: string): Promise<string | undefined> => {
  const cacheKey = buildPrimaryKey(bookId, resourceKey);
  const cached = blobUrlCache.get(cacheKey);
  if (cached) {
    // LRU touch: re-insert so the most recently used url survives eviction.
    blobUrlCache.delete(cacheKey);
    blobUrlCache.set(cacheKey, cached);
    return Promise.resolve(cached);
  }

  const inflight = inflightUrlRequests.get(cacheKey);
  if (inflight) return inflight;

  const request = (async (): Promise<string | undefined> => {
    const record = await loadBookResource(bookId, resourceKey);
    if (!record) return undefined;
    // Drain stale URLs queued by earlier evictions before we mint a new one.
    // By now any DOM references to those URLs will have re-rendered through
    // the resolver hook and acquired a fresh URL.
    drainPendingRevocations();
    const url = URL.createObjectURL(record.blob);
    blobUrlCache.set(cacheKey, url);
    evictBlobUrlCacheIfNeeded();
    return url;
  })().finally(() => inflightUrlRequests.delete(cacheKey));
  inflightUrlRequests.set(cacheKey, request);
  return request;
};

const drainPendingRevocations = (limit: number = PENDING_REVOKE_BATCH_SIZE): void => {
  const count = Math.min(pendingRevoke.length, limit);
  for (let i = 0; i < count; i++) {
    const url = pendingRevoke.shift();
    if (url) URL.revokeObjectURL(url);
  }
};

const evictBlobUrlCacheIfNeeded = (): void => {
  while (blobUrlCache.size > MAX_BLOB_URL_CACHE_SIZE) {
    const oldestKey = blobUrlCache.keys().next();
    if (oldestKey.done) return;
    const url = blobUrlCache.get(oldestKey.value);
    if (url) pendingRevoke.push(url);
    blobUrlCache.delete(oldestKey.value);
  }
};

export const releaseBookResourceUrls = (bookId?: string): void => {
  const prefix = bookId ? `${bookId}\u0000` : undefined;
  for (const [key, url] of blobUrlCache) {
    if (!prefix || key.startsWith(prefix)) {
      // Releases are explicit (book deleted / navigated away) — safe to
      // revoke immediately; nothing should still be rendering this book.
      URL.revokeObjectURL(url);
      blobUrlCache.delete(key);
    }
  }
  if (!prefix) {
    // Drain everything pending too when releasing the whole cache.
    while (pendingRevoke.length > 0) {
      const url = pendingRevoke.shift();
      if (url) URL.revokeObjectURL(url);
    }
  }
};

export const RESOURCE_URL_SCHEME = 'weread-resource:';

export const buildResourcePlaceholderUrl = (resourceKey: string): string => {
  return `${RESOURCE_URL_SCHEME}${encodeURIComponent(resourceKey)}`;
};

export const isResourcePlaceholderUrl = (value: string): boolean => {
  return value.startsWith(RESOURCE_URL_SCHEME);
};

export const parseResourcePlaceholderKey = (value: string): string | undefined => {
  if (!isResourcePlaceholderUrl(value)) return undefined;
  try {
    return decodeURIComponent(value.slice(RESOURCE_URL_SCHEME.length));
  } catch {
    return undefined;
  }
};
