import jschardet from 'jschardet';
import { t } from '@/locales';
import { extractBookChapters } from '@/lib/chapterSplitter';

export interface TransformText {
  encoding: string;
  content: string;
}

export type ReaderBlockType = 'heading' | 'paragraph';

export type ChapterTitleLevel = 1 | 2;

export interface ReaderBlock {
  id: string;
  type: ReaderBlockType;
  text: string;
  start: number;
  end: number;
  breakBefore?: boolean;
  level?: ChapterTitleLevel;
  titleId?: number;
}

export interface Sequence {
  title: string;
  titleId: number;
  blockId?: string;
}

export interface TextSyntaxTree {
  sequences: Sequence[];
  totalPage: number;
  pageTitleId: number[];
  titleIdTitle: string[];
  titleIdPage: Record<string, number>;
  titleIdBlockId: Record<string, string>;
  blockIdPage: Record<string, number>;
  blockIdPageEnd: Record<string, number>;
  blocks: ReaderBlock[];
  blocksByTitleId: Map<number, ReaderBlock[]>;
  rawText: string;
}

export const CHAPTER_TITLE_START = '<caption-title>';

export const CHAPTER_TITLE_END = '</caption-title>';

export const CHAPTER_TITLE_CONTENT = '*';

const VOLUME_TITLE_UNIT_REGEX = /[\u5377\u90e8\u7bc7\u96c6]/u;

const CHAPTER_TITLE_UNIT_REGEX = /[\u7ae0\u56de\u8282\u76ee]/u;

const PARAGRAPH_BREAK_REGEX = /\n+/g;

const NON_EMPTY_REGEX = /\S/;

export const createEmptyTextSyntaxTree = (): TextSyntaxTree => ({
  sequences: [],
  totalPage: 0,
  pageTitleId: [],
  titleIdTitle: [],
  titleIdPage: {},
  titleIdBlockId: {},
  blockIdPage: {},
  blockIdPageEnd: {},
  blocks: [],
  blocksByTitleId: new Map(),
  rawText: '',
});

export const transformText = (content: string | ArrayBuffer): TransformText | undefined => {
  if (content instanceof ArrayBuffer) {
    const uint8Array = new Uint8Array(content);
    const asciiString = String.fromCharCode.apply(null, uint8Array as unknown as number[]);
    const detected = jschardet.detect(asciiString);
    const encoding = detected.encoding || 'utf-8';
    const text = new TextDecoder(encoding).decode(content);
    if (detected.encoding && text) {
      return {
        encoding: detected.encoding,
        content: text,
      };
    }
  } else {
    console.error('Unexpected result type:', typeof content);
  }
};

export const arrayBufferToString = (arrayBuffer: ArrayBuffer | Uint8Array<ArrayBuffer>): string => {
  const uint8Array = new Uint8Array(arrayBuffer);
  const encoding = checkEncoding(uint8Array);
  const textDecoder = new TextDecoder(encoding);
  return textDecoder.decode(uint8Array);
};

export const checkEncoding = (uint8Array: Uint8Array): string => {
  const sampleSize = Math.min(uint8Array.length, 8192);
  const chunkSize = 0x8000;
  let asciiString = '';
  for (let offset = 0; offset < sampleSize; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, sampleSize);
    asciiString += String.fromCharCode.apply(
      null,
      uint8Array.subarray(offset, end) as unknown as number[],
    );
  }
  const detected = jschardet.detect(asciiString);
  return detected.encoding || 'utf-8';
};

export const createReader = (file: File): Promise<Uint8Array<ArrayBuffer>> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = () => {
      if (reader.result) {
        const uint8Array = new Uint8Array(reader.result as ArrayBuffer);
        resolve(uint8Array);
      }
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.onabort = (abort) => {
      reject(abort);
    };
  });
};

export const getFontSize = (): number => {
  return 1.125;
};

export const trim = (value: unknown): string => {
  return value == null ? '' : String(value).trim();
};

const normalizeText = (text: string): string => {
  return text.replace(/\r\n|\r/g, '\n');
};

const stripCaptionTags = (value: string): string => {
  return value.replaceAll(CHAPTER_TITLE_START, '').replaceAll(CHAPTER_TITLE_END, '');
};

const getChapterTitleLevel = (title: string): ChapterTitleLevel => {
  const normalizedTitle = title.replace(/\s+/g, '');
  if (VOLUME_TITLE_UNIT_REGEX.test(normalizedTitle) && !CHAPTER_TITLE_UNIT_REGEX.test(normalizedTitle)) {
    return 2;
  }
  return 1;
};

const getLineEnd = (text: string, start: number): number => {
  const lineEnd = text.indexOf('\n', start);
  return lineEnd === -1 ? text.length : lineEnd;
};

const getHeadingText = (text: string, start: number, end: number, fallbackTitle: string): string => {
  const lineText = stripCaptionTags(text.slice(start, end)).trim();
  return lineText || fallbackTitle.trim();
};

const getTrimmedBounds = (value: string): { start: number; end: number } | undefined => {
  const startMatch = NON_EMPTY_REGEX.exec(value);
  if (!startMatch) return undefined;

  let end = value.length;
  while (end > startMatch.index && /\s/.test(value[end - 1])) {
    end--;
  }

  return {
    start: startMatch.index,
    end,
  };
};

const appendParagraphBlock = (
  blocks: ReaderBlock[],
  text: string,
  start: number,
  end: number,
  titleId?: number,
): ReaderBlock | undefined => {
  const rawValue = stripCaptionTags(text.slice(start, end));
  const bounds = getTrimmedBounds(rawValue);
  if (!bounds) return undefined;

  const id = `block-${blocks.length}`;
  const block: ReaderBlock = {
    id,
    type: 'paragraph',
    text: rawValue.slice(bounds.start, bounds.end),
    start: start + bounds.start,
    end: start + bounds.end,
    titleId,
  };
  blocks.push(block);
  return block;
};

const appendParagraphBlocks = (
  blocks: ReaderBlock[],
  text: string,
  start: number,
  end: number,
  titleId?: number,
): ReaderBlock | undefined => {
  if (end <= start) return undefined;

  let firstBlock: ReaderBlock | undefined;
  let segmentStart = start;
  PARAGRAPH_BREAK_REGEX.lastIndex = start;

  while (true) {
    const match = PARAGRAPH_BREAK_REGEX.exec(text);
    if (!match || match.index >= end) break;

    const block = appendParagraphBlock(blocks, text, segmentStart, match.index, titleId);
    firstBlock ||= block;
    segmentStart = Math.min(match.index + match[0].length, end);
  }

  const block = appendParagraphBlock(blocks, text, segmentStart, end, titleId);
  firstBlock ||= block;
  return firstBlock;
};

export const transformTextToExpectedFormat = ({
  content,
  title,
}: {
  content: ArrayBuffer | Uint8Array<ArrayBuffer>;
  title: string;
}): TextSyntaxTree => {
  const text = normalizeText(arrayBufferToString(content));
  const chapters = extractBookChapters(text).chapters;
  const blocks: ReaderBlock[] = [];
  const sequences: Sequence[] = [];
  const titleIdTitle: string[] = [];
  const titleIdPage: Record<string, number> = {};
  const titleIdBlockId: Record<string, string> = {};
  let cursor = 0;
  let activeTitleId: number | undefined;

  const addTitle = (titleText: string, blockId?: string): number => {
    const titleId = titleIdTitle.length;
    titleIdTitle.push(titleText);
    titleIdPage[titleId] = 0;
    if (blockId) {
      titleIdBlockId[titleId] = blockId;
    }
    sequences.push({ title: titleText, titleId, blockId });
    return titleId;
  };

  const setTitleBlock = (titleId: number, blockId?: string): void => {
    if (!blockId) return;
    titleIdBlockId[titleId] = blockId;
    const sequence = sequences.find((item) => item.titleId === titleId);
    if (sequence) sequence.blockId = blockId;
  };

  const linkEmptyHeadingTitles = (): void => {
    const blocksByTitleId = new Map<number, ReaderBlock[]>();
    for (const block of blocks) {
      if (block.titleId === undefined) continue;
      const list = blocksByTitleId.get(block.titleId);
      if (list) list.push(block);
      else blocksByTitleId.set(block.titleId, [block]);
    }

    const isAllHeading = (list: ReaderBlock[] | undefined): boolean => {
      return Boolean(list && list.length > 0 && list.every((block) => block.type === 'heading'));
    };

    sequences.forEach((sequence, index) => {
      const currentBlocks = blocksByTitleId.get(sequence.titleId);
      if (!isAllHeading(currentBlocks)) return;

      let previousEnd = currentBlocks![currentBlocks!.length - 1].end;
      for (let i = index + 1; i < sequences.length; i++) {
        const nextBlocks = blocksByTitleId.get(sequences[i].titleId);
        const nextFirstBlock = nextBlocks?.[0];
        if (!nextFirstBlock) continue;
        if (text.slice(previousEnd, nextFirstBlock.start).trim()) return;

        if (isAllHeading(nextBlocks)) {
          previousEnd = nextBlocks![nextBlocks!.length - 1].end;
          continue;
        }

        setTitleBlock(sequence.titleId, nextFirstBlock.id);
        return;
      }
    });
  };

  if (chapters.length === 0) {
    activeTitleId = addTitle(title);
    const firstBlock = appendParagraphBlocks(blocks, text, 0, text.length, activeTitleId);
    setTitleBlock(activeTitleId, firstBlock?.id);
  } else {
    const prefaceEnd = chapters[0].start;
    if (text.slice(0, prefaceEnd).trim()) {
      activeTitleId = addTitle(t('preface'));
      const firstBlock = appendParagraphBlocks(blocks, text, 0, prefaceEnd, activeTitleId);
      setTitleBlock(activeTitleId, firstBlock?.id);
    }
    cursor = prefaceEnd;

    chapters.forEach((chapter) => {
      if (cursor < chapter.start) {
        appendParagraphBlocks(blocks, text, cursor, chapter.start, activeTitleId);
      }

      const headingEnd = getLineEnd(text, chapter.start);
      const headingText = getHeadingText(text, chapter.start, headingEnd, chapter.title);
      const headingId = `block-${blocks.length}`;
      const previousBlock = blocks[blocks.length - 1];
      activeTitleId = addTitle(headingText, headingId);
      blocks.push({
        id: headingId,
        type: 'heading',
        text: headingText,
        start: chapter.start,
        end: headingEnd,
        breakBefore: Boolean(previousBlock && previousBlock.type !== 'heading'),
        level: getChapterTitleLevel(headingText),
        titleId: activeTitleId,
      });
      cursor = headingEnd < text.length ? headingEnd + 1 : headingEnd;
    });

    appendParagraphBlocks(blocks, text, cursor, text.length, activeTitleId);
    linkEmptyHeadingTitles();
  }

  const firstTitleId = titleIdTitle.length > 0 ? 0 : undefined;

  const blocksByTitleId = new Map<number, ReaderBlock[]>();
  for (const block of blocks) {
    if (block.titleId === undefined) continue;
    const list = blocksByTitleId.get(block.titleId);
    if (list) list.push(block);
    else blocksByTitleId.set(block.titleId, [block]);
  }

  return {
    sequences,
    totalPage: 0,
    pageTitleId: firstTitleId === undefined ? [] : [firstTitleId],
    titleIdTitle,
    titleIdPage,
    titleIdBlockId,
    blockIdPage: {},
    blockIdPageEnd: {},
    blocks,
    blocksByTitleId,
    rawText: text,
  };
};
