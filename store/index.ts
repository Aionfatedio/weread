import { WebDB } from '@/lib/indexedDB';
import { hydrateReaderAnnotations } from '@/lib/readerAnnotations';
import { hydrateReaderBookStatus } from '@/lib/readerBookStatus';
import { hydrateReaderProgress } from '@/lib/readerProgress';
import { hydrateReaderReadingTime } from '@/lib/readerReadingTime';
import { hydrateReaderSettings } from '@/lib/readerSettings';
import { terminateDBWorker } from '@/store/books';

// v4: adds the per-book chapter page-count store (paged-mode pagination
// persistence). Existing stores/indexes are backfilled by onupgradeneeded.
const DATABASE_VERSION = 4;

export const db = new WebDB({ dbName: 'read', version: DATABASE_VERSION });

const hydrateReaderData = async (): Promise<void> => {
  await Promise.all([
    hydrateReaderSettings(),
    hydrateReaderAnnotations(),
    hydrateReaderProgress(),
    hydrateReaderReadingTime(),
    hydrateReaderBookStatus(),
  ]);
};

export const initDB = (): Promise<boolean> => {
  return db.openDataBase().then(async (result) => {
    if (result.status !== 'success') return false;
    await hydrateReaderData();
    return true;
  });
};
export const closeDB = (): void => {
  terminateDBWorker();
  db.closeDataBase();
};

export const resumeDB = (): Promise<boolean> => {
  // Fast path: the connection is still healthy (the common visibilitychange
  // case). Reopening + rehydrating here would race any in-flight persist —
  // writes issued during the close/reopen window fail silently, then hydrate
  // overwrites the in-memory caches with the stale on-disk values. Only
  // rebuild when the connection was actually lost (pagehide closed it, the
  // browser fired `close`, or a versionchange forced it shut).
  if (db.database) return Promise.resolve(true);
  return db
    .openDataBase()
    .then(async (result) => {
      if (result.status !== 'success') return false;
      await hydrateReaderData();
      return true;
    })
    .catch(() => false);
};
