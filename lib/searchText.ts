export interface SearchSentenceMatch {
  end: number;
  sentence: string;
  start: number;
}

interface SentenceRange {
  end: number;
  start: number;
}

const SENTENCE_END_CHARACTERS = new Set([
  '\u3002',
  '\uff01',
  '\uff1f',
  '\uff1b',
  '\u2026',
  '!',
  '?',
  ';',
  '.',
]);

const SENTENCE_HARD_END_CHARACTERS = new Set(['\n']);

const SENTENCE_CLOSING_CHARACTERS = new Set([
  '\u300d',
  '\u300f',
  '\u201d',
  '\u2019',
  '\u300b',
  '\u3009',
  '\uff09',
  '\u3011',
  '\u3015',
  '\u3017',
  '\u3019',
  '\u301b',
  '"',
  ')',
  ']',
]);

const QUOTE_END_BY_START = new Map([
  ['\u300c', '\u300d'],
  ['\u300e', '\u300f'],
  ['\u201c', '\u201d'],
  ['\u2018', '\u2019'],
  ['\u300a', '\u300b'],
  ['\u3008', '\u3009'],
  ['\uff08', '\uff09'],
  ['\u3010', '\u3011'],
  ['\u3014', '\u3015'],
  ['\u3016', '\u3017'],
  ['\u3018', '\u3019'],
  ['\u301a', '\u301b'],
  ['"', '"'],
  ['(', ')'],
  ['[', ']'],
]);

const hasTerminalBeforeClosingQuote = (text: string, index: number): boolean => {
  let position = index - 1;
  while (position >= 0 && SENTENCE_CLOSING_CHARACTERS.has(text[position])) {
    position--;
  }
  return position >= 0 && SENTENCE_END_CHARACTERS.has(text[position]);
};

const appendSentenceRange = (ranges: SentenceRange[], text: string, start: number, end: number): void => {
  let normalizedStart = start;
  let normalizedEnd = end;

  while (normalizedStart < normalizedEnd && /\s/.test(text[normalizedStart])) {
    normalizedStart++;
  }
  while (normalizedEnd > normalizedStart && /\s/.test(text[normalizedEnd - 1])) {
    normalizedEnd--;
  }

  if (normalizedStart < normalizedEnd) {
    ranges.push({ end: normalizedEnd, start: normalizedStart });
  }
};

const consumeTrailingClosingCharacters = (text: string, index: number): number => {
  let end = index;
  while (end < text.length && SENTENCE_CLOSING_CHARACTERS.has(text[end])) {
    end++;
  }
  return end;
};

const closeQuote = (quoteStack: string[], value: string): boolean => {
  if (quoteStack[quoteStack.length - 1] !== value) return false;
  quoteStack.pop();
  return true;
};

const updateQuoteStack = (quoteStack: string[], value: string): 'close' | 'open' | undefined => {
  if (closeQuote(quoteStack, value)) return 'close';

  const quoteEnd = QUOTE_END_BY_START.get(value);
  if (!quoteEnd) return undefined;

  quoteStack.push(quoteEnd);
  return 'open';
};

const findSentenceRanges = (text: string): SentenceRange[] => {
  const ranges: SentenceRange[] = [];
  const quoteStack: string[] = [];
  let sentenceStart = 0;

  for (let position = 0; position < text.length; position++) {
    const value = text[position];

    if (SENTENCE_HARD_END_CHARACTERS.has(value)) {
      appendSentenceRange(ranges, text, sentenceStart, position + 1);
      sentenceStart = position + 1;
      quoteStack.length = 0;
      continue;
    }

    const quoteUpdate = updateQuoteStack(quoteStack, value);
    if (quoteUpdate === 'close') {
      if (quoteStack.length === 0 && hasTerminalBeforeClosingQuote(text, position)) {
        const end = consumeTrailingClosingCharacters(text, position + 1);
        appendSentenceRange(ranges, text, sentenceStart, end);
        sentenceStart = end;
        position = end - 1;
      }
      continue;
    }
    if (quoteUpdate === 'open') continue;

    if (quoteStack.length === 0 && SENTENCE_END_CHARACTERS.has(value)) {
      const end = consumeTrailingClosingCharacters(text, position + 1);
      appendSentenceRange(ranges, text, sentenceStart, end);
      sentenceStart = end;
      position = end - 1;
    }
  }

  appendSentenceRange(ranges, text, sentenceStart, text.length);
  return ranges;
};

const findRangeByIndex = (ranges: SentenceRange[], index: number, fromIndex: number): number => {
  let rangeIndex = fromIndex;
  while (rangeIndex < ranges.length && ranges[rangeIndex].end <= index) {
    rangeIndex++;
  }
  return rangeIndex;
};

export const findKeywordSentenceMatches = (text: string, keyword: string): SearchSentenceMatch[] => {
  if (!keyword) return [];

  const ranges = findSentenceRanges(text);
  const matches: SearchSentenceMatch[] = [];
  let fromIndex = 0;
  let rangeIndex = 0;

  while (fromIndex < text.length) {
    const index = text.indexOf(keyword, fromIndex);
    if (index === -1) break;

    rangeIndex = findRangeByIndex(ranges, index, rangeIndex);
    const range = ranges[rangeIndex] || { end: text.length, start: 0 };
    const previousMatch = matches[matches.length - 1];

    if (!previousMatch || previousMatch.start !== range.start || previousMatch.end !== range.end) {
      matches.push({
        end: range.end,
        sentence: text.slice(range.start, range.end),
        start: range.start,
      });
    }

    fromIndex = index + Math.max(keyword.length, 1);
  }

  return matches;
};
