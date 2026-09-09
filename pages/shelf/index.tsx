import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Link, useHref, useNavigate } from 'react-router-dom';
import { BookCoverFallback, getBookProgressLabel } from '@/components/BookCard';
import { Loading } from '@/components/Loading';
import { OcticonXCircle as ShelfSearchClearIcon, OcticonSearch as ShelfSearchIcon } from '@/components/Octicon';
import { ROUTE_PATH, createReaderPath } from '@/router';
import { getAllBooks } from '@/store/books';
import type { BookSummary } from '@/store/books';
import { resumeDB } from '@/store';
import { startSpaViewTransition } from '@/lib/navigation';
import {
  type ReaderBookShelfStatus,
  getReaderBookShelfStatus,
  useReaderBookStatusRevision,
} from '@/lib/readerBookStatus';
import { getBookRecentTimestamp } from '@/lib/readerProgress';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import { ImportCard, ImportConflictDialog, SearchResultsPanel, useBookSearch, useHomeBookImport } from '@/pages/home';
import { clearReaderSignals } from '@/lib/subscribe';
import { t } from '@/locales';
import './index.scss';

const MAX_SHELF_BOOK_LOAD_RETRIES = 3;

type ShelfStatusFilterValue = 'all' | ReaderBookShelfStatus;

const SHELF_STATUS_FILTER_OPTIONS: Array<{ id: ShelfStatusFilterValue; labelKey: string }> = [
  { id: 'all', labelKey: 'shelf.all' },
  { id: 'unread', labelKey: 'shelf.unread' },
  { id: 'reading', labelKey: 'shelf.reading' },
  { id: 'read', labelKey: 'shelf.read' },
  { id: 'finished', labelKey: 'shelf.finished' },
];

const ShelfFilterIcon = (): React.JSX.Element => (
  <svg aria-hidden="true" fill="none" focusable="false" height="14" viewBox="0 0 16 16" width="14">
    <path
      d="M2 4.25h12M4.5 8h7M6.75 11.75h2.5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);

const sortShelfBooks = (books: BookSummary[]): BookSummary[] => {
  return [...books].sort((a, b) => getBookRecentTimestamp(b) - getBookRecentTimestamp(a));
};

const useShelfBooks = (): {
  books: BookSummary[];
  loading: boolean;
  setBooks: Dispatch<SetStateAction<BookSummary[]>>;
} => {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const setSortedBooks = useCallback<Dispatch<SetStateAction<BookSummary[]>>>((value) => {
    setBooks((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      return sortShelfBooks(next);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBooks = async (): Promise<void> => {
      let attempts = 0;
      while (attempts < MAX_SHELF_BOOK_LOAD_RETRIES) {
        const result = await getAllBooks();
        if (!result.error) {
          if (!cancelled) {
            setSortedBooks(result.data);
            setLoading(false);
          }
          return;
        }
        attempts += 1;
        // resumeDB never rejects; a false result is retried by the loop.
        await resumeDB();
      }
      if (!cancelled) {
        setBooks([]);
        setLoading(false);
      }
    };

    void loadBooks();
    return () => {
      cancelled = true;
    };
  }, []);

  return { books, loading, setBooks: setSortedBooks };
};

const ShelfStatusFilter = ({
  onChange,
  value,
}: {
  onChange: (value: ShelfStatusFilterValue) => void;
  value: ShelfStatusFilterValue;
}): React.JSX.Element => {
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLabel = SHELF_STATUS_FILTER_OPTIONS.find((option) => option.id === value)?.labelKey || '';

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) return;
      setIsExpanded(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`shelf-status-filter ${isExpanded ? 'is-expanded' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setIsExpanded(false);
          containerRef.current?.querySelector<HTMLButtonElement>('.shelf-status-filter-trigger')?.focus();
        }
      }}
    >
      <button
        aria-expanded={isExpanded}
        aria-controls="shelf-status-options"
        aria-label={t('shelf.filter')}
        className="shelf-status-filter-trigger"
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
      >
        <span>{t(currentLabel)}</span>
        <ShelfFilterIcon />
      </button>
      <div
        id="shelf-status-options"
        className="shelf-status-filter-options"
        role="group"
        aria-label={t('shelf.filter')}
        inert={!isExpanded}
      >
        {SHELF_STATUS_FILTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            aria-pressed={value === option.id}
            className={`shelf-status-filter-option ${value === option.id ? 'is-active' : ''}`}
            type="button"
            onClick={() => {
              onChange(option.id);
              setIsExpanded(false);
              containerRef.current?.querySelector<HTMLButtonElement>('.shelf-status-filter-trigger')?.focus();
            }}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
};

const ShelfBookItem = ({ book }: { book: BookSummary }): React.JSX.Element => {
  const navigate = useNavigate();
  const { id, image, title = '' } = book;
  const resolvedImage = useResolvedBookImage(id, image);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(resolvedImage && !imageFailed);
  const path = createReaderPath(id);
  const href = useHref(path);

  useEffect(() => {
    setImageFailed(false);
  }, [id, image]);

  const openBook = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      startSpaViewTransition(() => {
        clearReaderSignals();
        navigate(path);
      });
    },
    [navigate, path],
  );

  return (
    <a
      className="shelf-book-item"
      aria-label={`${title} · ${getBookProgressLabel(id)}`}
      href={href}
      style={{ viewTransitionName: `book-info-${id}` }}
      onClick={openBook}
    >
      <div className="shelf-book-cover">
        {shouldShowImage ? (
          <img src={resolvedImage} alt={title} onError={() => setImageFailed(true)} />
        ) : (
          <BookCoverFallback className="shelf-book-cover-fallback" title={title} />
        )}
      </div>
      <div className="shelf-book-title" title={title}>
        {title}
      </div>
    </a>
  );
};

export const Shelf = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { books, loading, setBooks } = useShelfBooks();
  const searchState = useBookSearch(inputRef);
  const { conflictState, onAdd, onCancelConflict, onConfirmConflict } = useHomeBookImport(books, setBooks);
  const [searchDraft, setSearchDraft] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShelfStatusFilterValue>('all');
  const statusRevision = useReaderBookStatusRevision();
  const isSearchExpanded = Boolean(searchDraft);
  const { clearSearch } = searchState;
  const clearShelfSearch = useCallback(() => {
    clearSearch();
    setSearchDraft('');
  }, [clearSearch]);
  const visibleBooks = useMemo(() => {
    if (statusFilter === 'all') return books;
    return books.filter((book) => getReaderBookShelfStatus(book.id) === statusFilter);
  }, [books, statusFilter, statusRevision]);

  return (
    <div className="shelf-page">
      <header className={`shelf-navbar ${isSearchExpanded ? 'is-searching' : ''}`}>
        <div className="shelf-navbar-border">
          <div className="shelf-navbar-inner">
            <Link className="shelf-brand" to={ROUTE_PATH.HOME} aria-label={t('home')}>
              <img src={`${import.meta.env.BASE_URL}weread-logo.png`} alt="微信读书" width="118" height="27" />
            </Link>
            <div className="shelf-search">
              <ShelfSearchIcon className="shelf-search-icon" />
              <input
                ref={inputRef}
                type="search"
                aria-label={t('search')}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') searchState.rememberSearch(event.currentTarget.value);
                  if (event.key === 'Escape') clearShelfSearch();
                }}
                placeholder={t('search')}
                onChange={(event) => setSearchDraft(event.currentTarget.value.trim())}
              />
              {searchDraft && (
                <button
                  aria-label={t('search.clear')}
                  className="shelf-search-clear"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearShelfSearch}
                >
                  <ShelfSearchClearIcon style={{ display: 'block', width: 16, height: 16 }} />
                </button>
              )}
            </div>
            <Link className="shelf-navbar-link" to={ROUTE_PATH.HOME}>
              {t('home')}
            </Link>
          </div>
        </div>
        <SearchResultsPanel
          className="shelf-search-results"
          expanded={isSearchExpanded}
          height="calc(100vh - 96px)"
          panelClassName="shelf-search-result-panel bg-front-bg-color-3 rounded-xl py-5 mb-6"
          state={searchState}
        />
      </header>

      <main className="shelf-main">
        <div className="shelf-page-header">
          <h1>{t('my_bookcase')}</h1>
          <div className="shelf-page-actions">
            <ShelfStatusFilter value={statusFilter} onChange={setStatusFilter} />
          </div>
        </div>
        {loading ? (
          <div className="shelf-loading">
            <Loading />
          </div>
        ) : visibleBooks.length === 0 ? (
          <div className="library-empty">
            <BookCoverFallback title="微信读书" />
            <h2>{t(books.length ? 'shelf.no_matching_books' : 'shelf.empty')}</h2>
            <p>{t(books.length ? 'shelf.change_filter' : 'import.supported_formats')}</p>
            {!books.length && (
              <button className="library-primary-button" type="button" onClick={onAdd}>
                {t('import.books')}
              </button>
            )}
          </div>
        ) : (
          <div className="shelf-list">
            {visibleBooks.map((book) => (
              <ShelfBookItem book={book} key={book.id} />
            ))}
            <ImportCard className="shelf-import-book" iconSize={48} onAdd={onAdd} />
          </div>
        )}
      </main>
      <ImportConflictDialog state={conflictState} onCancel={onCancelConflict} onConfirm={onConfirmConflict} />
    </div>
  );
};

export default Shelf;
