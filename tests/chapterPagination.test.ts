import { describe, expect, it } from 'vitest';
import { computeEstimateCalibration, estimateChapterPageCount } from '@/lib/chapterPagination';
import type { ChapterLayoutFingerprint } from '@/lib/chapterPagination';
import type { ReaderBlock } from '@/lib/transformText';

// linesPerPage = floor(400 / 40) = 10, charsPerLine = floor(200 / 20) = 10,
// heightPerPage = 400. Chosen so the expected page counts below are exact.
const FINGERPRINT: ChapterLayoutFingerprint = {
  firstLineIndent: '0',
  fontFamily: 'test',
  fontSize: 20,
  lineHeight: 40,
  pageGap: 0,
  pageHeight: 400,
  pageWidth: 200,
  paragraphGap: 20,
};

let blockCounter = 0;

const buildBlock = (text: string, type: ReaderBlock['type'] = 'paragraph'): ReaderBlock => ({
  end: text.length,
  id: `test-block-${blockCounter++}`,
  start: 0,
  text,
  type,
});

describe('estimateChapterPageCount', () => {
  it('fits 9 full-width lines plus the paragraph gap on one page', () => {
    // 90 CJK chars -> 9 lines -> 9 * 40 + 20 = 380 <= 400.
    const blocks = [buildBlock('字'.repeat(90))];
    expect(estimateChapterPageCount(blocks, FINGERPRINT)).toBe(1);
  });

  it('overflows to a second page when the gap pushes past the page height', () => {
    // 100 CJK chars -> 10 lines -> 10 * 40 + 20 = 420 > 400.
    const blocks = [buildBlock('字'.repeat(100))];
    expect(estimateChapterPageCount(blocks, FINGERPRINT)).toBe(2);
  });

  it('counts narrow (Latin) glyphs at a reduced width', () => {
    // 100 narrow chars -> 55 effective -> 6 lines -> 260 <= 400.
    const blocks = [buildBlock('a'.repeat(100))];
    expect(estimateChapterPageCount(blocks, FINGERPRINT)).toBe(1);
  });

  it('budgets a full page for image blocks', () => {
    // Image: 400 + 20; paragraph: 380 -> total 800 -> 2 pages.
    const blocks = [buildBlock('', 'image'), buildBlock('字'.repeat(90))];
    expect(estimateChapterPageCount(blocks, FINGERPRINT)).toBe(2);
  });

  it('never returns less than one page', () => {
    expect(estimateChapterPageCount([], FINGERPRINT)).toBe(1);
  });
});

describe('computeEstimateCalibration', () => {
  it('returns 1 without usable samples', () => {
    expect(computeEstimateCalibration([])).toBe(1);
    expect(computeEstimateCalibration([{ estimated: 0, measured: 5 }])).toBe(1);
  });

  it('returns the aggregate measured/estimated ratio', () => {
    expect(computeEstimateCalibration([{ estimated: 10, measured: 5 }])).toBe(0.5);
    expect(
      computeEstimateCalibration([
        { estimated: 10, measured: 15 },
        { estimated: 10, measured: 15 },
      ]),
    ).toBe(1.5);
  });

  it('ignores samples missing either side', () => {
    expect(
      computeEstimateCalibration([
        { estimated: 0, measured: 5 },
        { estimated: 10, measured: 20 },
      ]),
    ).toBe(2);
  });

  it('clamps pathological ratios into [0.4, 2.5]', () => {
    expect(computeEstimateCalibration([{ estimated: 100, measured: 1 }])).toBe(0.4);
    expect(computeEstimateCalibration([{ estimated: 1, measured: 100 }])).toBe(2.5);
  });
});
