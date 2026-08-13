import { describe, expect, it } from 'vitest';
import { findKeywordSentenceMatches } from '@/lib/searchText';

describe('findKeywordSentenceMatches', () => {
  it('returns the full sentence containing the keyword', () => {
    const text = '今天天气很好。我们一起去公园玩！你觉得怎么样？';
    const matches = findKeywordSentenceMatches(text, '公园');
    expect(matches).toHaveLength(1);
    expect(matches[0].sentence).toBe('我们一起去公园玩！');
    expect(text.slice(matches[0].start, matches[0].end)).toBe(matches[0].sentence);
  });

  it('deduplicates multiple keyword hits inside one sentence', () => {
    const text = '他说他很好，他真的很好。';
    const matches = findKeywordSentenceMatches(text, '他');
    expect(matches).toHaveLength(1);
    expect(matches[0].sentence).toBe('他说他很好，他真的很好。');
  });

  it('reports one match per sentence across multiple sentences', () => {
    const text = '天气很好。风景也很好。今天真不错。';
    const matches = findKeywordSentenceMatches(text, '很好');
    expect(matches.map((match) => match.sentence)).toEqual(['天气很好。', '风景也很好。']);
  });

  it('keeps quoted dialogue as a single sentence including closing quotes', () => {
    const text = '「今天下雨了。」他说。';
    const matches = findKeywordSentenceMatches(text, '下雨');
    expect(matches).toHaveLength(1);
    expect(matches[0].sentence).toBe('「今天下雨了。」');
  });

  it('splits sentences on newlines even without punctuation', () => {
    const text = '第一行没有标点\n第二行提到关键词\n第三行结束';
    const matches = findKeywordSentenceMatches(text, '关键词');
    expect(matches).toHaveLength(1);
    expect(matches[0].sentence).toBe('第二行提到关键词');
  });

  it('handles English sentence punctuation', () => {
    const text = 'Hello world. This is a test. Done.';
    const matches = findKeywordSentenceMatches(text, 'test');
    expect(matches).toHaveLength(1);
    expect(matches[0].sentence).toBe('This is a test.');
  });

  it('returns an empty list for an empty or absent keyword', () => {
    expect(findKeywordSentenceMatches('一些文本。', '')).toEqual([]);
    expect(findKeywordSentenceMatches('一些文本。', '不存在')).toEqual([]);
  });
});
