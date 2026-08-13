import { describe, expect, it } from 'vitest';
import { SINGLE_TITLE_SEGMENT_CHAR_COUNT, readerDocumentToTextSyntaxTree } from '@/lib/readerDocument';
import type { ReaderBookDocument, ReaderDocumentChapter } from '@/lib/readerDocument';

const PARAGRAPH = '这是一个用于测试的段落，包含了足够多的文字来模拟真实书籍的正文内容，避免过短的段落影响分段。';

const buildChapter = (
  id: string,
  order: number,
  paragraphCount: number,
  title = '测试章节',
): ReaderDocumentChapter => ({
  id,
  order,
  text: Array.from({ length: paragraphCount }, () => PARAGRAPH).join('\n'),
  title,
});

const buildDocument = (chapters: ReaderDocumentChapter[]): ReaderBookDocument => ({
  author: '作者',
  chapters,
  rawText: chapters.map((chapter) => `${chapter.title}\n${chapter.text}`).join('\n\n'),
  sourceType: 'txt',
  title: '测试书籍',
  version: 1,
});

// Enough paragraphs to exceed several segment sizes.
const LARGE_PARAGRAPH_COUNT = Math.ceil((SINGLE_TITLE_SEGMENT_CHAR_COUNT * 3.5) / PARAGRAPH.length);

describe('readerDocumentToTextSyntaxTree single-title segmentation', () => {
  it('splits an oversized single-title book into fixed-size segments', () => {
    const tree = readerDocumentToTextSyntaxTree(buildDocument([buildChapter('chapter-0', 0, LARGE_PARAGRAPH_COUNT)]));

    expect(tree.segmentedSingleTitle).toBe(true);
    expect(tree.sequences.length).toBeGreaterThan(1);
    expect(tree.titleIdTitle).toHaveLength(tree.sequences.length);
    tree.titleIdTitle.forEach((title, index) => {
      expect(title).toBe(`测试章节 (${index + 1}/${tree.sequences.length})`);
    });
  });

  it('splits only at block boundaries and keeps every block exactly once', () => {
    const tree = readerDocumentToTextSyntaxTree(buildDocument([buildChapter('chapter-0', 0, LARGE_PARAGRAPH_COUNT)]));

    let expectedTitleId = 0;
    let seenBlocks = 0;
    tree.sequences.forEach((sequence) => {
      const segmentBlocks = tree.blocksByTitleId.get(sequence.titleId) ?? [];
      expect(segmentBlocks.length).toBeGreaterThan(0);
      expect(sequence.titleId).toBe(expectedTitleId);
      expect(sequence.blockId).toBe(segmentBlocks[0].id);
      segmentBlocks.forEach((block) => {
        expect(block.titleId).toBe(sequence.titleId);
      });
      seenBlocks += segmentBlocks.length;
      expectedTitleId += 1;
    });
    expect(seenBlocks).toBe(tree.blocks.length);
  });

  it('caps every non-final segment near the char budget', () => {
    const tree = readerDocumentToTextSyntaxTree(buildDocument([buildChapter('chapter-0', 0, LARGE_PARAGRAPH_COUNT)]));

    tree.sequences.slice(0, -1).forEach((sequence) => {
      const segmentBlocks = tree.blocksByTitleId.get(sequence.titleId) ?? [];
      const charCount = segmentBlocks.reduce((sum, block) => sum + block.text.length, 0);
      expect(charCount).toBeGreaterThanOrEqual(SINGLE_TITLE_SEGMENT_CHAR_COUNT);
      // One block may overshoot the budget; it must never exceed it by more
      // than a single paragraph.
      expect(charCount).toBeLessThan(SINGLE_TITLE_SEGMENT_CHAR_COUNT + PARAGRAPH.length + 1);
    });
  });

  it('keeps block ids and rawText offsets identical to the unsplit layout', () => {
    const tree = readerDocumentToTextSyntaxTree(buildDocument([buildChapter('chapter-0', 0, LARGE_PARAGRAPH_COUNT)]));

    tree.blocks.forEach((block, index) => {
      expect(block.id).toBe(`chapter-0-block-${index}`);
      expect(tree.rawText.slice(block.start, block.end)).toBe(block.text);
    });
  });

  it('does not split a short single-title book', () => {
    const tree = readerDocumentToTextSyntaxTree(buildDocument([buildChapter('chapter-0', 0, 5)]));

    expect(tree.segmentedSingleTitle).toBeUndefined();
    expect(tree.sequences).toHaveLength(1);
    expect(tree.titleIdTitle).toEqual(['测试章节']);
  });

  it('does not split multi-chapter books even when chapters are long', () => {
    const halfLarge = Math.ceil(LARGE_PARAGRAPH_COUNT / 2);
    const tree = readerDocumentToTextSyntaxTree(
      buildDocument([
        buildChapter('chapter-0', 0, halfLarge, '第一章'),
        buildChapter('chapter-1', 1, halfLarge, '第二章'),
      ]),
    );

    expect(tree.segmentedSingleTitle).toBeUndefined();
    expect(tree.sequences).toHaveLength(2);
    expect(tree.titleIdTitle).toEqual(['第一章', '第二章']);
  });
});
