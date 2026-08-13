import { describe, expect, it } from 'vitest';
import { extractBookChapters, extractCaptionTitleChapters } from '@/lib/chapterSplitter';

const CJK_PARAGRAPH = '山间的清晨总是带着薄雾，弟子们在院中扫地挑水，偶尔抬头看一眼远处的云海，谁也不敢多说一句话。';

const buildCjkBody = (): string => Array.from({ length: 5 }, () => CJK_PARAGRAPH.repeat(5)).join('\n');

const buildCjkBook = (titles: string[]): string => titles.map((title) => `${title}\n\n${buildCjkBody()}`).join('\n\n');

describe('extractCaptionTitleChapters', () => {
  it('splits on caption-title markers and chains chapter ranges', () => {
    const text = [
      '<caption-title>序章</caption-title>',
      '序章的正文内容。',
      '<caption-title>第一章 出发</caption-title>',
      '第一章的正文内容。',
    ].join('\n');

    const chapters = extractCaptionTitleChapters(text);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['序章', '第一章 出发']);
    expect(chapters[0].end).toBe(chapters[1].start);
    expect(chapters[1].end).toBe(text.length);
  });
});

describe('extractBookChapters', () => {
  it('prefers caption-title markers over heuristics', () => {
    const text = '<caption-title>第一章</caption-title>\n正文\n<caption-title>第二章</caption-title>\n正文';
    const result = extractBookChapters(text);
    expect(result.method).toBe('caption-title');
    expect(result.confidence).toBe(100);
    expect(result.chapters).toHaveLength(2);
  });

  it('detects standard CJK chapter headings in document order', () => {
    const titles = ['第一章 初入山门', '第二章 灵药园', '第三章 夜探藏经阁', '第四章 下山历练', '第五章 归途'];
    const text = buildCjkBook(titles);

    const result = extractBookChapters(text);
    expect(result.method).toBe('smart');
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(titles);
    for (let index = 0; index < result.chapters.length - 1; index++) {
      expect(result.chapters[index].start).toBeLessThan(result.chapters[index + 1].start);
      expect(result.chapters[index].end).toBe(result.chapters[index + 1].start);
    }
    expect(result.chapters[result.chapters.length - 1].end).toBe(text.length);
  });

  it('parses multi-character Chinese numerals as a continuous sequence', () => {
    const titles = ['第十章 传承', '第十一章 试炼', '第十二章 突破', '第十三章 风波', '第十四章 远行', '第十五章 重逢'];
    const result = extractBookChapters(buildCjkBook(titles));
    expect(result.method).toBe('smart');
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(titles);
  });

  it('detects English chapter headings with roman numerals', () => {
    const paragraph =
      'The road wound through the hills and the travellers walked in silence for a long while, watching the light fade. ';
    const body = paragraph.repeat(10);
    const titles = ['CHAPTER I.', 'CHAPTER II.', 'CHAPTER III.', 'CHAPTER IV.'];
    const text = titles.map((title) => `${title}\n\n${body}`).join('\n\n');

    const result = extractBookChapters(text);
    expect(result.method).toBe('smart');
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(titles);
  });

  it('returns none for prose without chapter markers', () => {
    const text = '这是一本没有章节标记的散文集。作者写了很多零散的思考。\n它们彼此独立，没有明显的结构。';
    const result = extractBookChapters(text);
    expect(result.method).toBe('none');
    expect(result.chapters).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('does not treat ordinary sentences mentioning 章 as headings', () => {
    const sentence = '他翻开了这本书的第一章，觉得写得平平无奇，于是又跳到了后面的第二章继续读了下去。';
    const text = Array.from({ length: 40 }, () => sentence).join('\n');
    const result = extractBookChapters(text);
    expect(result.chapters).toEqual([]);
  });
});
