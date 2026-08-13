import { db } from '@/store';
import { reportPersistResult, trackPersistResult } from '@/lib/persistFailureNotice';
import { CHAPTER_PAGE_COUNTS_STORE_NAME } from '@/lib/readerStoreNames';
import type { ReaderBlock } from '@/lib/transformText';

export interface ChapterPagination {
  chapterPageCount: number;
  blockIdLocalPage: Record<string, number>;
  blockIdLocalPageEnd: Record<string, number>;
  estimated: boolean;
}

export interface ChapterLayoutFingerprint {
  firstLineIndent: string;
  fontFamily: string;
  fontSize: number;
  pageWidth: number;
  pageHeight: number;
  pageGap: number;
  paragraphGap: number;
  lineHeight: number;
}

const CACHE_LIMIT = 256;

const cache = new Map<string, ChapterPagination>();

const fingerprintToString = (f: ChapterLayoutFingerprint): string => {
  return `${f.fontFamily}|${f.fontSize}|${f.firstLineIndent}|${f.pageWidth}|${f.pageHeight}|${f.pageGap}|${f.paragraphGap}|${f.lineHeight}`;
};

// Stable identity for "the layout these page numbers were computed under".
// Persisted inside ReaderLocator so restore logic can tell whether a stored
// block page offset is still meaningful or the layout has changed since.
export const serializeChapterLayoutFingerprint = fingerprintToString;

const buildCacheKey = (bookId: string, titleId: number, fingerprint: ChapterLayoutFingerprint): string => {
  return `${bookId}|${titleId}|${fingerprintToString(fingerprint)}`;
};

export const getCachedChapterPagination = (
  bookId: string | undefined,
  titleId: number,
  fingerprint: ChapterLayoutFingerprint,
): ChapterPagination | undefined => {
  if (!bookId) return undefined;
  const key = buildCacheKey(bookId, titleId, fingerprint);
  const value = cache.get(key);
  if (value === undefined) return undefined;
  // Refresh recency: re-insert to move the entry to the end.
  cache.delete(key);
  cache.set(key, value);
  return value;
};

export const setCachedChapterPagination = (
  bookId: string | undefined,
  titleId: number,
  fingerprint: ChapterLayoutFingerprint,
  pagination: ChapterPagination,
): void => {
  if (!bookId) return;
  const key = buildCacheKey(bookId, titleId, fingerprint);
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, pagination);
};

export const clearChapterPaginationCache = (bookId?: string, titleId?: number): void => {
  if (!bookId) {
    cache.clear();
    return;
  }
  const prefix = titleId === undefined ? `${bookId}|` : `${bookId}|${titleId}|`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};

// ---------------------------------------------------------------------------
// Page-count estimation for chapters that have not been DOM-measured yet.
// ---------------------------------------------------------------------------

// Narrow (Latin / half-width) glyphs average ~0.55em against 1em for CJK.
// Treating them as full-width nearly doubles the page estimate for English
// text, which is the largest source of total-page jitter while reading.
const NARROW_CHAR_WIDTH_RATIO = 0.55;

// Headings render at a larger font size than body text; approximate their
// extra footprint with a width multiplier instead of measuring.
const HEADING_WIDTH_RATIO = 1.5;

// Everything below U+2E80 (start of the CJK ranges) is treated as narrow:
// Latin, digits, punctuation, Cyrillic, Greek. Half-width katakana and other
// narrow high-codepoint glyphs are rare enough to ignore.
const CJK_RANGE_START = 0x2e80;

// Blocks are immutable snapshots, so the O(text length) classification pass
// runs once per block per session.
const blockEffectiveCharsCache = new WeakMap<ReaderBlock, number>();

const getEffectiveCharCount = (block: ReaderBlock): number => {
  const cached = blockEffectiveCharsCache.get(block);
  if (cached !== undefined) return cached;
  const text = block.text;
  let wide = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) >= CJK_RANGE_START) wide++;
  }
  const effective = wide + (text.length - wide) * NARROW_CHAR_WIDTH_RATIO;
  blockEffectiveCharsCache.set(block, effective);
  return effective;
};

export const estimateChapterPageCount = (
  blocks: readonly ReaderBlock[],
  fingerprint: ChapterLayoutFingerprint,
): number => {
  const { fontSize, pageWidth, pageHeight, lineHeight, paragraphGap } = fingerprint;
  const usableHeight = Math.max(pageHeight, lineHeight);
  const linesPerPage = Math.max(1, Math.floor(usableHeight / Math.max(lineHeight, 1)));
  const charsPerLine = Math.max(1, Math.floor(pageWidth / Math.max(fontSize, 1)));

  let blockBudget = 0;
  for (const block of blocks) {
    if (block.type === 'image') {
      blockBudget += usableHeight + paragraphGap;
      continue;
    }
    const widthRatio = block.type === 'heading' ? HEADING_WIDTH_RATIO : 1;
    const effectiveChars = getEffectiveCharCount(block) * widthRatio;
    const lines = Math.max(1, Math.ceil(Math.max(effectiveChars, 1) / charsPerLine));
    blockBudget += lines * lineHeight + paragraphGap;
  }
  const heightPerPage = linesPerPage * lineHeight;
  const pages = Math.ceil(blockBudget / Math.max(heightPerPage, 1));
  return Math.max(1, pages);
};

// Adaptive calibration: over chapters that have BOTH a DOM measurement and an
// estimate, the aggregate measured/estimated ratio captures the estimator's
// systematic bias for THIS book under THIS layout (font metrics,
// justification, indentation). Applying it to the remaining estimates makes
// total page counts converge after the reader has visited a few chapters.
export const computeEstimateCalibration = (samples: ReadonlyArray<{ estimated: number; measured: number }>): number => {
  let estimatedSum = 0;
  let measuredSum = 0;
  for (const sample of samples) {
    if (sample.estimated > 0 && sample.measured > 0) {
      estimatedSum += sample.estimated;
      measuredSum += sample.measured;
    }
  }
  if (estimatedSum <= 0 || measuredSum <= 0) return 1;
  // Clamp so one pathological chapter (huge images, empty scaffolding) cannot
  // distort the whole book's projection.
  return Math.min(Math.max(measuredSum / estimatedSum, 0.4), 2.5);
};

// ---------------------------------------------------------------------------
// Persisted per-chapter page counts. One record per (book, layout): tiny
// (chapter count numbers), enough to keep total pages / chapter start pages
// stable across reloads without persisting full per-block page maps.
// ---------------------------------------------------------------------------

interface PersistedChapterPageCounts {
  key: string; // `${bookId}|${layout fingerprint}`
  bookId: string;
  counts: Record<number, number>; // titleId -> measured chapterPageCount
  updatedAt: number;
}

const PAGE_COUNTS_WRITE_DEBOUNCE_MS = 800;

const pageCountsCache = new Map<string, Record<number, number>>();
const pageCountsWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const hydratedPageCountsBooks = new Set<string>();

const buildPageCountsKey = (bookId: string, fingerprint: ChapterLayoutFingerprint): string =>
  `${bookId}|${fingerprintToString(fingerprint)}`;

export const hydrateChapterPageCounts = async (bookId: string): Promise<void> => {
  if (!bookId || hydratedPageCountsBooks.has(bookId)) return;
  hydratedPageCountsBooks.add(bookId);
  const result = await db.readByCursor<PersistedChapterPageCounts>({
    storeName: CHAPTER_PAGE_COUNTS_STORE_NAME,
    indexName: 'bookId',
    keyRange: IDBKeyRange.only(bookId),
  });
  if (result.error) {
    // Allow a retry on the next visit instead of caching the failure.
    hydratedPageCountsBooks.delete(bookId);
    return;
  }
  result.data.forEach((record) => {
    if (record?.key && record.counts) pageCountsCache.set(record.key, record.counts);
  });
};

export const getPersistedChapterPageCount = (
  bookId: string | undefined,
  titleId: number,
  fingerprint: ChapterLayoutFingerprint,
): number | undefined => {
  if (!bookId) return undefined;
  const counts = pageCountsCache.get(buildPageCountsKey(bookId, fingerprint));
  const value = counts?.[titleId];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
};

export const persistChapterPageCount = (
  bookId: string | undefined,
  titleId: number,
  fingerprint: ChapterLayoutFingerprint,
  pageCount: number,
): void => {
  if (!bookId || !Number.isFinite(pageCount) || pageCount <= 0) return;
  const key = buildPageCountsKey(bookId, fingerprint);
  const counts = pageCountsCache.get(key) ?? {};
  if (counts[titleId] === pageCount) return;
  counts[titleId] = pageCount;
  pageCountsCache.set(key, counts);

  // Chapters are measured one after another while the user pages through the
  // book; debounce so a reading burst becomes one IndexedDB write.
  const pendingTimer = pageCountsWriteTimers.get(key);
  if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  pageCountsWriteTimers.set(
    key,
    setTimeout(() => {
      pageCountsWriteTimers.delete(key);
      const latestCounts = pageCountsCache.get(key);
      if (!latestCounts) return;
      trackPersistResult(
        db.update<PersistedChapterPageCounts>({
          data: { key, bookId, counts: latestCounts, updatedAt: Date.now() },
          storeName: CHAPTER_PAGE_COUNTS_STORE_NAME,
        }),
      );
    }, PAGE_COUNTS_WRITE_DEBOUNCE_MS),
  );
};

export const deletePersistedChapterPageCounts = async (bookId: string): Promise<void> => {
  if (!bookId) return;
  const prefix = `${bookId}|`;
  for (const key of Array.from(pageCountsCache.keys())) {
    if (key.startsWith(prefix)) {
      pageCountsCache.delete(key);
      const pendingTimer = pageCountsWriteTimers.get(key);
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        pageCountsWriteTimers.delete(key);
      }
    }
  }
  hydratedPageCountsBooks.delete(bookId);
  reportPersistResult(
    await db.deleteByCursor({
      storeName: CHAPTER_PAGE_COUNTS_STORE_NAME,
      indexName: 'bookId',
      keyRange: IDBKeyRange.only(bookId),
    }),
  );
};

// ---------------------------------------------------------------------------
// DOM measurement of the currently rendered chapter.
// ---------------------------------------------------------------------------

// Tolerance (fraction of a page step) when mapping a rect's x-offset to a
// page index — absorbs sub-pixel column rounding at column boundaries.
const PAGE_SNAP_TOLERANCE_RATIO = 0.08;

interface ElementPageRange {
  start: number;
  end: number;
}

const measureElementPageRange = (
  element: HTMLElement,
  flowRect: DOMRect,
  pageStep: number,
  lastPage: number,
): ElementPageRange | null => {
  const rects = Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) return null;
  const pages = rects.map((rect) => {
    const relativeLeft = rect.left - flowRect.left;
    const candidate = Math.floor((relativeLeft + pageStep * PAGE_SNAP_TOLERANCE_RATIO) / pageStep);
    return Math.min(Math.max(candidate, 0), Math.max(lastPage, 0));
  });
  return { start: Math.min(...pages), end: Math.max(...pages) };
};

export const measureChapterPagination = (flow: HTMLElement, pageStep: number): ChapterPagination | null => {
  if (pageStep <= 0) return null;
  const scrollWidth = flow.scrollWidth;
  if (scrollWidth <= 0) return null;
  const chapterPageCount = Math.max(1, Math.ceil(scrollWidth / pageStep));
  const lastPage = chapterPageCount - 1;
  const blockIdLocalPage: Record<string, number> = {};
  const blockIdLocalPageEnd: Record<string, number> = {};
  const flowRect = flow.getBoundingClientRect();

  flow.querySelectorAll<HTMLElement>('[data-reader-block-id]').forEach((element) => {
    const blockId = element.dataset.readerBlockId;
    if (!blockId) return;
    const range = measureElementPageRange(element, flowRect, pageStep, lastPage);
    if (!range) return;
    blockIdLocalPage[blockId] = range.start;
    blockIdLocalPageEnd[blockId] = range.end;
  });

  return {
    chapterPageCount,
    blockIdLocalPage,
    blockIdLocalPageEnd,
    estimated: false,
  };
};
