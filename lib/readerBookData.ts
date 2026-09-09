import {
  CHAPTER_PAGE_COUNTS_STORE_NAME,
  READER_ANNOTATIONS_STORE_NAME,
  READER_BOOK_STATUS_STORE_NAME,
  READER_FONTS_STORE_NAME,
  READER_PROGRESS_STORE_NAME,
  READER_READING_TIME_DAILY_STORE_NAME,
  READER_READING_TIME_SEGMENTS_STORE_NAME,
  READER_SETTINGS_STORE_NAME,
} from '@/lib/readerStoreNames';
import type { BackupUserDataPayload } from '@/lib/backup/backupSchema';

// Omitted sections are untouched; null clears a single-record section.
export type ReaderBookData = Partial<BackupUserDataPayload>;

export const EMPTY_READER_BOOK_DATA: ReaderBookData = {
  annotations: [],
  bookStatus: null,
  progress: null,
  readingTimeDaily: [],
  readingTimeSegments: [],
};

export const replaceBookRecords = (
  transaction: IDBTransaction,
  storeName: string,
  bookId: string,
  records: readonly object[],
): void => {
  const store = transaction.objectStore(storeName);
  const keys = store.index('bookId').getAllKeys(IDBKeyRange.only(bookId));
  keys.onsuccess = () => {
    try {
      keys.result.forEach((key) => store.delete(key));
      // add, not put: an imported id belonging to another book must abort the
      // replacement rather than overwrite that book's annotation or segment.
      records.forEach((record) => store.add({ ...record, bookId }));
    } catch {
      transaction.abort();
    }
  };
};

export const replaceReaderBookData = (
  transaction: IDBTransaction,
  bookId: string,
  readerData: ReaderBookData,
): void => {
  replaceBookRecords(transaction, CHAPTER_PAGE_COUNTS_STORE_NAME, bookId, []);
  for (const [storeName, records] of [
    [READER_ANNOTATIONS_STORE_NAME, readerData.annotations],
    [READER_READING_TIME_DAILY_STORE_NAME, readerData.readingTimeDaily],
    [READER_READING_TIME_SEGMENTS_STORE_NAME, readerData.readingTimeSegments],
  ] as const) {
    if (records !== undefined) replaceBookRecords(transaction, storeName, bookId, records);
  }
  for (const [storeName, record] of [
    [READER_PROGRESS_STORE_NAME, readerData.progress],
    [READER_BOOK_STATUS_STORE_NAME, readerData.bookStatus],
  ] as const) {
    if (record === undefined) continue;
    const store = transaction.objectStore(storeName);
    if (record === null) store.delete(bookId);
    else store.put({ ...record, bookId });
  }
  readerData.settings?.forEach((record) => transaction.objectStore(READER_SETTINGS_STORE_NAME).put(record));
  readerData.fonts?.forEach((record) => transaction.objectStore(READER_FONTS_STORE_NAME).put(record));
};

export const READER_BOOK_DATA_STORES = [
  CHAPTER_PAGE_COUNTS_STORE_NAME,
  READER_ANNOTATIONS_STORE_NAME,
  READER_READING_TIME_DAILY_STORE_NAME,
  READER_READING_TIME_SEGMENTS_STORE_NAME,
  READER_PROGRESS_STORE_NAME,
  READER_BOOK_STATUS_STORE_NAME,
  READER_SETTINGS_STORE_NAME,
  READER_FONTS_STORE_NAME,
];
