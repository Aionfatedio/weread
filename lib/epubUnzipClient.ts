import type { EpubUnzipEntry, EpubUnzipResponse } from '@/workers/epubWorker';
import { createRandomId } from '@/lib/utils';

const PENDING_OPERATION_TIMEOUT_MS = 120_000;

let epubWorker: Worker | null = null;

const getEpubWorker = (): Worker | null => {
  if (epubWorker) return epubWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    epubWorker = new Worker(new URL('../workers/epubWorker.ts', import.meta.url), { type: 'module' });
    return epubWorker;
  } catch {
    return null;
  }
};

// Hands the raw EPUB ArrayBuffer off to a dedicated worker for ZIP central-
// directory parsing and DEFLATE inflation. The buffer is transferred
// (zero-copy); the worker transfers each inflated entry's buffer back the
// same way. After this call the caller's `buffer` is detached.
export const unzipEpubInWorker = (buffer: ArrayBuffer): Promise<EpubUnzipEntry[]> => {
  const worker = getEpubWorker();
  if (!worker) {
    return Promise.reject(new Error('This browser does not support Web Workers required for EPUB import.'));
  }

  return new Promise<EpubUnzipEntry[]>((resolve, reject) => {
    const opId = createRandomId('epub-unzip');
    let settled = false;
    let timer: number | undefined;

    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const onMessage = (event: MessageEvent<EpubUnzipResponse>): void => {
      if (event.data?.opId !== opId) return;
      if (settled) return;
      settled = true;
      cleanup();
      if (event.data.status === 'success' && event.data.entries) {
        resolve(event.data.entries);
      } else {
        reject(new Error(event.data.message || 'EPUB unzip failed.'));
      }
    };

    const onError = (event: ErrorEvent): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || 'EPUB worker error.'));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('EPUB unzip timed out.'));
    }, PENDING_OPERATION_TIMEOUT_MS);

    try {
      worker.postMessage({ type: 'unzip', opId, buffer }, [buffer]);
    } catch (error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
};
