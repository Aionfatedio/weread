import { showGlobalFallback } from '@/lib/globalFallback';
import { t } from '@/locales';
import type { IDBResult } from '@/lib/indexedDB';

// Reader data writes (progress, annotations, settings, reading time, ...) are
// fire-and-forget on hot paths; when IndexedDB rejects them (quota pressure,
// eviction, private mode) the in-memory cache keeps working and the loss only
// surfaces after a reload. Surface one toast so the user can export a backup.
//
// Throttled globally: a full disk fails EVERY subsequent write (progress saves
// fire on each page turn), and a toast per failure would bury the UI.
const PERSIST_FAILURE_NOTICE_THROTTLE_MS = 30_000;

let lastNoticeAt = 0;

const notifyPersistFailure = (): void => {
  const now = Date.now();
  if (now - lastNoticeAt < PERSIST_FAILURE_NOTICE_THROTTLE_MS) return;
  lastNoticeAt = now;
  showGlobalFallback({ message: t('storage.write_failed'), tone: 'error' });
};

export const reportPersistResult = <T>(result: IDBResult<T>): IDBResult<T> => {
  if (result.error) notifyPersistFailure();
  return result;
};

// For fire-and-forget writes: `trackPersistResult(db.update({...}))` instead
// of `void db.update({...})`, keeping call sites non-blocking.
export const trackPersistResult = (promise: Promise<IDBResult<unknown>>): void => {
  void promise.then(reportPersistResult);
};
