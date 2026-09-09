// 数据库：IDBDatabase 对象，数据库有版本概念，同一时刻只能有一个版本，每个域名可以建多个数据库
// 对象仓库：IDBObjectStore 对象，类似于关系型数据库的表格
// 索引：IDBIndex 对象，可以在对象仓库中，为不同的属性建立索引，主键建立默认索引
// 事务：IDBTransaction 对象，增删改查都需要通过事务来完成，事务对象提供了 error,abord,complete 三个回调方法，监听操作结果
// 操作请求：IDBRequest 对象
// 指针：IDBCursor 对象
// 主键集合：IDBKeyRange 对象，主键是默认建立索引的属性，可以取当前层级的某个属性，也可以指定下一层对象的属性，还可以是一个递增的整数

import {
  BOOKS_INFO_STORE_NAME,
  BOOK_RESOURCES_STORE_NAME,
  CHAPTER_PAGE_COUNTS_STORE_NAME,
  READER_ANNOTATIONS_STORE_NAME,
  READER_BOOK_STATUS_STORE_NAME,
  READER_FONTS_STORE_NAME,
  READER_PROGRESS_STORE_NAME,
  READER_READING_TIME_DAILY_STORE_NAME,
  READER_READING_TIME_SEGMENTS_STORE_NAME,
  READER_SETTINGS_STORE_NAME,
} from '@/lib/readerStoreNames';
import { getErrorMessage } from '@/lib/utils';

const DATABASE_STORES: Array<{
  name: string;
  options: IDBObjectStoreParameters;
  indexes?: Array<{ name: string; keyPath: string | string[]; options?: IDBIndexParameters }>;
}> = [
  { name: BOOKS_INFO_STORE_NAME, options: { keyPath: 'id' } },
  {
    name: BOOK_RESOURCES_STORE_NAME,
    options: { keyPath: ['bookId', 'resourceKey'] },
    indexes: [{ name: 'bookId', keyPath: 'bookId' }],
  },
  {
    name: READER_ANNOTATIONS_STORE_NAME,
    options: { keyPath: 'id' },
    indexes: [
      { name: 'bookId', keyPath: 'bookId' },
      { name: 'type', keyPath: 'type' },
    ],
  },
  { name: READER_PROGRESS_STORE_NAME, options: { keyPath: 'bookId' } },
  { name: READER_SETTINGS_STORE_NAME, options: { keyPath: 'key' } },
  { name: READER_FONTS_STORE_NAME, options: { keyPath: 'font.id' } },
  {
    name: READER_READING_TIME_SEGMENTS_STORE_NAME,
    options: { keyPath: 'id' },
    indexes: [
      { name: 'bookId', keyPath: 'bookId' },
      { name: 'dayKey', keyPath: 'dayKey' },
      { name: 'bookIdDayKey', keyPath: ['bookId', 'dayKey'] },
    ],
  },
  {
    name: READER_READING_TIME_DAILY_STORE_NAME,
    options: { keyPath: 'id' },
    indexes: [
      { name: 'bookId', keyPath: 'bookId' },
      { name: 'dayKey', keyPath: 'dayKey' },
    ],
  },
  { name: READER_BOOK_STATUS_STORE_NAME, options: { keyPath: 'bookId' } },
  {
    name: CHAPTER_PAGE_COUNTS_STORE_NAME,
    options: { keyPath: 'key' },
    indexes: [{ name: 'bookId', keyPath: 'bookId' }],
  },
];

export type IDBResult<T = unknown> =
  | {
      status: 'success';
      code: 0;
      data: T;
      error: false;
      message?: string;
      reason?: string;
    }
  | {
      status: 'error';
      code: 1;
      data?: T;
      error: true;
      message: string;
      reason?: string;
    };

const errorResult = <T = unknown>(message: string, data?: T): IDBResult<T> => ({
  status: 'error',
  code: 1,
  data,
  error: true,
  message,
});

const successResult = <T = unknown>(data: T): IDBResult<T> => ({
  status: 'success',
  code: 0,
  data,
  error: false,
});

export class WebDB {
  database?: IDBDatabase;
  version: number;
  dbName: string;
  constructor({ dbName, version }: { dbName: string; version?: number }) {
    this.dbName = dbName;
    this.version = version || 1;
  }
  openDataBase = (): Promise<IDBResult<{ db: IDBDatabase }>> => {
    return new Promise<IDBResult<{ db: IDBDatabase }>>((resolve) => {
      const request = indexedDB.open(this.dbName, this.version);
      let blocked = false;
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        this.database = request.result;
        this.version = this.database.version;
        // If another tab (or a future release) upgrades the schema, close our
        // connection so the upgrade can proceed; the next operation reopens
        // via resumeDB. Same for browser-initiated closes (storage pressure).
        this.database.onversionchange = () => this.closeDataBase();
        this.database.onclose = () => {
          this.database = undefined;
        };
        resolve(successResult({ db: this.database }));
      };
      request.onerror = () => {
        const message = request.error?.message || 'open database error';
        resolve(errorResult<{ db: IDBDatabase }>(message));
      };
      request.onblocked = () => {
        blocked = true;
        resolve(errorResult('database upgrade blocked by another tab'));
      };
      request.onupgradeneeded = () => {
        const upgradeTransaction = request.transaction!;
        // An open request cannot be cancelled; don't let a late unblock expose
        // an unhydrated connection after the caller has already received failure.
        if (blocked) {
          upgradeTransaction.abort();
          return;
        }
        const database = request.result;
        DATABASE_STORES.forEach((storeConfig) => {
          // Create missing stores, and backfill missing indexes on stores that
          // already exist — `contains` alone would silently skip new indexes
          // added to an existing store in a later schema version.
          const store = database.objectStoreNames.contains(storeConfig.name)
            ? upgradeTransaction.objectStore(storeConfig.name)
            : database.createObjectStore(storeConfig.name, storeConfig.options);
          storeConfig.indexes?.forEach((index) => {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, index.keyPath, index.options);
            }
          });
        });
      };
    });
  };
  closeDataBase = (): void => {
    this.database?.close();
    this.database = undefined;
  };
  getObjectStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore | undefined {
    if (!this.database) {
      console.error('Database is not open');
      return undefined;
    }
    try {
      const transaction = this.database.transaction([storeName], mode);
      return transaction.objectStore(storeName);
    } catch (error) {
      console.error('getObjectStore failed', getErrorMessage(error));
      return undefined;
    }
  }
  add = <T = unknown>({ storeName, data }: { storeName: string; data: T }): Promise<IDBResult<T>> => {
    return new Promise<IDBResult<T>>((resolve) => {
      try {
        const store = this.getObjectStore(storeName, 'readwrite');
        if (!store) return resolve(errorResult<T>('Database not initialized'));
        const request = store.add(data);
        store.transaction.oncomplete = () => resolve(successResult(data));
        store.transaction.onabort = () =>
          resolve(
            errorResult<T>(store.transaction.error?.message || request.error?.message || 'add transaction aborted'),
          );
      } catch (error) {
        resolve(errorResult<T>(getErrorMessage(error, 'add error')));
      }
    });
  };
  update = <T = unknown>({ storeName, data }: { storeName: string; data: T }): Promise<IDBResult<null>> => {
    return new Promise<IDBResult<null>>((resolve) => {
      try {
        const store = this.getObjectStore(storeName, 'readwrite');
        if (!store) return resolve(errorResult('Database not initialized', null));
        const request = store.put(data);
        store.transaction.oncomplete = () => resolve(successResult(null));
        store.transaction.onabort = () =>
          resolve(
            errorResult(
              store.transaction.error?.message || request.error?.message || 'update transaction aborted',
              null,
            ),
          );
      } catch (error) {
        resolve(errorResult(getErrorMessage(error, 'update error'), null));
      }
    });
  };
  readByCursor = <T = unknown>({
    storeName,
    indexName,
    keyRange,
    direction,
  }: {
    storeName: string;
    indexName?: string;
    keyRange?: IDBKeyRange;
    direction?: IDBCursorDirection;
  }): Promise<IDBResult<T[]>> => {
    return new Promise<IDBResult<T[]>>((resolve) => {
      const result: T[] = [];
      try {
        const store = this.getObjectStore(storeName);
        if (!store) return resolve(errorResult<T[]>('Database not initialized', []));
        const source: IDBObjectStore | IDBIndex = indexName ? store.index(indexName) : store;
        const request = source.openCursor(keyRange, direction);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            result.push(cursor.value as T);
            cursor.continue();
          } else {
            resolve(successResult(result));
          }
        };
        request.onerror = () => resolve(errorResult<T[]>(request.error?.message || 'read cursor error', result));
      } catch (error) {
        // store.index() throws NotFoundError synchronously for a missing
        // index; keep the "never rejects" contract callers rely on.
        resolve(errorResult<T[]>(getErrorMessage(error, 'read cursor error'), result));
      }
    });
  };
  deleteByCursor = ({
    storeName,
    indexName,
    keyRange,
  }: {
    storeName: string;
    indexName?: string;
    keyRange?: IDBKeyRange;
  }): Promise<IDBResult<null>> => {
    return new Promise<IDBResult<null>>((resolve) => {
      try {
        const store = this.getObjectStore(storeName, 'readwrite');
        if (!store) return resolve(errorResult('Database not initialized', null));
        const source: IDBObjectStore | IDBIndex = indexName ? store.index(indexName) : store;
        const request = source.openKeyCursor(keyRange);
        store.transaction.oncomplete = () => resolve(successResult(null));
        store.transaction.onabort = () =>
          resolve(errorResult(store.transaction.error?.message || 'delete transaction aborted', null));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          store.delete(cursor.primaryKey);
          cursor.continue();
        };
      } catch (error) {
        resolve(errorResult(getErrorMessage(error, 'delete cursor error'), null));
      }
    });
  };
  delete = ({ storeName, key }: { storeName: string; key: IDBValidKey }): Promise<IDBResult<null>> => {
    return new Promise<IDBResult<null>>((resolve) => {
      try {
        const store = this.getObjectStore(storeName, 'readwrite');
        if (!store) return resolve(errorResult('Database not initialized', null));
        const request = store.delete(key);
        store.transaction.oncomplete = () => resolve(successResult(null));
        store.transaction.onabort = () =>
          resolve(
            errorResult(
              store.transaction.error?.message || request.error?.message || 'delete transaction aborted',
              null,
            ),
          );
      } catch (error) {
        resolve(errorResult(getErrorMessage(error, 'delete error'), null));
      }
    });
  };
}
