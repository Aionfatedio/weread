import { db } from '@/store';
import { trackPersistResult } from '@/lib/persistFailureNotice';
import { READER_SETTINGS_STORE_NAME } from '@/lib/readerStoreNames';
import { safeReadStorage, safeWriteStorage } from '@/lib/utils';

const READER_SETTING_KEYS = new Set([
  'weread-reader-theme',
  'weread-reader-font',
  'weread-reader-font-size',
  'weread-reader-page-turn-effect',
  'weread-reader-reading-mode',
  'weread-reader-first-line-indent',
  'weread-reader-page-gap-ratio',
  'weread-reader-scroll-padding-x',
  'weread-reader-annotation-color',
  'weread-reader-annotation-color-marker',
  'weread-reader-annotation-color-underline',
  'weread-reader-annotation-color-wave',
]);

export const isReaderSettingKey = (key: unknown): key is string =>
  typeof key === 'string' && READER_SETTING_KEYS.has(key);

export interface ReaderSettingRecord {
  key: string;
  updatedAt: number;
  value: string;
}

// In-memory overlay over localStorage so high-frequency reads on the render
// path (font size, line gap, indent, scroll padding) skip the try/catch +
// canUseStorage probe on every call. Cross-tab sync was not supported anyway.
const settingMemoryCache = new Map<string, string | null>();

export const readCachedReaderSetting = (key: string): string | null => {
  if (settingMemoryCache.has(key)) return settingMemoryCache.get(key) ?? null;
  const value = safeReadStorage(key);
  settingMemoryCache.set(key, value);
  return value;
};

export const writeCachedReaderSetting = (key: string, value: string): void => {
  settingMemoryCache.set(key, value);
  safeWriteStorage(key, value);
};

export const persistReaderSetting = (key: string, value: string): void => {
  writeCachedReaderSetting(key, value);
  trackPersistResult(
    db.update<ReaderSettingRecord>({
      data: {
        key,
        updatedAt: Date.now(),
        value,
      },
      storeName: READER_SETTINGS_STORE_NAME,
    }),
  );
};

export const getAllReaderSettings = async (): Promise<ReaderSettingRecord[]> => {
  const result = await db.readByCursor<ReaderSettingRecord>({ storeName: READER_SETTINGS_STORE_NAME });
  if (result.error) throw new Error(result.message);
  return result.data.filter((record) => isReaderSettingKey(record.key));
};

export const hydrateReaderSettingCache = async (): Promise<void> => {
  const result = await db.readByCursor<ReaderSettingRecord>({ storeName: READER_SETTINGS_STORE_NAME });
  if (result.error) throw new Error(result.message);
  result.data.forEach((record) => {
    if (isReaderSettingKey(record.key)) {
      writeCachedReaderSetting(record.key, record.value);
    }
  });
};
