import { extractBookChapters } from '@/lib/chapterSplitter';
import { CHAPTER_TITLE_END, CHAPTER_TITLE_START, arrayBufferToString } from '@/lib/transformText';
import type { ChapterTitleLevel, ReaderBlock, Sequence, TextSyntaxTree } from '@/lib/transformText';
import { t } from '@/locales';

export type ReaderBookSourceType = 'epub' | 'txt';

export interface ReaderDocumentChapter {
  id: string;
  title: string;
  html?: string;
  text: string;
  order: number;
}

export interface ReaderBookDocument {
  version: 1;
  sourceType: ReaderBookSourceType;
  title: string;
  author: string;
  cover?: string;
  chapters: ReaderDocumentChapter[];
  rawText: string;
}

const VOLUME_TITLE_UNIT_REGEX = /[\u5377\u90e8\u7bc7\u96c6]/u;

const CHAPTER_TITLE_UNIT_REGEX = /[\u7ae0\u56de\u8282\u76ee]/u;

const PARAGRAPH_BREAK_REGEX = /\n+/;

const NON_EMPTY_REGEX = /\S/;

const BLOCK_TAGS = new Set(['blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'p']);

const normalizeText = (text: string): string => text.replace(/\r\n|\r/g, '\n');

const stripCaptionTags = (value: string): string => {
  return value.replaceAll(CHAPTER_TITLE_START, '').replaceAll(CHAPTER_TITLE_END, '');
};

const stripBookExtension = (value: string): string => value.replace(/\.(?:epub|txt)$/iu, '').trim();

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

const getTrimmedBounds = (value: string): { end: number; start: number } | undefined => {
  const startMatch = NON_EMPTY_REGEX.exec(value);
  if (!startMatch) return undefined;

  let end = value.length;
  while (end > startMatch.index && /\s/.test(value[end - 1])) {
    end--;
  }

  return {
    end,
    start: startMatch.index,
  };
};

const createTextChapter = (title: string, text: string, order: number): ReaderDocumentChapter => ({
  id: `chapter-${order}`,
  order,
  text: normalizeText(stripCaptionTags(text)).trim(),
  title: title.trim() || `Chapter ${order + 1}`,
});

export const createReaderDocumentFromText = ({
  author = '',
  content,
  title,
}: {
  author?: string;
  content: ArrayBuffer | Uint8Array<ArrayBuffer>;
  title: string;
}): ReaderBookDocument => {
  const text = normalizeText(arrayBufferToString(content));
  const chapters = extractBookChapters(text).chapters;
  const documentTitle = stripBookExtension(title) || title;
  const documentChapters: ReaderDocumentChapter[] = [];

  if (chapters.length === 0) {
    documentChapters.push(createTextChapter(documentTitle, text, 0));
  } else {
    const prefaceEnd = chapters[0].start;
    if (text.slice(0, prefaceEnd).trim()) {
      documentChapters.push(createTextChapter(t('preface'), text.slice(0, prefaceEnd), documentChapters.length));
    }

    chapters.forEach((chapter) => {
      const headingEnd = getLineEnd(text, chapter.start);
      const headingText = getHeadingText(text, chapter.start, headingEnd, chapter.title);
      const bodyStart = headingEnd < text.length ? headingEnd + 1 : headingEnd;
      const bodyEnd = chapter.end ?? text.length;
      documentChapters.push(createTextChapter(headingText, text.slice(bodyStart, bodyEnd), documentChapters.length));
    });
  }

  const rawText = documentChapters.map((chapter) => `${chapter.title}\n${chapter.text}`).join('\n\n');

  return {
    author,
    chapters: documentChapters,
    rawText,
    sourceType: 'txt',
    title: documentTitle,
    version: 1,
  };
};

const getTextWithBreaks = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  if (element.tagName.toLowerCase() === 'br') return '\n';
  return Array.from(element.childNodes).map(getTextWithBreaks).join('');
};

const normalizeParagraphText = (value: string): string => {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const normalizeHeadingIdentity = (value: string): string => {
  return stripCaptionTags(value).replace(/\s+/g, '').trim();
};

const isSameHeadingText = (a: string, b: string): boolean => {
  const normalizedA = normalizeHeadingIdentity(a);
  const normalizedB = normalizeHeadingIdentity(b);
  return Boolean(normalizedA && normalizedA === normalizedB);
};

const getDirectBlockElements = (root: Element): Element[] => {
  const blocks: Element[] = [];

  const visit = (element: Element): void => {
    const tagName = element.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tagName)) {
      blocks.push(element);
      return;
    }
    Array.from(element.children).forEach(visit);
  };

  Array.from(root.children).forEach(visit);
  return blocks;
};

const hasDuplicateHtmlChapterHeading = (html: string, title: string): boolean => {
  if (typeof DOMParser === 'undefined') return false;
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const firstBlock = getDirectBlockElements(parsed.body).find((element) => {
    if (element.tagName.toLowerCase() === 'img') return true;
    return Boolean(normalizeParagraphText(getTextWithBreaks(element)));
  });
  if (!firstBlock || !/^h[1-6]$/u.test(firstBlock.tagName.toLowerCase())) return false;
  return isSameHeadingText(getTextWithBreaks(firstBlock), title);
};

const createBlocksByTitleId = (blocks: ReaderBlock[]): Map<number, ReaderBlock[]> => {
  const blocksByTitleId = new Map<number, ReaderBlock[]>();
  for (const block of blocks) {
    if (block.titleId === undefined) continue;
    const list = blocksByTitleId.get(block.titleId);
    if (list) list.push(block);
    else blocksByTitleId.set(block.titleId, [block]);
  }
  return blocksByTitleId;
};

export const readerDocumentToTextSyntaxTree = (document: ReaderBookDocument): TextSyntaxTree => {
  const blocks: ReaderBlock[] = [];
  const sequences: Sequence[] = [];
  const titleIdTitle: string[] = [];
  const titleIdPage: Record<string, number> = {};
  const titleIdBlockId: Record<string, string> = {};
  const rawParts: string[] = [];
  let rawOffset = 0;

  const appendRaw = (value: string): { end: number; start: number } => {
    const start = rawOffset;
    rawParts.push(value);
    rawOffset += value.length;
    return { end: rawOffset, start };
  };

  const appendSpacer = () => {
    if (rawOffset > 0) appendRaw('\n\n');
  };

  const addTitle = (titleText: string, blockId?: string): number => {
    const titleId = titleIdTitle.length;
    titleIdTitle.push(titleText);
    titleIdPage[titleId] = 0;
    if (blockId) titleIdBlockId[titleId] = blockId;
    sequences.push({ blockId, title: titleText, titleId });
    return titleId;
  };

  const setTitleBlock = (titleId: number, blockId?: string): void => {
    if (!blockId) return;
    titleIdBlockId[titleId] = blockId;
    const sequence = sequences.find((item) => item.titleId === titleId);
    if (sequence) sequence.blockId = blockId;
  };

  const addParagraphBlock = (text: string, titleId: number, createBlockId: () => string): ReaderBlock | undefined => {
    const normalizedText = normalizeParagraphText(stripCaptionTags(text));
    const bounds = getTrimmedBounds(normalizedText);
    if (!bounds) return undefined;
    if (rawOffset > 0 && rawParts[rawParts.length - 1] !== '\n\n') appendRaw('\n\n');
    const blockText = normalizedText.slice(bounds.start, bounds.end);
    const rawBounds = appendRaw(blockText);
    const block: ReaderBlock = {
      end: rawBounds.end,
      id: createBlockId(),
      start: rawBounds.start,
      text: blockText,
      titleId,
      type: 'paragraph',
    };
    blocks.push(block);
    return block;
  };

  const addParagraphBlocks = (text: string, titleId: number, createBlockId: () => string): ReaderBlock | undefined => {
    const normalizedText = normalizeText(text);
    let firstBlock: ReaderBlock | undefined;

    normalizedText.split(PARAGRAPH_BREAK_REGEX).forEach((segment) => {
      const block = addParagraphBlock(segment, titleId, createBlockId);
      firstBlock ||= block;
    });

    return firstBlock;
  };

  const addInlineHeadingBlock = (
    text: string,
    titleId: number,
    level: ChapterTitleLevel,
    createBlockId: () => string,
  ): ReaderBlock | undefined => {
    const normalizedText = normalizeParagraphText(text);
    if (!normalizedText) return undefined;
    if (rawOffset > 0 && rawParts[rawParts.length - 1] !== '\n\n') appendRaw('\n\n');
    const rawBounds = appendRaw(normalizedText);
    const block: ReaderBlock = {
      end: rawBounds.end,
      id: createBlockId(),
      level,
      start: rawBounds.start,
      text: normalizedText,
      titleId,
      type: 'heading',
    };
    blocks.push(block);
    return block;
  };

  const addImageBlock = (element: Element, titleId: number, createBlockId: () => string): void => {
    const src = element.getAttribute('src') || '';
    if (!src) return;
    if (rawOffset > 0 && rawParts[rawParts.length - 1] !== '\n\n') appendRaw('\n\n');
    const alt = element.getAttribute('alt') || '';
    const rawBounds = appendRaw(alt || '[image]');
    blocks.push({
      alt,
      end: rawBounds.end,
      id: createBlockId(),
      src,
      start: rawBounds.start,
      text: alt,
      titleId,
      type: 'image',
    });
  };

  const addHtmlBlocks = (
    html: string,
    titleId: number,
    title: string,
    createBlockId: () => string,
    { skipFirstDuplicateHeading = true }: { skipFirstDuplicateHeading?: boolean } = {},
  ): ReaderBlock | undefined => {
    if (typeof DOMParser === 'undefined') {
      return undefined;
    }
    const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const body = parsed.body;
    let firstBlock: ReaderBlock | undefined;
    let skippedFirstDuplicateHeading = false;

    getDirectBlockElements(body).forEach((element) => {
      const tagName = element.tagName.toLowerCase();
      if (tagName === 'img') {
        addImageBlock(element, titleId, createBlockId);
        return;
      }

      const text = normalizeParagraphText(getTextWithBreaks(element));
      if (!text) return;

      if (
        skipFirstDuplicateHeading &&
        !skippedFirstDuplicateHeading &&
        /^h[1-6]$/u.test(tagName) &&
        isSameHeadingText(text, title)
      ) {
        skippedFirstDuplicateHeading = true;
        return;
      }

      const block = /^h[1-6]$/u.test(tagName)
        ? addInlineHeadingBlock(text, titleId, 2, createBlockId)
        : addParagraphBlock(text, titleId, createBlockId);
      firstBlock ||= block;
    });

    return firstBlock;
  };

  document.chapters.forEach((chapter, chapterIndex) => {
    appendSpacer();
    const title = chapter.title.trim() || `Chapter ${chapter.order + 1}`;
    const shouldRenderSyntheticHeading = !chapter.html || !hasDuplicateHtmlChapterHeading(chapter.html, title);
    const chapterId = chapter.id || `chapter-${chapterIndex}`;
    let blockCounter = 0;
    const createBlockId = (): string => {
      const id = `${chapterId}-block-${blockCounter}`;
      blockCounter++;
      return id;
    };

    let headingId: string | undefined;
    const titleId = addTitle(title);

    if (shouldRenderSyntheticHeading) {
      const headingBounds = appendRaw(title);
      headingId = createBlockId();
      const previousBlock = blocks[blocks.length - 1];
      setTitleBlock(titleId, headingId);
      blocks.push({
        breakBefore: Boolean(previousBlock && previousBlock.type !== 'heading'),
        end: headingBounds.end,
        id: headingId,
        level: getChapterTitleLevel(title),
        start: headingBounds.start,
        text: title,
        titleId,
        type: 'heading',
      });
    }

    const firstBodyBlock = chapter.html
      ? addHtmlBlocks(chapter.html, titleId, title, createBlockId, {
          skipFirstDuplicateHeading: shouldRenderSyntheticHeading,
        })
      : undefined;
    const firstTextBlock = firstBodyBlock || addParagraphBlocks(chapter.text, titleId, createBlockId);
    setTitleBlock(titleId, firstTextBlock?.id || headingId);
  });

  const firstTitleId = titleIdTitle.length > 0 ? 0 : undefined;

  return {
    blockIdPage: {},
    blockIdPageEnd: {},
    blocks,
    blocksByTitleId: createBlocksByTitleId(blocks),
    pageTitleId: firstTitleId === undefined ? [] : [firstTitleId],
    rawText: rawParts.join(''),
    sequences,
    titleIdBlockId,
    titleIdPage,
    titleIdTitle,
    totalPage: 0,
  };
};
