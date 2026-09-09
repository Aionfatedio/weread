import type { BookInfo } from '@/store/books';
import { createEmptyTextSyntaxTree } from '@/lib/transformText';
import type { TextSyntaxTree } from '@/lib/transformText';

export interface ReaderSearchHighlight {
  hasResult: boolean;
  keyword: string;
  revision: number;
}

export interface ReaderNavigationTarget {
  blockId?: string;
  blockPageOffset?: number;
  matchStart?: number;
  page?: number;
  revision: number;
  titleId?: number;
}

export const createEmptyReaderSearchHighlight = (): ReaderSearchHighlight => ({
  hasResult: false,
  keyword: '',
  revision: 0,
});

export enum EVENT_NAME {
  CLOSE_READER_CONTROL_PANEL = 'close-reader-control-panel',
  CLOSE_MOBILE_READER_CHROME = 'close-mobile-reader-chrome',
  CLOSE_MOBILE_READER_CONTROL_PANEL_FADE = 'close-mobile-reader-control-panel-fade',
  FLUSH_READER_PROGRESS = 'flush-reader-progress',
  OPEN_READER_MENU_SEARCH = 'open-reader-menu-search',
  SET_READER_CONTROL_PANEL_ACTIVE = 'set-reader-control-panel-active',
  SET_CURRENT_BOOK_PAGE = 'set-current-book-page',
  SET_CURRENT_BOOK_DETAIL = 'set-current-book-detail',
  ADD_READER_PAGE_BOOKMARK = 'add-reader-page-bookmark',
  CLEAR_READER_PENDING_LOCATOR = 'clear-reader-pending-locator',
  SET_READER_ANNOTATIONS = 'set-reader-annotations',
  SET_READER_BOOK_STATUS = 'set-reader-book-status',
  SET_READER_NAVIGATION_TARGET = 'set-reader-navigation-target',
  SET_READER_PROGRESS = 'set-reader-progress',
  SET_READER_SEARCH_HIGHLIGHT = 'set-reader-search-highlight',
  SET_TEXT_SYNTAX_TREE = 'set-text-syntax-tree',
}

const readerEvents = new EventTarget();

export const syncHook = {
  tap: (event: EVENT_NAME, callback: () => void): void => readerEvents.addEventListener(event, callback),
  off: (event: EVENT_NAME, callback: () => void): void => readerEvents.removeEventListener(event, callback),
  call: (event: EVENT_NAME): void => {
    readerEvents.dispatchEvent(new Event(event));
  },
};

// Reference-equality signal. The ranuts createSignal deep-compares AND
// deep-clones every written value (keeping the clone alive for the next
// compare) — for signals that carry an entire book (TextSyntaxTree holds the
// full rawText plus tens of thousands of blocks) that means double-resident
// memory and a whole-tree clone on every pagination sync. Callers already
// treat these values as immutable snapshots, so reference identity is the
// correct change signal.
const createRefSignal = <T>(initial: T, subscriber: EVENT_NAME): [() => T, (next: T) => void] => {
  let current = initial;
  return [
    (): T => current,
    (next: T): void => {
      if (current === next) return;
      current = next;
      syncHook.call(subscriber);
    },
  ];
};

export const [getCurrentBookDetail, setCurrentBookDetail] = createRefSignal<BookInfo | null>(
  null,
  EVENT_NAME.SET_CURRENT_BOOK_DETAIL,
);

export const [getTextSyntaxTree, setTextSyntaxTree] = createRefSignal<TextSyntaxTree>(
  createEmptyTextSyntaxTree(),
  EVENT_NAME.SET_TEXT_SYNTAX_TREE,
);

export const [getReaderSearchHighlight, setReaderSearchHighlight] = createRefSignal<ReaderSearchHighlight>(
  createEmptyReaderSearchHighlight(),
  EVENT_NAME.SET_READER_SEARCH_HIGHLIGHT,
);

export const [getReaderNavigationTarget, setReaderNavigationTarget] = createRefSignal<ReaderNavigationTarget>(
  { revision: 0 },
  EVENT_NAME.SET_READER_NAVIGATION_TARGET,
);

export const [getPageNum, setPageNum] = createRefSignal<number>(0, EVENT_NAME.SET_CURRENT_BOOK_PAGE);

export const [getReaderControlPanelActive, setReaderControlPanelActive] = createRefSignal<boolean>(
  false,
  EVENT_NAME.SET_READER_CONTROL_PANEL_ACTIVE,
);

// Every entry point into the reader must reset these signals before
// navigating, otherwise BookDetail mounts against the previous book's tree
// and can persist that book's position under the new book's id.
export const clearReaderSignals = (): void => {
  setPageNum(0);
  setCurrentBookDetail(null);
  setReaderNavigationTarget({ revision: 0 });
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
  setTextSyntaxTree(createEmptyTextSyntaxTree());
};
