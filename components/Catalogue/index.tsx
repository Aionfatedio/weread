import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  syncHook,
} from '@/lib/subscribe';
import { SORT_DIRECTION } from '@/lib/enums';
import { getReaderProgress } from '@/lib/readerProgress';
import { getStoredReaderReadingMode } from '@/lib/readerSettings';

const SORT_ICON_STYLE = {
  '--ran-icon-font-size': '20px',
};

const toPage = (e: Event) => {
  const target = e.target as HTMLElement;
  const index = target.closest<HTMLElement>('[data-title-id]')?.dataset.titleId || '';
  const titleId = Number(index);
  if (!Number.isFinite(titleId)) return;
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const page = textSyntaxTree?.titleIdPage[index];
  setReaderNavigationTarget({ page, revision: Date.now(), titleId });
  if (page !== undefined) {
    // Fallback for browsers that don't support View Transitions API
    if (!document.startViewTransition) {
      setPageNum(page);
      return;
    }
    // With View Transition
    document.startViewTransition(() => {
      setPageNum(page);
    });
  }
  syncHook.call(EVENT_NAME.CLOSE_POPOVER);
};

const getCurrentTitleId = (bookId: string | undefined, textSyntaxTree: TextSyntaxTree): number | undefined => {
  const pageTitleId = textSyntaxTree.pageTitleId[getPageNum()] ?? textSyntaxTree.pageTitleId[0];
  const progress = getReaderProgress(bookId);
  const progressTitleId = progress?.titleId;
  const navigationTarget = getReaderNavigationTarget();
  if (getStoredReaderReadingMode() === 'scroll') {
    if (
      navigationTarget.titleId !== undefined &&
      (!progress || navigationTarget.revision >= progress.updatedAt)
    ) {
      return navigationTarget.titleId;
    }
    if (progressTitleId !== undefined) {
      return progressTitleId;
    }
  }
  return pageTitleId;
};

export const Catalogue = (): React.JSX.Element => {
  const sortRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasAlignedCurrentTitleRef = useRef(false);
  const [sortDirection, setSortDirection] = useState(SORT_DIRECTION.DOWN);
  const bookDetail: BookInfo | null = getCurrentBookDetail();
  const textSyntaxTree: TextSyntaxTree = getTextSyntaxTree();
  const [currentTitleId, setCurrentTitleId] = useState(() => getCurrentTitleId(bookDetail?.id, textSyntaxTree));

  const toSort = useCallback(() => {
    const next = sortDirection === SORT_DIRECTION.DOWN ? SORT_DIRECTION.UP : SORT_DIRECTION.DOWN;
    setSortDirection(next);
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({
      behavior: 'smooth',
      top: next === SORT_DIRECTION.UP ? container.scrollHeight : 0,
    });
  }, [sortDirection]);

  const updateCurrentTitleId = useCallback(() => {
    const nextTitleId = getCurrentTitleId(bookDetail?.id, getTextSyntaxTree());
    setCurrentTitleId((prevTitleId) => (prevTitleId === nextTitleId ? prevTitleId : nextTitleId));
  }, [bookDetail?.id]);

  const alignCurrentTitle = useCallback(() => {
    if (hasAlignedCurrentTitleRef.current || currentTitleId === undefined) return false;
    const container = scrollRef.current;
    if (!container || container.clientHeight <= 0) return false;

    const currentItem = container.querySelector<HTMLElement>(`[data-title-id="${currentTitleId}"]`);
    if (!currentItem) return false;

    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
    const targetScrollTop = currentItem.offsetTop - (container.clientHeight - currentItem.offsetHeight) / 2;
    container.scrollTo({
      behavior: 'auto',
      top: Math.min(Math.max(targetScrollTop, 0), maxScrollTop),
    });
    hasAlignedCurrentTitleRef.current = true;
    return true;
  }, [currentTitleId]);

  useEffect(() => {
    scrollRef.current?.addEventListener('click', toPage);
    sortRef.current?.addEventListener('click', toSort);
    return () => {
      scrollRef.current?.removeEventListener('click', toPage);
      sortRef.current?.removeEventListener('click', toSort);
    };
  }, [sortDirection]);

  useEffect(() => {
    updateCurrentTitleId();
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updateCurrentTitleId);
    syncHook.tap(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateCurrentTitleId);
    syncHook.tap(EVENT_NAME.SET_READER_NAVIGATION_TARGET, updateCurrentTitleId);
    syncHook.tap(EVENT_NAME.SET_READER_PROGRESS, updateCurrentTitleId);
    syncHook.tap(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateCurrentTitleId);
    return () => {
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_PAGE, updateCurrentTitleId);
      syncHook.off(EVENT_NAME.SET_CURRENT_BOOK_DETAIL, updateCurrentTitleId);
      syncHook.off(EVENT_NAME.SET_READER_NAVIGATION_TARGET, updateCurrentTitleId);
      syncHook.off(EVENT_NAME.SET_READER_PROGRESS, updateCurrentTitleId);
      syncHook.off(EVENT_NAME.SET_TEXT_SYNTAX_TREE, updateCurrentTitleId);
    };
  }, [updateCurrentTitleId]);

  useLayoutEffect(() => {
    if (alignCurrentTitle()) return;

    const frame = window.requestAnimationFrame(() => {
      alignCurrentTitle();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [alignCurrentTitle, textSyntaxTree?.sequences]);

  return (
    <>
      <div className="px-7 py-2 flex flex-row flex-nowrap items-center shrink-0">
        {bookDetail?.image && <img className="w-14 mr-5" src={bookDetail.image} />}
        <div>
          <div className="text-lg text-text-color-1 font-medium break-all">{bookDetail?.title}</div>
          <div className="text-sm text-text-color-2 font-medium mt-1 break-all">{bookDetail?.author}</div>
        </div>
      </div>
      <div className="mx-9 basis-10 flex items-center justify-end shrink-0" ref={sortRef}>
        <r-icon
          className={`cursor-pointer hover-icon rotate-180 ${sortDirection}`}
          name="sort"
          style={SORT_ICON_STYLE}
        ></r-icon>
      </div>
      <div className="overflow-y-auto flex-auto" ref={scrollRef}>
        {textSyntaxTree?.sequences?.map((item) => {
          const isCurrentTitle = item.titleId === currentTitleId;
          return (
            <div
              className={`px-7 h-12 ${
                isCurrentTitle ? 'text-brand-blue-color-1' : 'text-text-color-2'
              } font-normal text-base hover:bg-front-bg-color-2 cursor-pointer`}
              data-title-id={item.titleId}
              key={item.titleId}
            >
              <div className="border-t border-front-bg-color-1 h-full w-full flex items-center">
                {item.title}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
