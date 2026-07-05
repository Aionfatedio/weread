import React from 'react';
import { findKeywordSentenceMatches } from '@/lib/searchText';
import type { SearchSentenceMatch } from '@/lib/searchText';

// Bounded per-keyword caches: when the search keyword changes the caches are
// dropped, so we never hold stale results for an old query. The caps are per
// active keyword and bound memory in long reading sessions.
const READER_HIGHLIGHT_CACHE_LIMIT = 512;
let highlightCacheKeyword = '';
let highlightCache = new Map<string, React.ReactNode>();
let sentenceMatchCache = new Map<string, SearchSentenceMatch[]>();

const setCacheKeyword = (keyword: string): void => {
  if (highlightCacheKeyword === keyword) return;
  highlightCacheKeyword = keyword;
  highlightCache = new Map();
  sentenceMatchCache = new Map();
};

const putBounded = <T,>(cache: Map<string, T>, key: string, value: T): void => {
  if (cache.size >= READER_HIGHLIGHT_CACHE_LIMIT) {
    const oldestKey = cache.keys().next();
    if (!oldestKey.done) cache.delete(oldestKey.value);
  }
  cache.set(key, value);
};

const getSentenceMatches = (text: string, keyword: string): SearchSentenceMatch[] => {
  setCacheKeyword(keyword);
  const cached = sentenceMatchCache.get(text);
  if (cached) return cached;
  const matches = findKeywordSentenceMatches(text, keyword);
  putBounded(sentenceMatchCache, text, matches);
  return matches;
};

// Render the [sliceStart, sliceEnd) window of `text`, with sentence-level
// <mark> and keyword-level <span> highlights computed against the WHOLE text.
// Annotated blocks are rendered segment by segment, and a keyword straddling
// a segment boundary is invisible to any per-segment `includes` check — the
// whole-text ranges clipped to the slice keep such matches highlighted.
export const renderHighlightedTextSlice = (
  text: string,
  keyword: string,
  sliceStart: number,
  sliceEnd: number,
): React.ReactNode => {
  if (!keyword) return text.slice(sliceStart, sliceEnd);

  const nodes: React.ReactNode[] = [];
  let cursor = sliceStart;

  getSentenceMatches(text, keyword).forEach((sentenceMatch, sentenceIndex) => {
    const markStart = Math.max(sentenceMatch.start, sliceStart);
    const markEnd = Math.min(sentenceMatch.end, sliceEnd);
    if (markEnd <= markStart) return;
    if (markStart > cursor) nodes.push(text.slice(cursor, markStart));

    const sentenceNodes: React.ReactNode[] = [];
    let innerCursor = markStart;
    let matchIndex = text.indexOf(keyword, sentenceMatch.start);
    while (matchIndex !== -1 && matchIndex < sentenceMatch.end) {
      const keywordStart = Math.max(matchIndex, markStart);
      const keywordEnd = Math.min(matchIndex + keyword.length, markEnd);
      if (keywordEnd > keywordStart) {
        if (keywordStart > innerCursor) sentenceNodes.push(text.slice(innerCursor, keywordStart));
        sentenceNodes.push(
          <span className="reader-search-match-highlight" key={`${sentenceIndex}-${matchIndex}`}>
            {text.slice(keywordStart, keywordEnd)}
          </span>,
        );
        innerCursor = keywordEnd;
      }
      matchIndex = text.indexOf(keyword, matchIndex + keyword.length);
    }
    if (innerCursor < markEnd) sentenceNodes.push(text.slice(innerCursor, markEnd));

    nodes.push(
      <mark className="reader-search-sentence-highlight" key={`${sentenceMatch.start}-${sentenceIndex}`}>
        {sentenceNodes}
      </mark>,
    );
    cursor = markEnd;
  });

  if (cursor < sliceEnd) nodes.push(text.slice(cursor, sliceEnd));
  return nodes;
};

export const renderHighlightedText = (text: string, keyword: string): React.ReactNode => {
  if (!keyword) return text;

  setCacheKeyword(keyword);
  const cached = highlightCache.get(text);
  if (cached !== undefined) return cached;

  const nodes = renderHighlightedTextSlice(text, keyword, 0, text.length);
  putBounded(highlightCache, text, nodes);
  return nodes;
};
