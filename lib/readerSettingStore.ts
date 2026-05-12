import { db } from '@/store';
import { READER_SETTINGS_STORE_NAME } from '@/lib/readerStoreNames';
import { safeReadStorage, safeWriteStorage } from '@/lib/utils';

interface ReaderSettingRecord {
  key: string;
  updatedAt: number;
  value: string;
}

export const readCachedReaderSetting = (key: string): string | null => safeReadStorage(key);

export const writeCachedReaderSetting = (key: string, value: string): void => {
  safeWriteStorage(key, value);
};

export const persistReaderSetting = (key: string, value: string): void => {
  writeCachedReaderSetting(key, value);
  void db.update<ReaderSettingRecord>({
    data: {
      key,
      updatedAt: Date.now(),
      value,
    },
    storeName: READER_SETTINGS_STORE_NAME,
  });
};

export const hydrateReaderSettingCache = async (): Promise<void> => {
  const result = await db.readByCursor<ReaderSettingRecord>({ storeName: READER_SETTINGS_STORE_NAME });
  if (result.error) return;
  result.data.forEach((record) => {
    if (record?.key && typeof record.value === 'string') {
      writeCachedReaderSetting(record.key, record.value);
    }
  });
};
