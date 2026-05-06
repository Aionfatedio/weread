export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
};

export const clampRatio = (value: number): number => clamp(value, 0, 1);

export const canUseDOM = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

export const canUseStorage = (): boolean => canUseDOM() && typeof window.localStorage !== 'undefined';

export const safeReadStorage = (key: string): string | null => {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeWriteStorage = (key: string, value: string): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota and private-mode failures.
  }
};

export const safeRemoveStorage = (key: string): void => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore restricted storage contexts.
  }
};

export const getErrorMessage = (error: unknown, fallback = 'Unknown error'): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === 'string') return candidate;
  }
  return fallback;
};

export const createRandomId = (prefix = 'id'): string => {
  if (canUseDOM() && typeof window.crypto?.randomUUID === 'function') {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const fnv1aHex = (data: Uint8Array): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  const positive = hash >>> 0;
  return `${positive.toString(16).padStart(8, '0')}${data.length.toString(16).padStart(8, '0')}`;
};

export const sha256Hex = async (value: string | Uint8Array<ArrayBuffer>): Promise<string> => {
  const subtle = canUseDOM() ? globalThis.crypto?.subtle : undefined;
  const data: Uint8Array =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;

  if (subtle) {
    const buffer = await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  return fnv1aHex(data);
};
