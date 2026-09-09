import { db, hydrateReaderData } from '@/store/index';
import { clearChapterPaginationCache, clearPersistedChapterPageCountCache } from '@/lib/chapterPagination';
import type { ReaderBookData } from '@/lib/readerBookData';
import { releaseBookResourceUrls } from '@/lib/bookResources';
import { BOOKS_INFO_STORE_NAME } from '@/lib/readerStoreNames';
import { createRandomId, getErrorMessage, sha256Hex } from '@/lib/utils';
import type { BookResourceRecord } from '@/lib/bookResources';
import type { IDBResult } from '@/lib/indexedDB';
import type { ReaderBookDocument, ReaderBookSourceType } from '@/lib/readerDocument';

export interface BookSummary {
  id: string;
  title: string;
  author: string;
  image: string;
  sourceType: ReaderBookSourceType;
  fingerprint?: string;
  createTime?: number;
  modifyTime?: number;
}

export interface BookInfo extends BookSummary {
  document: ReaderBookDocument;
}

export interface SearchResult extends BookSummary {
  matchedText: string[];
}

const FINGERPRINT_SAMPLE_SIZE = 4096;

const PENDING_OPERATION_TIMEOUT_MS = 60_000;

export const BOOK_STORE_RESULT_REASON = {
  BOOK_ALREADY_EXISTS: 'book-already-exists',
} as const;

export type BookStoreResultReason = (typeof BOOK_STORE_RESULT_REASON)[keyof typeof BOOK_STORE_RESULT_REASON];

export const getBookFingerprint = async (data: {
  author: string;
  document: ReaderBookDocument;
  sourceType: ReaderBookSourceType;
  title: string;
}): Promise<string> => {
  const { author, document, sourceType, title } = data;
  const rawText = document.rawText || '';
  const sampleHead = rawText.slice(0, FINGERPRINT_SAMPLE_SIZE);
  const sampleTail = rawText.length > FINGERPRINT_SAMPLE_SIZE ? rawText.slice(-FINGERPRINT_SAMPLE_SIZE) : '';
  const seed = [sourceType, title, author, rawText.length, sampleHead, sampleTail].join('\u0000');
  return sha256Hex(seed);
};

const successResult = <T>(
  data: T,
  options: { message?: string; reason?: BookStoreResultReason } = {},
): IDBResult<T> => ({
  status: 'success',
  code: 0,
  data,
  error: false,
  message: options.message,
  reason: options.reason,
});

const errorResult = <T>(message: string, fallback?: T): IDBResult<T> => ({
  status: 'error',
  code: 1,
  data: fallback,
  error: true,
  message,
});

let dbWorker: Worker | null = null;
const pendingWorkerOperations = new Map<string, { resolve: (result: IDBResult<unknown>) => void; timer: number }>();

type WorkerResponseEnvelope<T> = IDBResult<T> & { operationId: string };

const handleWorkerMessage = (event: MessageEvent<WorkerResponseEnvelope<unknown>>): void => {
  const operationId = event.data?.operationId;
  if (!operationId) return;
  const pending = pendingWorkerOperations.get(operationId);
  if (!pending) return;
  pendingWorkerOperations.delete(operationId);
  clearTimeout(pending.timer);
  const { operationId: _operationId, ...rest } = event.data;
  pending.resolve(rest as IDBResult<unknown>);
};

const handleWorkerError = (event: ErrorEvent): void => {
  const message = event.message || 'Worker error';
  // The worker instance is broken (script failed to load, or an uncaught
  // error killed its message loop). Discard it so the next operation spawns
  // a fresh one instead of queueing 60s timeouts against a dead worker.
  resetDBWorker();
  for (const [, pending] of pendingWorkerOperations) {
    clearTimeout(pending.timer);
    pending.resolve(errorResult(message));
  }
  pendingWorkerOperations.clear();
};

const handleWorkerMessageError = (): void => {
  handleWorkerError(new ErrorEvent('messageerror', { message: 'Worker message deserialization failed' }));
};

const resetDBWorker = (): void => {
  if (dbWorker) {
    dbWorker.terminate();
    dbWorker = null;
  }
};

const getDBWorker = (): Worker => {
  if (!dbWorker) {
    dbWorker = new Worker(new URL('../workers/dbWorker.ts', import.meta.url), {
      type: 'module',
    });
    dbWorker.addEventListener('message', handleWorkerMessage);
    dbWorker.addEventListener('messageerror', handleWorkerMessageError);
    dbWorker.addEventListener('error', handleWorkerError);
  }
  return dbWorker;
};

export const terminateDBWorker = (): void => {
  resetDBWorker();
  for (const [, pending] of pendingWorkerOperations) {
    clearTimeout(pending.timer);
    pending.resolve(errorResult('Worker terminated'));
  }
  pendingWorkerOperations.clear();
};

const performWorkerOperation = <T = unknown>(
  type: string,
  data: Record<string, unknown> = {},
): Promise<IDBResult<T>> => {
  return new Promise((resolve) => {
    if (!db.database) {
      resolve(errorResult<T>('Database not initialized'));
      return;
    }

    const worker = getDBWorker();
    const operationId = createRandomId('op');

    const timer = window.setTimeout(() => {
      if (!pendingWorkerOperations.delete(operationId)) return;
      // A hung worker would stall every subsequent operation for the full
      // timeout as well; replace it so the next call starts clean.
      resetDBWorker();
      resolve(errorResult<T>('Worker operation timed out'));
    }, PENDING_OPERATION_TIMEOUT_MS);

    pendingWorkerOperations.set(operationId, {
      resolve: resolve as (result: IDBResult<unknown>) => void,
      timer,
    });

    try {
      worker.postMessage({
        type,
        data,
        dbName: db.database.name,
        storeName: BOOKS_INFO_STORE_NAME,
        operationId,
      });
    } catch (error) {
      if (!pendingWorkerOperations.delete(operationId)) return;
      clearTimeout(timer);
      resolve(errorResult<T>(getErrorMessage(error, 'Failed to dispatch worker message')));
    }
  });
};

// List and import responses carry metadata only; full documents stay in IndexedDB.
const toExistingBookResult = (existing: BookInfo): IDBResult<BookSummary> => {
  const { id, title, author, image, sourceType, fingerprint, createTime, modifyTime } = existing;
  return successResult(
    {
      id,
      title,
      author,
      image,
      sourceType,
      fingerprint,
      createTime,
      modifyTime,
    },
    { reason: BOOK_STORE_RESULT_REASON.BOOK_ALREADY_EXISTS },
  );
};

export const addBook = async (data: {
  id?: string;
  fingerprint?: string;
  title: string;
  author?: string;
  image?: string;
  document: ReaderBookDocument;
  sourceType: ReaderBookSourceType;
  resources?: BookResourceRecord[];
  overwrite?: boolean;
  readerData?: ReaderBookData;
}): Promise<IDBResult<BookSummary>> => {
  const {
    id: preferredId,
    fingerprint,
    title = '',
    author = '',
    image = '',
    document,
    sourceType,
    resources = [],
    overwrite = false,
    readerData,
  } = data;
  const computedFingerprint = fingerprint || (await getBookFingerprint({ author, document, sourceType, title }));
  const id = preferredId || computedFingerprint;

  const existing = await getBookById(id);
  if (!overwrite && !existing.error && existing.data) {
    return toExistingBookResult(existing.data);
  }

  const now = Date.now();
  const bookInfo: BookInfo = {
    id,
    title,
    author,
    image,
    document,
    sourceType,
    fingerprint: computedFingerprint,
    createTime: overwrite && !existing.error && existing.data?.createTime ? existing.data.createTime : now,
    modifyTime: now,
  };

  if (overwrite || readerData) {
    clearChapterPaginationCache(id);
    clearPersistedChapterPageCountCache(id);
  }
  const addResult = await performWorkerOperation<BookSummary>(overwrite ? 'put' : 'add', {
    bookInfo,
    resources,
    readerData,
  });
  if (addResult.error) {
    if (!overwrite && addResult.reason === BOOK_STORE_RESULT_REASON.BOOK_ALREADY_EXISTS) {
      const conflict = await getBookById(id);
      if (!conflict.error && conflict.data) return toExistingBookResult(conflict.data);
    }
    return addResult;
  }
  releaseBookResourceUrls(id);
  if (overwrite || readerData) await hydrateReaderData();
  return addResult;
};

export const searchBooksByTitle = (keyword: string): Promise<IDBResult<BookSummary[]>> => {
  return performWorkerOperation<BookSummary[]>('search', { keyword, searchType: 'title' });
};

export const searchBooksByAuthor = (keyword: string): Promise<IDBResult<BookSummary[]>> => {
  return performWorkerOperation<BookSummary[]>('search', { keyword, searchType: 'author' });
};

export const searchBooksByContent = (keyword: string): Promise<IDBResult<SearchResult[]>> => {
  return performWorkerOperation<SearchResult[]>('search', { keyword, searchType: 'content' });
};

export const getAllBooks = (): Promise<IDBResult<BookSummary[]>> => {
  return performWorkerOperation<BookSummary[]>('getAll');
};

export const getBookById = (id: string): Promise<IDBResult<BookInfo | undefined>> => {
  return performWorkerOperation<BookInfo | undefined>('get', { key: id });
};

export const restoreBookUserData = async (bookId: string, readerData: ReaderBookData): Promise<void> => {
  clearChapterPaginationCache(bookId);
  clearPersistedChapterPageCountCache(bookId);
  const restored = await performWorkerOperation<null>('restore', { bookId, readerData });
  if (restored.error) throw new Error(restored.message);
  await hydrateReaderData();
};
