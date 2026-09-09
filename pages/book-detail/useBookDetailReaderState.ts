import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { deriveScrollNavigation, loadBookDetailById } from './helpers';
import type { ScrollNavigationState } from './helpers';
import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';
import {
  EVENT_NAME,
  getCurrentBookDetail,
  getPageNum,
  getReaderNavigationTarget,
  getTextSyntaxTree,
  setPageNum,
  setReaderNavigationTarget,
} from '@/lib/subscribe';
import type { ReaderNavigationTarget } from '@/lib/subscribe';
import { debounce } from '@/lib/utils';
import { useSyncHookEvents } from '@/lib/useSyncHookEvents';
import {
  READER_SETTING_CHANGE_EVENT,
  type ReaderPageTurnEffect,
  type ReaderReadingMode,
  getStoredReaderPageTurnEffect,
  getStoredReaderReadingMode,
  getStoredReaderScrollPaddingX,
} from '@/lib/readerSettings';
import { getReaderProgress } from '@/lib/readerProgress';
import type { ReaderLocator } from '@/lib/readerProgress';
import { getReaderBookStatusRecord, setReaderBookStatus } from '@/lib/readerBookStatus';
import { getFirstTitleId, getScrollInitialTitleId, getTitlePage, isValidTitleId } from '@/lib/reader/chapterStructure';
import { useReaderReadingTimeTracker } from '@/lib/reader/useReaderReadingTimeTracker';

const BOOK_DETAIL_UI_EVENTS = [
  EVENT_NAME.SET_CURRENT_BOOK_DETAIL,
  EVENT_NAME.SET_READER_NAVIGATION_TARGET,
  EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT,
  EVENT_NAME.SET_TEXT_SYNTAX_TREE,
] as const;

const BOOK_DETAIL_PAGE_EVENTS = [EVENT_NAME.SET_CURRENT_BOOK_PAGE] as const;

export interface BookDetailReaderState {
  allowScrollAutoSave: boolean;
  bookDetail: BookInfo | null;
  effectiveScrollTitleId: number;
  isReaderReady: boolean;
  isScrollMode: boolean;
  navigateScrollTitle: (targetTitleId: number) => void;
  pageNum: number;
  pageTurnEffect: ReaderPageTurnEffect;
  readerNavigationTarget: ReaderNavigationTarget;
  readingMode: ReaderReadingMode;
  scrollNavigation: ScrollNavigationState;
  scrollPaddingX: number;
  scrollProgressLocator: ReaderLocator | undefined;
  textSyntaxTree: TextSyntaxTree;
}

// Everything the desktop and mobile reader pages share: loading the book into
// the global signals, re-rendering on signal changes, reader-setting state,
// and the scroll-mode chapter/navigation bookkeeping. The two components keep
// only their own chrome (touch handling, top bars, paged/scroll JSX).
export const useBookDetailReaderState = (
  bookId: string | undefined,
  navigate: NavigateFunction,
): BookDetailReaderState => {
  const [, update] = useState(0);
  const bookDetail: BookInfo | null = getCurrentBookDetail();
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const pageNum: number = getPageNum();
  const readerNavigationTarget = getReaderNavigationTarget();
  const [pageTurnEffect, setPageTurnEffect] = useState<ReaderPageTurnEffect>(getStoredReaderPageTurnEffect);
  const [readingMode, setReadingMode] = useState<ReaderReadingMode>(getStoredReaderReadingMode);
  const [scrollPaddingX, setScrollPaddingX] = useState<number>(getStoredReaderScrollPaddingX);
  const [scrollTitleId, setScrollTitleId] = useState<number | undefined>(undefined);

  const updateUI = useMemo(
    () =>
      debounce(() => {
        update((prev) => prev + 1);
      }, 16),
    [],
  );
  useEffect(() => () => updateUI.cancel(), [updateUI]);

  const updatePageUI = useCallback(() => {
    update((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (bookId) {
      loadBookDetailById(bookId, navigate);
    }
  }, [bookId, navigate]);

  useSyncHookEvents(BOOK_DETAIL_UI_EVENTS, updateUI);
  useSyncHookEvents(BOOK_DETAIL_PAGE_EVENTS, updatePageUI);

  useEffect(() => {
    const updateReaderSettings = () => {
      setPageTurnEffect(getStoredReaderPageTurnEffect());
      setReadingMode(getStoredReaderReadingMode());
      setScrollPaddingX(getStoredReaderScrollPaddingX());
    };
    window.addEventListener(READER_SETTING_CHANGE_EVENT, updateReaderSettings);
    return () => {
      window.removeEventListener(READER_SETTING_CHANGE_EVENT, updateReaderSettings);
    };
  }, []);

  useLayoutEffect(() => {
    if (readingMode !== 'paged') return;
    window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [readingMode]);

  useEffect(() => {
    if (readingMode !== 'scroll') return;
    setScrollTitleId(getScrollInitialTitleId(bookId, pageNum, textSyntaxTree));
  }, [
    bookId,
    pageNum,
    readingMode,
    textSyntaxTree.pageTitleId,
    textSyntaxTree.rawText,
    textSyntaxTree.sequences,
    textSyntaxTree.titleIdTitle,
  ]);

  useEffect(() => {
    if (readingMode !== 'scroll' || readerNavigationTarget.revision <= 0) return;
    const block = readerNavigationTarget.blockId
      ? textSyntaxTree.blocks.find((item) => item.id === readerNavigationTarget.blockId)
      : undefined;
    const targetTitleId = isValidTitleId(textSyntaxTree, readerNavigationTarget.titleId)
      ? readerNavigationTarget.titleId
      : block?.titleId;
    if (isValidTitleId(textSyntaxTree, targetTitleId)) {
      setScrollTitleId(targetTitleId);
    }
  }, [
    readerNavigationTarget.blockId,
    readerNavigationTarget.revision,
    readerNavigationTarget.titleId,
    readingMode,
    textSyntaxTree.blocks,
    textSyntaxTree.titleIdTitle,
  ]);

  const navigateScrollTitle = useCallback(
    (targetTitleId: number) => {
      setScrollTitleId(targetTitleId);
      const targetPage = getTitlePage(textSyntaxTree, targetTitleId);
      setReaderNavigationTarget({ page: targetPage, revision: Date.now(), titleId: targetTitleId });
      if (getPageNum() !== targetPage) {
        setPageNum(targetPage);
      }
    },
    [textSyntaxTree],
  );

  // Also require the loaded signals to belong to THIS route's book — after
  // navigating from another book the globals briefly hold the previous
  // book's tree, which must be neither rendered nor auto-saved.
  const isReaderReady =
    textSyntaxTree.rawText.length > 0 && textSyntaxTree.blocks.length > 0 && bookDetail?.id === bookId;
  useReaderReadingTimeTracker(bookId, isReaderReady, readingMode);

  // 书架状态机：导入后的书默认"未读"，首次成功进入阅读会话即转为"在读"。
  useEffect(() => {
    if (!bookId || !isReaderReady) return;
    if (!getReaderBookStatusRecord(bookId)) setReaderBookStatus(bookId, 'reading');
  }, [bookId, isReaderReady]);

  const isScrollMode = readingMode === 'scroll';
  const initialScrollTitleId = isScrollMode ? getScrollInitialTitleId(bookId, pageNum, textSyntaxTree) : undefined;
  const effectiveScrollTitleId = isValidTitleId(textSyntaxTree, scrollTitleId)
    ? scrollTitleId
    : (initialScrollTitleId ?? getFirstTitleId(textSyntaxTree));

  return {
    allowScrollAutoSave: scrollTitleId === undefined || scrollTitleId === effectiveScrollTitleId,
    bookDetail,
    effectiveScrollTitleId,
    isReaderReady,
    isScrollMode,
    navigateScrollTitle,
    pageNum,
    pageTurnEffect,
    readerNavigationTarget,
    readingMode,
    scrollNavigation: deriveScrollNavigation(readerNavigationTarget, textSyntaxTree, effectiveScrollTitleId),
    scrollPaddingX,
    scrollProgressLocator: getReaderProgress(bookId),
    textSyntaxTree,
  };
};
