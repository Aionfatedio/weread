// Pure helpers extracted from pages/book-detail/index.tsx to keep the main
// component file manageable. These functions own no React state and are safe
// to import standalone (no side effects on import).

import { type NavigateFunction, useParams } from 'react-router-dom';
import type React from 'react';
import { OcticonChevronLeft, OcticonChevronRight } from '@/components/Octicon';
import { ROUTE_PATH } from '@/router';
import { getCurrentBookDetail, getTextSyntaxTree, setCurrentBookDetail, setTextSyntaxTree } from '@/lib/subscribe';
import type { ReaderNavigationTarget } from '@/lib/subscribe';
import { resumeDB } from '@/store';
import { getBookById } from '@/store/books';
import type { BookInfo } from '@/store/books';
import type { ReaderPageTurnEffect } from '@/lib/readerSettings';
import type { TextSyntaxTree } from '@/lib/transformText';
import { isValidTitleId } from '@/lib/reader/chapterStructure';
import { getCachedTextSyntaxTree } from '@/lib/reader/textSyntaxTreeCache';

export const MOBILE_ICON_STYLE = {
  '--ran-icon-font-size': '36px',
  '--ran-icon-color': 'var(--icon-color-1)',
};

export const useReaderBookId = (): string | undefined => {
  const { bookId } = useParams<{ bookId: string }>();
  return bookId;
};

export const ReaderPagePreviousIcon = (): React.JSX.Element => <OcticonChevronLeft className="reader-page-nav-icon" />;

export const ReaderPageNextIcon = (): React.JSX.Element => <OcticonChevronRight className="reader-page-nav-icon" />;

export const hasRecordChanged = (prev: Record<string, number>, next: Record<string, number>): boolean => {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;
  return nextKeys.some((key) => prev[key] !== next[key]);
};

export const hasArrayChanged = (prev: number[], next: number[]): boolean => {
  if (prev.length !== next.length) return true;
  return next.some((value, index) => prev[index] !== value);
};

// Clamp a navigation target's page into the target block's own page span.
// Shared by the paged pending-locator path and both scroll-mode derivations.
export const resolveNavigationBlockPageOffset = (
  target: ReaderNavigationTarget,
  blockStartPage: number | undefined,
  blockEndPage: number | undefined,
): number | undefined => {
  if (typeof target.blockPageOffset === 'number' && Number.isFinite(target.blockPageOffset)) {
    return target.blockPageOffset;
  }
  if (typeof target.page === 'number' && Number.isFinite(target.page) && blockStartPage !== undefined) {
    return Math.min(
      Math.max(target.page - blockStartPage, 0),
      Math.max((blockEndPage ?? blockStartPage) - blockStartPage, 0),
    );
  }
  return undefined;
};

export interface ScrollNavigationState {
  hasActiveScrollNavigation: boolean;
  scrollTargetBlockId?: string;
  scrollTargetBlockPageOffset?: number;
  scrollTargetBlockRatio?: number;
  scrollTargetPage?: number;
}

// Scroll-mode navigation derivation shared by the desktop and mobile readers.
export const deriveScrollNavigation = (
  target: ReaderNavigationTarget,
  textSyntaxTree: TextSyntaxTree,
  effectiveScrollTitleId: number | undefined,
): ScrollNavigationState => {
  const block = target.blockId ? textSyntaxTree.blocks.find((item) => item.id === target.blockId) : undefined;
  const navigationTitleId = isValidTitleId(textSyntaxTree, target.titleId) ? target.titleId : block?.titleId;
  const hasActiveScrollNavigation = target.revision > 0 && navigationTitleId === effectiveScrollTitleId;
  if (!hasActiveScrollNavigation) return { hasActiveScrollNavigation };

  const blockStartPage = block ? textSyntaxTree.blockIdPage[block.id] : undefined;
  const blockEndPage = block ? (textSyntaxTree.blockIdPageEnd[block.id] ?? blockStartPage) : undefined;
  const hasTargetPage = typeof target.page === 'number' && Number.isFinite(target.page);
  return {
    hasActiveScrollNavigation,
    scrollTargetBlockId: target.blockId,
    scrollTargetBlockPageOffset: resolveNavigationBlockPageOffset(target, blockStartPage, blockEndPage),
    scrollTargetBlockRatio:
      block && typeof target.matchStart === 'number' && Number.isFinite(target.matchStart)
        ? Math.min(Math.max(target.matchStart / Math.max(block.text.length, 1), 0), 1)
        : undefined,
    scrollTargetPage: hasTargetPage ? target.page : undefined,
  };
};

export const runPageTurn = (effect: ReaderPageTurnEffect, update: () => void): void => {
  if (typeof document === 'undefined') {
    update();
    return;
  }

  const viewTransitionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };

  if (effect !== 'fade' || !viewTransitionDocument.startViewTransition) {
    update();
    return;
  }

  const transition = viewTransitionDocument.startViewTransition(() => {
    update();
  });
  void transition.finished.catch(() => undefined);
};

const LOAD_BOOK_DETAIL_MAX_RETRIES = 3;
const LOAD_BOOK_DETAIL_RETRY_BASE_DELAY_MS = 200;

export const loadBookDetailById = (id: string | undefined, navigate: NavigateFunction, attempt: number = 0): void => {
  if (!id) return;
  getBookById<BookInfo>(id)
    .then((res) => {
      if (res.error) {
        // Bounded retries: a corrupted IndexedDB used to spin the main thread
        // here in an infinite recursion. Cap retries and bail to /home so the
        // UI stays responsive.
        if (attempt >= LOAD_BOOK_DETAIL_MAX_RETRIES) {
          console.error('Failed to load book detail after retries:', res.message);
          navigate(ROUTE_PATH.HOME, { replace: true });
          return;
        }
        const delay = LOAD_BOOK_DETAIL_RETRY_BASE_DELAY_MS * 2 ** attempt;
        resumeDB()
          .then((resumed) => {
            if (!resumed) {
              window.setTimeout(() => loadBookDetailById(id, navigate, attempt + 1), delay);
              return;
            }
            loadBookDetailById(id, navigate, attempt + 1);
          })
          .catch(() => {
            window.setTimeout(() => loadBookDetailById(id, navigate, attempt + 1), delay);
          });
        return;
      }

      if (!res.data?.document) {
        navigate(ROUTE_PATH.HOME, { replace: true });
        return;
      }

      const currentBook = getCurrentBookDetail();
      const nextTree = getCachedTextSyntaxTree(res.data);
      const currentTree = getTextSyntaxTree();
      const bookChanged =
        currentBook?.id !== res.data.id ||
        currentBook?.modifyTime !== res.data.modifyTime ||
        currentBook?.fingerprint !== res.data.fingerprint;
      const treeChanged =
        currentTree.rawText !== nextTree.rawText ||
        currentTree.blocks !== nextTree.blocks ||
        currentTree.sequences !== nextTree.sequences;

      if (bookChanged) {
        setCurrentBookDetail(res.data);
      }
      if (treeChanged) {
        setTextSyntaxTree(nextTree);
      }
    })
    .catch((error) => {
      console.error('Failed to load book detail:', error);
      navigate(ROUTE_PATH.HOME, { replace: true });
    });
};
