/* eslint-disable regexp/no-misleading-capturing-group, regexp/no-super-linear-backtracking, regexp/no-unused-capturing-group, regexp/no-useless-non-capturing-group */

export interface DetectedChapter {
  title: string;
  start: number;
  end?: number;
  pageNum?: number;
}

export type ChapterDetectionMethod = 'caption-title' | 'smart' | 'fallback' | 'none';

export interface ChapterDetectionResult {
  method: ChapterDetectionMethod;
  chapters: DetectedChapter[];
  confidence: number;
}

type CandidateFamily = 'explicit' | 'english' | 'ordered' | 'roman' | 'numeric' | 'uppercase';

interface TextLine {
  text: string;
  trimmed: string;
  start: number;
  end: number;
  index: number;
  prevBlank: boolean;
  nextBlank: boolean;
}

interface ChapterCandidate {
  title: string;
  start: number;
  end: number;
  lineIndex: number;
  family: CandidateFamily;
  score: number;
  unit?: string;
  ordinal?: number;
}

interface SequenceEvaluation {
  family: CandidateFamily;
  candidates: ChapterCandidate[];
  confidence: number;
}

const CAPTION_TITLE_REGEX = /<caption-title>([\s\S]*?)<\/caption-title>/g;

const FULL_WIDTH_DIGIT_OFFSET = '０'.charCodeAt(0) - '0'.charCodeAt(0);

const FULL_WIDTH_DIGIT_PATTERN = '\\uFF10\\uFF11\\uFF12\\uFF13\\uFF14\\uFF15\\uFF16\\uFF17\\uFF18\\uFF19';

const DIGIT_PATTERN = `\\d${FULL_WIDTH_DIGIT_PATTERN}`;

const CJK_NUMERAL_CHARS = '零〇一二两三四五六七八九十百千万萬壹贰貳叁參肆伍陆陸柒捌玖拾佰仟亿億廿卅卌';

const NUMBER_TOKEN_PATTERN = `[${DIGIT_PATTERN}${CJK_NUMERAL_CHARS}]+`;

const TITLE_SEPARATOR_PATTERN = '\\s:：、,，.．·\\-_—';

const CJK_TITLE_REGEX = new RegExp(
  `^(?:正文|VIP|免费)?\\s*(?:第)?\\s*(${NUMBER_TOKEN_PATTERN})\\s*(章节|回目|部分|[章回节卷部篇集])(?:[${TITLE_SEPARATOR_PATTERN}]+(.{1,90})|(.{1,36}))?$`,
  'u',
);

const CJK_COMPOUND_TITLE_REGEX = new RegExp(
  `^(?:正文|VIP|免费)?\\s*(?:第)?\\s*(${NUMBER_TOKEN_PATTERN})\\s*([卷部篇集])[${TITLE_SEPARATOR_PATTERN}]*(?:第)?\\s*(${NUMBER_TOKEN_PATTERN})\\s*(章节|回目|[章回节])(?:[${TITLE_SEPARATOR_PATTERN}]+(.{1,90})|(.{1,36}))?$`,
  'u',
);

const CJK_REVERSE_TITLE_REGEX = new RegExp(
  `^([卷部篇集章回节])\\s*(${NUMBER_TOKEN_PATTERN})(?:[${TITLE_SEPARATOR_PATTERN}]+(.{1,90})|(.{1,36}))?$`,
  'u',
);

const EN_NUMBER_WORD_PATTERN =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty';

const EN_TITLE_REGEX = new RegExp(
  `^(chapter|chap|book|part|volume|vol|section|scene|act)\\s+([${DIGIT_PATTERN}]+|[ivxlcdm]+|${EN_NUMBER_WORD_PATTERN})(?:[${TITLE_SEPARATOR_PATTERN}]+(.{1,90}))?$`,
  'iu',
);

const ORDERED_CJK_TITLE_REGEX = new RegExp(`^([${CJK_NUMERAL_CHARS}]{1,10})[、.．)]\\s*(.{1,90})$`, 'u');

const ORDERED_NUMERIC_TITLE_REGEX = new RegExp(`^([${DIGIT_PATTERN}]{1,4}(?:\\.[${DIGIT_PATTERN}]{1,4}){0,3})[.)．、:：-]?\\s+(.{1,90})$`, 'u');

const STANDALONE_NUMERIC_REGEX = new RegExp(`^([${DIGIT_PATTERN}]{1,4})[.)．、]?$`, 'u');

const BRACKET_TITLE_REGEX = /^[[【（(](.{1,36})[\]】）)]$/u;

const SPECIAL_TITLE_TOKEN_PATTERN =
  '序章|楔子|引子|前言|序言|尾声|后记|跋|开篇|终章|番外|番外篇|prologue|epilogue|preface|introduction|conclusion';

const SPECIAL_TITLE_REGEX = new RegExp(
  `^(${SPECIAL_TITLE_TOKEN_PATTERN})(?:[${TITLE_SEPARATOR_PATTERN}]+(.{1,90}))?$`,
  'iu',
);

const ROMAN_LINE_REGEX = /^[ivxlcdm]{1,12}$/iu;

const UPPERCASE_TITLE_REGEX = /^(?=.{3,72}$)(?=.*[A-Z])[\dA-Z][\dA-Z '&,;:!?()_-]*$/;

const SENTENCE_TAIL_PREFIXES = [
  '只是',
  '就是',
  '关于',
  '我们',
  '他们',
  '你们',
  '我',
  '你',
  '他',
  '她',
  '它',
  '是',
  '为',
  '在',
  '中',
  '里',
  '的',
  '了',
  '和',
  '与',
  '及',
  '而',
  '但',
  '被',
  '将',
  '会',
  '说',
  '写',
  '提',
  '谈',
  '讲',
  '准备',
  '已经',
];

const SENTENCE_PUNCTUATION_REGEX = /[。！？!?；;]/u;

const SOFT_PUNCTUATION_REGEX = /[，,]/u;

const QUOTE_PREFIX_REGEX = /^[“”"'‘’]/u;

const TOC_TITLE_REGEX = /^(?:目\s*录|contents|table of contents)$/iu;

const CJK_DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  壹: 1,
  贰: 2,
  貳: 2,
  叁: 3,
  參: 3,
  肆: 4,
  伍: 5,
  陆: 6,
  陸: 6,
  柒: 7,
  捌: 8,
  玖: 9,
};

const CJK_UNIT_MAP: Record<string, number> = {
  十: 10,
  拾: 10,
  百: 100,
  佰: 100,
  千: 1000,
  仟: 1000,
  万: 10000,
  萬: 10000,
  亿: 100000000,
  億: 100000000,
};

const ENGLISH_NUMBER_MAP: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

const ROMAN_NUMERAL_MAP: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

const normalizeDigits = (value: string): string => {
  return value.replace(/[\uFF10\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18\uFF19]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_DIGIT_OFFSET);
  });
};

const toNumber = (value: string): number | undefined => {
  const normalized = normalizeDigits(value);
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return undefined;
};

const normalizeChineseNumber = (value: string): string => {
  return value.replace(/兩/g, '二').replace(/廿/g, '二十').replace(/卅/g, '三十').replace(/卌/g, '四十');
};

const parseChineseNumber = (value: string): number | undefined => {
  const digitNumber = toNumber(value);
  if (digitNumber !== undefined) return digitNumber;

  const normalized = normalizeChineseNumber(value);
  if (!/[十拾百佰千仟万萬亿億]/u.test(normalized)) {
    const digitText = Array.from(normalized)
      .map((char) => CJK_DIGIT_MAP[char])
      .join('');
    return /^\d+$/.test(digitText) ? Number.parseInt(digitText, 10) : undefined;
  }

  let total = 0;
  let section = 0;
  let current = 0;

  for (const char of normalized) {
    const digit = CJK_DIGIT_MAP[char];
    if (digit !== undefined) {
      current = digit;
      continue;
    }

    const unit = CJK_UNIT_MAP[char];
    if (!unit) return undefined;

    if (unit >= 10000) {
      section = (section + current) * unit;
      total += section;
      section = 0;
    } else {
      section += (current || 1) * unit;
    }
    current = 0;
  }

  return total + section + current;
};

const parseRomanNumber = (value: string): number | undefined => {
  const roman = value.toUpperCase();
  if (!/^(?=[IVXLCDM])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(roman)) {
    return undefined;
  }

  let total = 0;
  for (let index = 0; index < roman.length; index++) {
    const current = ROMAN_NUMERAL_MAP[roman[index]];
    const next = ROMAN_NUMERAL_MAP[roman[index + 1]] || 0;
    total += current < next ? -current : current;
  }
  return total || undefined;
};

const parseEnglishNumber = (value: string): number | undefined => {
  const normalized = value.toLowerCase();
  const digitNumber = toNumber(normalized);
  if (digitNumber !== undefined) return digitNumber;
  if (ENGLISH_NUMBER_MAP[normalized]) return ENGLISH_NUMBER_MAP[normalized];

  const romanNumber = parseRomanNumber(normalized);
  return romanNumber && romanNumber <= 300 ? romanNumber : undefined;
};

const splitTextLines = (text: string): TextLine[] => {
  const lines: TextLine[] = [];
  let start = 0;
  let lineIndex = 0;

  for (let index = 0; index <= text.length; index++) {
    if (index !== text.length && text[index] !== '\n') continue;

    const lineText = text.slice(start, index);
    lines.push({
      text: lineText,
      trimmed: lineText.trim(),
      start,
      end: index,
      index: lineIndex,
      prevBlank: true,
      nextBlank: true,
    });
    start = index + 1;
    lineIndex++;
  }

  return lines.map((line, index) => ({
    ...line,
    prevBlank: index === 0 || lines[index - 1].trimmed.length === 0,
    nextBlank: index === lines.length - 1 || lines[index + 1].trimmed.length === 0,
  }));
};

const hasLikelyMarker = (line: string): boolean => {
  const lowerLine = line.toLowerCase();
  const firstChar = normalizeDigits(line.trimStart())[0] || '';
  return (
    UPPERCASE_TITLE_REGEX.test(line.trim()) ||
    line.includes('第') ||
    line.includes('章') ||
    line.includes('回') ||
    line.includes('卷') ||
    line.includes('节') ||
    line.includes('篇') ||
    line.includes('部') ||
    line.includes('、') ||
    line.includes('【') ||
    lowerLine.includes('chapter') ||
    lowerLine.includes('part') ||
    lowerLine.includes('book') ||
    lowerLine.includes('volume') ||
    lowerLine.includes('section') ||
    /^\d$/.test(firstChar) ||
    'ivxlcdmIVXLCDM'.includes(firstChar)
  );
};

const looksLikeSentenceTail = (tail: string): boolean => {
  const trimmed = tail.trim();
  if (!trimmed) return false;
  return (
    trimmed.length > 18 ||
    SENTENCE_PUNCTUATION_REGEX.test(trimmed) ||
    SENTENCE_TAIL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  );
};

const getLineScore = (line: TextLine): number => {
  const { trimmed } = line;
  let score = 0;

  if (line.prevBlank) score += 10;
  if (line.nextBlank) score += 9;
  if (trimmed.length <= 16) score += 12;
  else if (trimmed.length <= 36) score += 8;
  else if (trimmed.length <= 64) score += 3;
  else score -= 10;

  if (SENTENCE_PUNCTUATION_REGEX.test(trimmed) && trimmed.length > 12) score -= 22;
  if (SOFT_PUNCTUATION_REGEX.test(trimmed) && trimmed.length > 24) score -= 8;
  if (QUOTE_PREFIX_REGEX.test(trimmed)) score -= 10;
  if (/^\s{2,}/.test(line.text)) score += 2;

  return score;
};

const createCandidate = (
  line: TextLine,
  family: CandidateFamily,
  title: string,
  options: {
    baseScore: number;
    ordinal?: number;
    unit?: string;
    hasSeparator?: boolean;
    hasSubtitle?: boolean;
  },
): ChapterCandidate => {
  const hasSubtitle = options.hasSubtitle ?? title.trim().length > 0;
  const hasSeparator = options.hasSeparator ?? false;
  const normalizedTitle = title.trim() || line.trimmed;
  let score = options.baseScore + getLineScore(line);

  if (hasSeparator) score += 7;
  if (hasSubtitle) score += 3;
  if (!hasSeparator && hasSubtitle && (family === 'explicit' || family === 'english')) score -= 4;

  return {
    title: normalizedTitle,
    start: line.start,
    end: line.end,
    lineIndex: line.index,
    family,
    score,
    ordinal: options.ordinal,
    unit: options.unit,
  };
};

const getSpecialCandidate = (line: TextLine): ChapterCandidate | undefined => {
  const { trimmed } = line;
  const bracketMatch = BRACKET_TITLE_REGEX.exec(trimmed);
  const title = bracketMatch?.[1] || trimmed;
  const match = SPECIAL_TITLE_REGEX.exec(title);
  if (!match) return undefined;
  const family: CandidateFamily = UPPERCASE_TITLE_REGEX.test(trimmed) ? 'uppercase' : 'explicit';

  return createCandidate(line, family, trimmed, {
    baseScore: 48,
    unit: match[1].toLowerCase(),
    hasSeparator: true,
    hasSubtitle: Boolean(match[2]?.trim()),
  });
};

const getCjkCandidate = (line: TextLine, strict: boolean): ChapterCandidate | undefined => {
  const { trimmed } = line;
  const compoundMatch = CJK_COMPOUND_TITLE_REGEX.exec(trimmed);
  if (compoundMatch) {
    const [, outerNumberText, outerUnit, innerNumberText, innerUnit, separatorTitle = '', inlineTitle = ''] = compoundMatch;
    const hasSeparator = separatorTitle.length > 0;

    if (strict && inlineTitle && looksLikeSentenceTail(inlineTitle)) return undefined;
    if (!strict && inlineTitle && inlineTitle.length > 30) return undefined;

    const outerOrdinal = parseChineseNumber(outerNumberText);
    const innerOrdinal = parseChineseNumber(innerNumberText);
    const subtitle = hasSeparator ? separatorTitle : inlineTitle;
    const compoundUnit = outerOrdinal === undefined ? `${outerUnit}:${innerUnit}` : `${outerUnit}:${outerOrdinal}:${innerUnit}`;

    return createCandidate(line, 'explicit', trimmed, {
      baseScore: strict ? 56 : 48,
      ordinal: innerOrdinal,
      unit: compoundUnit,
      hasSeparator,
      hasSubtitle: subtitle.trim().length > 0,
    });
  }

  const cjkMatch = CJK_TITLE_REGEX.exec(trimmed);
  const reverseMatch = cjkMatch ? undefined : CJK_REVERSE_TITLE_REGEX.exec(trimmed);
  const match = cjkMatch || reverseMatch;
  if (!match) return undefined;

  const numberText = cjkMatch ? match[1] : match[2];
  const unit = cjkMatch ? match[2] : match[1];
  const separatorTitle = cjkMatch ? match[3] || '' : match[3] || '';
  const inlineTitle = cjkMatch ? match[4] || '' : match[4] || '';
  const hasSeparator = separatorTitle.length > 0;

  if (strict && inlineTitle && looksLikeSentenceTail(inlineTitle)) return undefined;
  if (!strict && inlineTitle && inlineTitle.length > 30) return undefined;

  const ordinal = parseChineseNumber(numberText);
  const subtitle = hasSeparator ? separatorTitle : inlineTitle;

  return createCandidate(line, 'explicit', trimmed, {
    baseScore: strict ? 50 : 43,
    ordinal,
    unit,
    hasSeparator,
    hasSubtitle: subtitle.trim().length > 0,
  });
};

const getEnglishCandidate = (line: TextLine, strict: boolean): ChapterCandidate | undefined => {
  const match = EN_TITLE_REGEX.exec(line.trimmed);
  if (!match) return undefined;

  const [, label, numberText, subtitle = ''] = match;
  const ordinal = parseEnglishNumber(numberText);
  if (!ordinal) return undefined;

  return createCandidate(line, 'english', line.trimmed, {
    baseScore: strict ? 48 : 42,
    ordinal,
    unit: label.toLowerCase(),
    hasSeparator: subtitle.trim().length > 0,
    hasSubtitle: subtitle.trim().length > 0,
  });
};

const getOrderedCandidate = (line: TextLine): ChapterCandidate | undefined => {
  const cjkMatch = ORDERED_CJK_TITLE_REGEX.exec(line.trimmed);
  if (cjkMatch) {
    const ordinal = parseChineseNumber(cjkMatch[1]);
    return createCandidate(line, 'ordered', line.trimmed, {
      baseScore: 36,
      ordinal,
      unit: 'ordered',
      hasSeparator: true,
      hasSubtitle: true,
    });
  }

  const numberMatch = ORDERED_NUMERIC_TITLE_REGEX.exec(line.trimmed);
  if (!numberMatch) return undefined;
  const ordinal = toNumber(numberMatch[1].split('.')[0]);
  if (!ordinal) return undefined;

  return createCandidate(line, 'ordered', line.trimmed, {
    baseScore: 34,
    ordinal,
    unit: 'ordered',
    hasSeparator: true,
    hasSubtitle: true,
  });
};

const getRomanCandidate = (line: TextLine): ChapterCandidate | undefined => {
  const { trimmed } = line;
  if (!ROMAN_LINE_REGEX.test(trimmed) || trimmed !== trimmed.toUpperCase()) return undefined;
  const ordinal = parseRomanNumber(trimmed);
  if (!ordinal || ordinal > 300) return undefined;

  return createCandidate(line, 'roman', trimmed, {
    baseScore: 34,
    ordinal,
    unit: 'roman',
    hasSeparator: true,
  });
};

const getNumericCandidate = (line: TextLine): ChapterCandidate | undefined => {
  const match = STANDALONE_NUMERIC_REGEX.exec(line.trimmed);
  if (!match) return undefined;
  const ordinal = toNumber(match[1]);
  if (!ordinal || ordinal > 9999) return undefined;

  return createCandidate(line, 'numeric', line.trimmed, {
    baseScore: 30,
    ordinal,
    unit: 'number',
    hasSeparator: true,
  });
};

const getUppercaseCandidate = (line: TextLine): ChapterCandidate | undefined => {
  const { trimmed } = line;
  if (!UPPERCASE_TITLE_REGEX.test(trimmed)) return undefined;
  if (['END', 'THE END'].includes(trimmed)) return undefined;
  if (trimmed.includes('.')) return undefined;
  if (!line.prevBlank && !line.nextBlank) return undefined;

  return createCandidate(line, 'uppercase', trimmed, {
    baseScore: 34,
    unit: 'uppercase',
    hasSeparator: true,
  });
};

const collectCandidates = (text: string, strict: boolean): ChapterCandidate[] => {
  const lines = splitTextLines(text);
  const candidates: ChapterCandidate[] = [];

  lines.forEach((line) => {
    if (!line.trimmed || line.trimmed.length > 140 || !hasLikelyMarker(line.trimmed)) return;

    const explicitCandidate = getSpecialCandidate(line) || getCjkCandidate(line, strict);
    if (explicitCandidate) {
      candidates.push(explicitCandidate);
      return;
    }

    const englishCandidate = getEnglishCandidate(line, strict);
    if (englishCandidate) {
      candidates.push(englishCandidate);
      return;
    }

    const orderedCandidate = getOrderedCandidate(line);
    if (orderedCandidate) {
      candidates.push(orderedCandidate);
      return;
    }

    const romanCandidate = getRomanCandidate(line);
    if (romanCandidate) {
      candidates.push(romanCandidate);
      return;
    }

    const numericCandidate = getNumericCandidate(line);
    if (numericCandidate) {
      candidates.push(numericCandidate);
      return;
    }

    const uppercaseCandidate = getUppercaseCandidate(line);
    if (uppercaseCandidate) candidates.push(uppercaseCandidate);
  });

  return candidates;
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const getUnitRank = (unit?: string): number => {
  if (!unit) return 2;
  const normalizedUnit = unit.toLowerCase();
  if (['卷', '部', '篇', '集', '部分', 'book', 'part', 'volume', 'vol'].includes(normalizedUnit)) return 1;
  if (['节', 'section', 'scene', 'act'].includes(normalizedUnit)) return 3;
  return 2;
};

const isAdjacentChildHeading = (previous: ChapterCandidate, current: ChapterCandidate): boolean => {
  const distance = current.start - previous.start;
  if (distance <= 0 || distance > 180) return false;
  if (previous.family !== current.family) return false;
  return getUnitRank(previous.unit) < getUnitRank(current.unit);
};

const isNearTocCluster = (candidate: ChapterCandidate, familyCandidates: ChapterCandidate[], textLength: number): boolean => {
  if (textLength < 5000) return false;
  if (candidate.start > Math.min(textLength * 0.2, 30000)) return false;

  const cluster = familyCandidates.filter((item) => Math.abs(item.start - candidate.start) <= 1800);
  if (cluster.length < 6) return false;

  const starts = cluster.map((item) => item.start).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  return starts[starts.length - 1] - starts[0] <= 2200 && median(gaps) < 260;
};

const isNearTocTitle = (candidate: ChapterCandidate, familyCandidates: ChapterCandidate[], text: string): boolean => {
  if (text.length < 5000) return false;
  if (candidate.start > Math.min(text.length * 0.18, 24000)) return false;

  const previousText = text.slice(Math.max(0, candidate.start - 1200), candidate.start);
  const hasTocTitle = previousText
    .split('\n')
    .slice(-18)
    .some((line) => TOC_TITLE_REGEX.test(line.trim()));
  if (!hasTocTitle) return false;

  const nearbyCount = familyCandidates.filter((item) => item.start >= candidate.start && item.start - candidate.start < 6000).length;
  return nearbyCount >= 3;
};

const removeTocLikeCandidates = (
  candidates: ChapterCandidate[],
  familyCandidates: ChapterCandidate[],
  text: string,
): ChapterCandidate[] => {
  return candidates.filter((candidate) => {
    return !isNearTocCluster(candidate, familyCandidates, text.length) && !isNearTocTitle(candidate, familyCandidates, text);
  });
};

const hasHigherLevelBoundaryBetween = (
  candidates: ChapterCandidate[],
  previous: ChapterCandidate,
  current: ChapterCandidate,
): boolean => {
  const currentRank = getUnitRank(current.unit);
  return candidates.some((candidate) => {
    return candidate.start > previous.start && candidate.start < current.start && getUnitRank(candidate.unit) < currentRank;
  });
};

const getFamilyMinScore = (family: CandidateFamily, strict: boolean): number => {
  if (family === 'explicit') return strict ? 46 : 40;
  if (family === 'english') return strict ? 44 : 40;
  if (family === 'ordered') return 43;
  if (family === 'uppercase') return 45;
  return 42;
};

const selectSequenceCandidates = (
  candidates: ChapterCandidate[],
  text: string,
  family: CandidateFamily,
  strict: boolean,
): ChapterCandidate[] => {
  const familyCandidates = candidates
    .filter((candidate) => candidate.family === family)
    .sort((a, b) => a.start - b.start);
  let preparedCandidates = removeTocLikeCandidates(
    familyCandidates.filter((candidate) => candidate.score >= getFamilyMinScore(family, strict)),
    familyCandidates,
    text,
  );
  if (
    family === 'uppercase' &&
    text.length >= 3000 &&
    preparedCandidates.length >= 3 &&
    preparedCandidates[0].start < 800 &&
    preparedCandidates[1].start - preparedCandidates[0].start < 1000 &&
    preparedCandidates[0].title !== preparedCandidates[1].title
  ) {
    preparedCandidates = preparedCandidates.slice(1);
  }
  const selected: ChapterCandidate[] = [];
  const lastOrdinalByUnit = new Map<string, number>();
  const lastCandidateByUnit = new Map<string, ChapterCandidate>();
  const previousByUnitOrdinal = new Map<string, ChapterCandidate>();
  const minAdjacentDistance = text.length < 3000 ? 0 : 140;

  const rememberCandidate = (candidate: ChapterCandidate): void => {
    const unit = candidate.unit || family;
    if (candidate.ordinal !== undefined) {
      lastOrdinalByUnit.set(unit, candidate.ordinal);
      lastCandidateByUnit.set(unit, candidate);
      previousByUnitOrdinal.set(`${unit}:${candidate.ordinal}`, candidate);
    }
  };

  preparedCandidates.forEach((candidate) => {
    const unit = candidate.unit || family;
    const duplicateKey = candidate.ordinal === undefined ? '' : `${unit}:${candidate.ordinal}`;
    const previousDuplicate = duplicateKey ? previousByUnitOrdinal.get(duplicateKey) : undefined;

    if (previousDuplicate && !hasHigherLevelBoundaryBetween(selected, previousDuplicate, candidate)) {
      const previousLooksEarly =
        previousDuplicate.start < Math.min(text.length * 0.12, 18000) && candidate.start - previousDuplicate.start > 500;
      if (candidate.score > previousDuplicate.score + 8 || previousLooksEarly) {
        const duplicateIndex = selected.indexOf(previousDuplicate);
        if (duplicateIndex !== -1) selected[duplicateIndex] = candidate;
        previousByUnitOrdinal.set(duplicateKey, candidate);
      }
      return;
    }

    const lastOrdinal = lastOrdinalByUnit.get(unit);
    const previousSameUnit = lastCandidateByUnit.get(unit);
    const ordinalDelta =
      candidate.ordinal !== undefined && lastOrdinal !== undefined ? candidate.ordinal - lastOrdinal : undefined;
    let hasOrdinalResetBoundary = false;
    if (candidate.ordinal !== undefined && lastOrdinal !== undefined && candidate.ordinal < lastOrdinal) {
      if (!previousSameUnit || !hasHigherLevelBoundaryBetween(selected, previousSameUnit, candidate)) return;
      hasOrdinalResetBoundary = true;
    }

    const previous = selected[selected.length - 1];
    const isOrdinalContinuation =
      previousSameUnit === previous && ordinalDelta !== undefined && ordinalDelta > 0 && ordinalDelta <= 8;
    if (previous && minAdjacentDistance > 0 && candidate.start - previous.start < minAdjacentDistance) {
      if (hasOrdinalResetBoundary || isOrdinalContinuation) {
        selected.push(candidate);
        rememberCandidate(candidate);
        return;
      }
      if (isAdjacentChildHeading(previous, candidate)) {
        selected.push(candidate);
        rememberCandidate(candidate);
        return;
      }
      if (candidate.score > previous.score + 10 || (candidate.start < 800 && candidate.score >= previous.score - 4)) {
        selected[selected.length - 1] = candidate;
      }
      return;
    }

    selected.push(candidate);
    rememberCandidate(candidate);
  });

  return selected;
};

const getOrdinalConsistency = (candidates: ChapterCandidate[]): number => {
  const ordinalCandidates = candidates.filter((candidate) => candidate.ordinal !== undefined);
  if (ordinalCandidates.length < 2) return candidates.length >= 2 ? 6 : 0;

  let checked = 0;
  let valid = 0;
  const lastByUnit = new Map<string, number>();

  ordinalCandidates.forEach((candidate) => {
    const unit = candidate.unit || candidate.family;
    const previous = lastByUnit.get(unit);
    if (previous !== undefined) {
      checked++;
      const delta = candidate.ordinal! - previous;
      if (delta >= 0 && delta <= 8) valid++;
    }
    lastByUnit.set(unit, candidate.ordinal!);
  });

  if (checked === 0) return 8;
  return (valid / checked) * 18;
};

const evaluateSequence = (
  candidates: ChapterCandidate[],
  text: string,
  family: CandidateFamily,
  strict: boolean,
): SequenceEvaluation => {
  const selected = selectSequenceCandidates(candidates, text, family, strict);
  if (selected.length === 0) {
    return { family, candidates: [], confidence: 0 };
  }

  const starts = selected.map((candidate) => candidate.start);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  const isShortText = text.length < 3000;
  const medianGap = median(gaps);
  const averageScore = selected.reduce((sum, candidate) => sum + candidate.score, 0) / selected.length;
  const countScore = Math.min(selected.length * 4, 28);
  const gapScore = selected.length <= 1 ? 0 : isShortText ? 8 : medianGap >= 800 ? 14 : medianGap >= 260 ? 8 : -8;
  const shortGapPenalty = isShortText ? 0 : gaps.filter((gap) => gap < 180).length * 5;
  const ordinalScore = getOrdinalConsistency(selected);
  const familyPenalty = family === 'explicit' || family === 'english' ? 0 : 8;
  const confidence = Math.max(
    0,
    Math.min(100, averageScore * 0.7 + countScore + gapScore + ordinalScore - shortGapPenalty - familyPenalty),
  );

  return {
    family,
    candidates: selected,
    confidence,
  };
};

const isAcceptedSequence = (evaluation: SequenceEvaluation): boolean => {
  const { family, candidates, confidence } = evaluation;
  if (family === 'explicit' || family === 'english') {
    if (candidates.length >= 3) return confidence >= 54;
    if (candidates.length === 2) return confidence >= 62;
    return confidence >= 84;
  }
  if (candidates.length < 3) return false;
  return confidence >= 62;
};

const toDetectedChapters = (candidates: ChapterCandidate[], textLength: number): DetectedChapter[] => {
  return candidates.map((candidate, index) => {
    const next = candidates[index + 1];
    return {
      title: candidate.title,
      start: candidate.start,
      end: next ? next.start : textLength,
    };
  });
};

const detectByCandidates = (
  text: string,
  strict: boolean,
  allowedFamilies: CandidateFamily[],
): SequenceEvaluation | undefined => {
  const candidates = collectCandidates(text, strict);
  const evaluations = allowedFamilies
    .map((family) => evaluateSequence(candidates, text, family, strict))
    .filter(isAcceptedSequence)
    .sort((a, b) => b.confidence - a.confidence);

  return evaluations[0];
};

export const extractCaptionTitleChapters = (text: string): DetectedChapter[] => {
  const chapters: DetectedChapter[] = [];
  let match: RegExpExecArray | null;

  CAPTION_TITLE_REGEX.lastIndex = 0;
  while ((match = CAPTION_TITLE_REGEX.exec(text)) !== null) {
    chapters.push({
      title: match[1].trim(),
      start: match.index,
    });
  }

  return chapters.map((chapter, index) => {
    const nextChapter = chapters[index + 1];
    return {
      ...chapter,
      end: nextChapter ? nextChapter.start : text.length,
    };
  });
};

export const extractBookChapters = (text: string): ChapterDetectionResult => {
  const nativeChapters = extractCaptionTitleChapters(text);
  if (nativeChapters.length > 0) {
    return {
      method: 'caption-title',
      chapters: nativeChapters,
      confidence: 100,
    };
  }

  const smartEvaluation = detectByCandidates(text, true, ['explicit', 'english', 'ordered', 'roman', 'numeric', 'uppercase']);
  if (smartEvaluation) {
    return {
      method: 'smart',
      chapters: toDetectedChapters(smartEvaluation.candidates, text.length),
      confidence: smartEvaluation.confidence,
    };
  }

  const fallbackEvaluation = detectByCandidates(text, false, ['explicit', 'english', 'ordered']);
  if (fallbackEvaluation) {
    return {
      method: 'fallback',
      chapters: toDetectedChapters(fallbackEvaluation.candidates, text.length),
      confidence: fallbackEvaluation.confidence,
    };
  }

  return {
    method: 'none',
    chapters: [],
    confidence: 0,
  };
};
