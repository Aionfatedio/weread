import { WebDB } from '@/lib/indexedDB';
import { hydrateReaderAnnotations } from '@/lib/readerAnnotations';
import { hydrateReaderBookStatus } from '@/lib/readerBookStatus';
import { hydrateReaderProgress } from '@/lib/readerProgress';
import { hydrateReaderReadingTime } from '@/lib/readerReadingTime';
import { hydrateReaderSettings } from '@/lib/readerSettings';
import { terminateDBWorker } from '@/store/books';
import { migrateBookResources } from '@/lib/bookResources';

// v5 stores resources and local fonts with the book data; resource migration
// must finish before any import can replace a book.
const DATABASE_VERSION = 5;

export const db = new WebDB({ dbName: 'read', version: DATABASE_VERSION });

export const hydrateReaderData = async (): Promise<void> => {
  await Promise.all([
    hydrateReaderSettings(),
    hydrateReaderAnnotations(),
    hydrateReaderProgress(),
    hydrateReaderReadingTime(),
    hydrateReaderBookStatus(),
  ]);
};

let initialization: Promise<boolean> | null = null;

export const initDB = (): Promise<boolean> => {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const opened = await db.openDataBase();
      if (opened.error) throw new Error(opened.message);
      await migrateBookResources();
      await hydrateReaderData();
      return true;
    } catch (error) {
      console.error('Database initialization failed', error);
      closeDB();
      return false;
    }
  })().finally(() => {
    initialization = null;
  });
  return initialization;
};

export const closeDB = (): void => {
  terminateDBWorker();
  db.closeDataBase();
};

export const resumeDB = (): Promise<boolean> => {
  // Rehydrating a healthy connection could overwrite a pending optimistic save.
  return initialization ?? (db.database ? Promise.resolve(true) : initDB());
};
