import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useHref, useNavigate } from 'react-router-dom';
import { BookCard, BookCoverFallback } from '@/components/BookCard';
import {
  addBook,
  getAllBooks,
  getBookFingerprint,
  searchBooksByAuthor,
  searchBooksByContent,
  searchBooksByTitle,
} from '@/store/books';
import { trim } from '@/lib/transformText';
import { resumeDB } from '@/store';
import { importBookFile, isSupportedBookFile } from '@/lib/bookImporter';
import type { BookSummary, SearchResult } from '@/store/books';
import type { ImportedBookData } from '@/lib/bookImporter';
import {
  createImportedBookDataFromBackup,
  getBackupArchiveIdentity,
  getBackupUserDataForBook,
  isBackupFile,
  isFullBackupArchive,
  parseBackupFile,
  restoreBackupUserData,
} from '@/lib/backup/importBackup';
import type { ParsedBackupArchive } from '@/lib/backup/backupSchema';
import { ROUTE_PATH, createReaderPath } from '@/router';
import { DEVICE_ENUM, useCheckDevice } from '@/lib/hooks';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import type { ReaderBookData } from '@/lib/readerBookData';
import { getBookRecentTimestamp, getReaderProgress } from '@/lib/readerProgress';
import { debounce, escapeRegExp, getErrorMessage, safeReadStorage, safeWriteStorage } from '@/lib/utils';
import { clearReaderSignals } from '@/lib/subscribe';
import { showGlobalFallback } from '@/lib/globalFallback';
import { Loading } from '@/components/Loading';
import {
  OcticonChevronRight as HomeArrowRightIcon,
  OcticonPlus as HomePlusIcon,
  OcticonXCircle as HomeSearchClearIcon,
  OcticonSearch as HomeSearchIcon,
} from '@/components/Octicon';
import { t } from '@/locales';
import './index.scss';

const MAX_BOOK_LOAD_RETRIES = 3;

const BOOK_IMPORT_TIMEOUT_MS = 180_000;

type ImportConflictType = 'missing-book' | 'restore-user-data' | 'same-book' | 'same-title';

type ImportConflictAction = 'cancel' | 'keepBoth' | 'overwrite';

const HOME_RECENT_BOOK_LIMIT = 8;
const SEARCH_HISTORY_KEY = 'weread-search-history';

// Module-scoped cache that survives Home unmount/remount during a single
// session — keeping the book list on screen avoids a flash of empty shelf when
// the user navigates back from the reader. The HMR hook below resets it on
// hot reload so editing this file doesn't leave a stale snapshot around.
let homeBookListCache: BookSummary[] | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    homeBookListCache = null;
  });
}

const writeHomeBookListCache = (books: BookSummary[]): void => {
  homeBookListCache = books;
};

interface ImportConflictState {
  bookId: string;
  confirmOnly?: boolean;
  description?: string;
  disableBookLink?: boolean;
  dialogTitle?: string;
  fileName: string;
  fileSizeLabel: string;
  lastReadLabel: string;
  showApplyToRemaining: boolean;
  sourceTypeLabel: string;
  title: string;
  type: ImportConflictType;
  warningText?: string;
}

interface ImportConflictDecision {
  action: ImportConflictAction;
  applyToRemaining: boolean;
}

interface ImportConflictDialogProps {
  state: ImportConflictState | null;
  onCancel: (applyToRemaining: boolean) => void;
  onConfirm: (action: Exclude<ImportConflictAction, 'cancel'>, applyToRemaining: boolean) => void;
}

const chooseBookFiles = (): Promise<File[]> => {
  return new Promise((resolve) => {
    const uploadFile = document.createElement('input');
    uploadFile.setAttribute('type', 'file');
    uploadFile.setAttribute('accept', '.txt,.epub,.bdz,text/plain,application/epub+zip,application/zip');
    uploadFile.setAttribute('multiple', 'multiple');
    uploadFile.onchange = () => {
      resolve(uploadFile.files ? Array.from(uploadFile.files) : []);
    };
    // Without this, dismissing the file dialog leaves the whole import
    // routine awaiting forever (one leaked closure per cancel).
    uploadFile.oncancel = () => resolve([]);
    uploadFile.click();
  });
};

const isSupportedImportFile = (file: File): boolean => isSupportedBookFile(file) || isBackupFile(file);

const withTimeout = <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
};

const importBookFileWithFallback = (file: File): Promise<ImportedBookData> => {
  const controller = new AbortController();
  const timeoutMessage = t('import.file_timeout', [file.name]);
  return withTimeout(importBookFile(file, { signal: controller.signal }), BOOK_IMPORT_TIMEOUT_MS, timeoutMessage, () =>
    controller.abort(new Error(timeoutMessage)),
  );
};

const getBookIdentity = (book: Pick<BookSummary, 'fingerprint' | 'id'>): string => book.fingerprint || book.id;

const normalizeBookTitle = (title: string): string => title.trim() || t('common.unnamed_book');

const resolveUniqueBookTitle = (title: string, existingBooks: BookSummary[], currentIdentity: string): string => {
  const baseTitle = title.trim() || t('common.unnamed_book');
  const existingTitles = new Set(
    existingBooks.filter((book) => getBookIdentity(book) !== currentIdentity).map((book) => book.title),
  );
  if (!existingTitles.has(baseTitle)) return baseTitle;

  let index = 2;
  let nextTitle = `${baseTitle}(${index})`;
  while (existingTitles.has(nextTitle)) {
    index += 1;
    nextTitle = `${baseTitle}(${index})`;
  }
  return nextTitle;
};

const formatBookFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size <= 0) return '0KB';
  const mb = size / 1024 / 1024;
  if (mb >= 1) {
    const value = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
    return `${value}MB`;
  }
  const kb = Math.max(1, Math.round(size / 1024));
  return `${kb}KB`;
};

const formatImportDate = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return t('common.not_available');
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatProgressPercent = (value?: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value || 0), 0), 100);
};

const createImportConflictState = ({
  existingBook,
  file,
  imported,
  showApplyToRemaining,
  type,
}: {
  existingBook: BookSummary;
  file: File;
  imported: ImportedBookData;
  showApplyToRemaining: boolean;
  type: ImportConflictType;
}): ImportConflictState => {
  const progress = getReaderProgress(existingBook.id);
  const readPercent = formatProgressPercent(progress?.readPercent);
  const lastReadDateLabel = t('import.last_read_time', [formatImportDate(progress?.updatedAt)]);
  const lastReadLabel =
    readPercent > 0 ? `${lastReadDateLabel} (${t('import.read_percent', [readPercent])})` : lastReadDateLabel;
  return {
    bookId: existingBook.id,
    fileName: file.name,
    fileSizeLabel: formatBookFileSize(file.size),
    lastReadLabel,
    showApplyToRemaining,
    sourceTypeLabel: imported.sourceType.toUpperCase(),
    title: existingBook.title || normalizeBookTitle(imported.title),
    type,
  };
};

const formatBackupCreatedAt = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return t('common.unknown_time');
  return formatImportDate(timestamp);
};

const createBackupUserDataConflictState = ({
  archive,
  existingBook,
  file,
  showApplyToRemaining,
}: {
  archive: ParsedBackupArchive;
  existingBook: BookSummary;
  file: File;
  showApplyToRemaining: boolean;
}): ImportConflictState => {
  const progress = getReaderProgress(existingBook.id);
  const readPercent = formatProgressPercent(progress?.readPercent);
  const lastReadDateLabel = t('import.last_read_time', [formatImportDate(progress?.updatedAt)]);
  const lastReadLabel =
    readPercent > 0 ? `${lastReadDateLabel} (${t('import.read_percent', [readPercent])})` : lastReadDateLabel;
  return {
    bookId: existingBook.id,
    description: t('import.existing_user_data', [existingBook.title || archive.book.title]),
    dialogTitle: t('import.restore_user_data'),
    fileName: file.name,
    fileSizeLabel: formatBookFileSize(file.size),
    lastReadLabel: `${lastReadLabel} | ${t('import.backup_time', [formatBackupCreatedAt(archive.manifest.createdAt)])}`,
    showApplyToRemaining,
    sourceTypeLabel: 'Archive',
    title: existingBook.title || archive.book.title,
    type: 'restore-user-data',
    warningText: t('import.restore_warning'),
  };
};

const createMissingBackupBookState = ({
  archive,
  file,
}: {
  archive: ParsedBackupArchive;
  file: File;
}): ImportConflictState => {
  const title = archive.book.title || archive.book.id;
  const fingerprint = archive.book.fingerprint || archive.book.id;
  return {
    bookId: archive.book.id,
    confirmOnly: true,
    description: t('import.missing_book_description', [title]),
    dialogTitle: t('import.restore_user_data'),
    disableBookLink: true,
    fileName: file.name,
    fileSizeLabel: formatBookFileSize(file.size),
    lastReadLabel: `${t('import.backup_time', [formatBackupCreatedAt(archive.manifest.createdAt)])} | ${t('import.book_fingerprint', [fingerprint.slice(0, 12)])}`,
    showApplyToRemaining: false,
    sourceTypeLabel: archive.book.sourceType.toUpperCase(),
    title,
    type: 'missing-book',
    warningText: t('import.missing_book_warning'),
  };
};

const selectBackupArchivesForRestore = (
  archives: ParsedBackupArchive[],
): {
  ignoredCount: number;
  selected: ParsedBackupArchive[];
} => {
  const groups = new Map<string, ParsedBackupArchive[]>();
  archives.forEach((archive) => {
    const key = getBackupArchiveIdentity(archive);
    groups.set(key, [...(groups.get(key) || []), archive]);
  });

  const selected: ParsedBackupArchive[] = [];
  let ignoredCount = 0;
  groups.forEach((group) => {
    const fullBackups = group.filter(isFullBackupArchive);
    const candidates = fullBackups.length > 0 ? fullBackups : group;
    const sorted = [...candidates].sort((a, b) => b.manifest.createdAt - a.manifest.createdAt);
    const [latest, ...rest] = sorted;
    if (latest) selected.push(latest);
    ignoredCount += rest.length + (fullBackups.length > 0 ? group.length - fullBackups.length : 0);
  });

  return { ignoredCount, selected };
};

const upsertBookListItem = (books: BookSummary[], book: BookSummary): BookSummary[] => {
  const index = books.findIndex((item) => item.id === book.id);
  const rest = index === -1 ? books : books.filter((item) => item.id !== book.id);
  return [book, ...rest];
};

const getRecentHomeBooks = (books: BookSummary[]): BookSummary[] => {
  return [...books]
    .sort((a, b) => getBookRecentTimestamp(b) - getBookRecentTimestamp(a))
    .slice(0, HOME_RECENT_BOOK_LIMIT);
};

const getImportFailureMessage = (file: File, error: unknown): string => {
  const message = getErrorMessage(error, t('import.failed'));
  if (/timeout|timed out|超时/iu.test(message)) {
    return /^EPUB /iu.test(message) ? t('import.file_timeout', [file.name]) : message;
  }
  if (/\.epub$/iu.test(file.name)) return t('import.epub_failed', [file.name]);
  return t('import.file_failed', [file.name]);
};

interface AddBookResolvingConflictsOptions {
  failureLabel: string;
  file: File;
  // Matches a shelf book that IS the incoming one (id/fingerprint identity).
  findSameBook: (book: BookSummary) => boolean;
  fingerprint: string;
  // Explicit id for the fresh-add path (backups keep their original book id).
  freshBookId?: string;
  imported: ImportedBookData;
  // Plain re-imports keep the shelf title the user may have deduplicated;
  // backup restores bring back the archived title.
  keepExistingTitleOnOverwrite: boolean;
  readerDataForBook?: (bookId: string) => ReaderBookData;
  requestConflictDecision: (state: ImportConflictState) => Promise<ImportConflictDecision>;
  showApplyToRemaining: boolean;
  workingBooks: BookSummary[];
}

// Shared conflict flow for every import source (book file or full backup):
// same-book → ask, overwrite in place; same-title → ask, overwrite or keep
// both; otherwise add as a new book under a de-duplicated title.
const addBookResolvingConflicts = async (
  options: AddBookResolvingConflictsOptions,
): Promise<{ book?: BookSummary; cancelled: boolean }> => {
  const { file, fingerprint, imported, requestConflictDecision, showApplyToRemaining, workingBooks } = options;

  const persist = async (data: { id?: string; overwrite?: boolean; title?: string }): Promise<BookSummary> => {
    const id = data.id || fingerprint;
    const result = await addBook({
      ...imported,
      fingerprint,
      ...data,
      id,
      readerData: options.readerDataForBook?.(id),
    });
    if (result.error || !result.data) {
      throw new Error(result.message || `${options.failureLabel}: ${file.name}`);
    }
    return result.data;
  };

  const overwriteExisting = async (existingBook: BookSummary): Promise<BookSummary> => {
    return persist({
      id: existingBook.id,
      overwrite: true,
      ...(options.keepExistingTitleOnOverwrite ? { title: existingBook.title } : {}),
    });
  };

  const existingSameBook = workingBooks.find(options.findSameBook);
  if (existingSameBook) {
    const decision = await requestConflictDecision(
      createImportConflictState({
        existingBook: existingSameBook,
        file,
        imported,
        showApplyToRemaining,
        type: 'same-book',
      }),
    );
    if (decision.action === 'cancel') return { cancelled: true };
    return { book: await overwriteExisting(existingSameBook), cancelled: false };
  }

  const importedTitle = normalizeBookTitle(imported.title);
  const existingSameTitleBook = workingBooks.find(
    (book) => normalizeBookTitle(book.title) === importedTitle && getBookIdentity(book) !== fingerprint,
  );
  if (existingSameTitleBook) {
    const decision = await requestConflictDecision(
      createImportConflictState({
        existingBook: existingSameTitleBook,
        file,
        imported,
        showApplyToRemaining,
        type: 'same-title',
      }),
    );
    if (decision.action === 'cancel') return { cancelled: true };
    if (decision.action === 'overwrite') {
      return { book: await overwriteExisting(existingSameTitleBook), cancelled: false };
    }
    // keepBoth falls through to a fresh add under a de-duplicated title.
  }

  const title = resolveUniqueBookTitle(imported.title, workingBooks, fingerprint);
  return { book: await persist({ id: options.freshBookId, title }), cancelled: false };
};

export const ImportConflictDialog = ({
  state,
  onCancel,
  onConfirm,
}: ImportConflictDialogProps): React.JSX.Element | null => {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [applyToRemaining, setApplyToRemaining] = useState(false);
  const [keepBoth, setKeepBoth] = useState(false);

  useEffect(() => {
    if (!state) return;
    setApplyToRemaining(false);
    setKeepBoth(false);
    const dialog = dialogRef.current!;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button:not([hidden])')!.focus();
  }, [state]);

  const bookUrl = state ? createReaderPath(state.bookId) : ROUTE_PATH.HOME;
  const bookHref = useHref(bookUrl);

  if (!state) return null;

  const isConfirmOnly = Boolean(state.confirmOnly);
  const canKeepBoth = !isConfirmOnly && state.type === 'same-title';
  const isCancelDisabled = canKeepBoth && keepBoth;
  const title = state.type === 'same-book' ? t('import.same_book_title') : t('import.same_title_title');
  const dialogTitle = state.dialogTitle || title;
  const openExistingBook = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    dialogRef.current!.close();
    onCancel(false);
    clearReaderSignals();
    navigate(bookUrl);
  };

  return (
    <dialog
      ref={dialogRef}
      className="home-import-dialog"
      aria-labelledby="home-import-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isCancelDisabled) {
          event.currentTarget.close();
          onCancel(isConfirmOnly ? false : applyToRemaining);
        }
      }}
    >
      <div className="home-import-dialog-title" id="home-import-dialog-title">
        {dialogTitle}
      </div>
      <div className="home-import-dialog-content">
        <div>{state.description || t('import.already_in_shelf', [state.title])}</div>
        <div className="home-import-dialog-info">
          {state.disableBookLink ? (
            <div className="home-import-dialog-file">{state.fileName}</div>
          ) : (
            <a className="home-import-dialog-file" href={bookHref} onClick={openExistingBook}>
              {state.fileName}
            </a>
          )}
          <div className="home-import-dialog-meta">
            {state.sourceTypeLabel} | {state.fileSizeLabel} | {state.lastReadLabel}
          </div>
        </div>
        {keepBoth ? (
          <div className="home-import-dialog-note">{t('import.rename_note', [state.title])}</div>
        ) : (
          <div className="home-import-dialog-warning">{state.warningText || t('import.overwrite_warning')}</div>
        )}
      </div>
      {canKeepBoth && (
        <label className="home-import-dialog-option">
          <input checked={keepBoth} type="checkbox" onChange={(event) => setKeepBoth(event.currentTarget.checked)} />
          <span>{t('import.keep_both')}</span>
        </label>
      )}
      {!isConfirmOnly && state.showApplyToRemaining && (
        <label className="home-import-dialog-option">
          <input
            checked={applyToRemaining}
            type="checkbox"
            onChange={(event) => setApplyToRemaining(event.currentTarget.checked)}
          />
          <span>{t('import.apply_to_remaining')}</span>
        </label>
      )}
      <div className="home-import-dialog-actions">
        <button
          className="home-import-dialog-button"
          disabled={isCancelDisabled}
          hidden={isConfirmOnly}
          type="button"
          onClick={() => {
            dialogRef.current!.close();
            onCancel(applyToRemaining);
          }}
        >
          {t('common.cancel')}
        </button>
        <button
          className="home-import-dialog-button home-import-dialog-button-primary"
          type="button"
          onClick={() => {
            dialogRef.current!.close();
            if (isConfirmOnly) {
              onCancel(false);
              return;
            }
            onConfirm(keepBoth ? 'keepBoth' : 'overwrite', applyToRemaining);
          }}
        >
          {t('common.confirm')}
        </button>
      </div>
    </dialog>
  );
};

export interface BookSearchState {
  clearSearch: () => void;
  searchValue: string;
  searchLoading: boolean;
  searchTitleResult: BookSummary[];
  searchAuthorResult: BookSummary[];
  searchContentResult: SearchResult[];
  recentSearches: string[];
  rememberSearch: (keyword: string) => void;
  clearSearchHistory: () => void;
}

const useHomeBookList = (): {
  bookList: BookSummary[];
  setBookList: React.Dispatch<React.SetStateAction<BookSummary[]>>;
} => {
  const [bookList, setRawBookList] = useState<BookSummary[]>(() => homeBookListCache || []);
  const setBookList: React.Dispatch<React.SetStateAction<BookSummary[]>> = useCallback((value) => {
    setRawBookList((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      writeHomeBookListCache(next);
      return next;
    });
  }, []);

  const loadBooks = useCallback(async () => {
    let attempts = 0;
    while (attempts < MAX_BOOK_LOAD_RETRIES) {
      const res = await getAllBooks();
      if (!res.error) {
        setBookList(res.data);
        return;
      }
      attempts++;
      // resumeDB never rejects; a false result is retried by the loop.
      await resumeDB();
    }
  }, []);

  // Stale-while-revalidate: the cached snapshot renders immediately (no empty
  // flash when returning from the reader), but we always refetch — books
  // imported from other pages (Shelf shares the import hook) would otherwise
  // never show up here until a full reload.
  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  return { bookList, setBookList };
};

export const useHomeBookImport = (
  bookList: BookSummary[],
  setBookList: React.Dispatch<React.SetStateAction<BookSummary[]>>,
): {
  conflictState: ImportConflictState | null;
  onAdd: () => void;
  onCancelConflict: (applyToRemaining: boolean) => void;
  onConfirmConflict: (action: Exclude<ImportConflictAction, 'cancel'>, applyToRemaining: boolean) => void;
} => {
  const bookListRef = useRef(bookList);
  const conflictResolverRef = useRef<((decision: ImportConflictDecision) => void) | null>(null);
  const sharedConflictDecisionRef = useRef<ImportConflictDecision | null>(null);
  const [conflictState, setConflictState] = useState<ImportConflictState | null>(null);

  useEffect(() => {
    bookListRef.current = bookList;
  }, [bookList]);

  const isSharedDecisionCompatible = useCallback((decision: ImportConflictDecision, state: ImportConflictState) => {
    return decision.action !== 'keepBoth' || state.type === 'same-title';
  }, []);

  const requestConflictDecision = useCallback(
    (state: ImportConflictState): Promise<ImportConflictDecision> => {
      const sharedDecision = sharedConflictDecisionRef.current;
      if (!state.confirmOnly && sharedDecision && isSharedDecisionCompatible(sharedDecision, state)) {
        return Promise.resolve({ ...sharedDecision, applyToRemaining: false });
      }
      return new Promise((resolve) => {
        conflictResolverRef.current = resolve;
        setConflictState(state);
      });
    },
    [isSharedDecisionCompatible],
  );

  const settleConflict = useCallback((decision: ImportConflictDecision) => {
    const normalizedDecision = { ...decision, applyToRemaining: false };
    if (decision.applyToRemaining) {
      sharedConflictDecisionRef.current = normalizedDecision;
    }
    conflictResolverRef.current?.(decision);
    conflictResolverRef.current = null;
    setConflictState(null);
  }, []);

  const onCancelConflict = useCallback(
    (applyToRemaining: boolean) => {
      settleConflict({ action: 'cancel', applyToRemaining });
    },
    [settleConflict],
  );

  const onConfirmConflict = useCallback(
    (action: Exclude<ImportConflictAction, 'cancel'>, applyToRemaining: boolean) => {
      settleConflict({ action, applyToRemaining });
    },
    [settleConflict],
  );

  const onAdd = useCallback(() => {
    void (async () => {
      sharedConflictDecisionRef.current = null;
      const files = await chooseBookFiles();
      if (files.length === 0) return;

      const supportedFiles = files.filter(isSupportedImportFile);
      if (supportedFiles.length === 0) {
        showGlobalFallback({ message: t('import.select_supported'), tone: 'error' });
        return;
      }
      if (supportedFiles.length < files.length) {
        showGlobalFallback({ message: t('import.unsupported_skipped'), tone: 'info' });
      }

      const latestBooks = await getAllBooks();
      let workingBooks = latestBooks.error ? bookListRef.current : latestBooks.data;
      if (latestBooks.error) {
        showGlobalFallback({ message: t('import.shelf_read_failed'), tone: 'info' });
      }
      let importedCount = 0;
      let failedCount = 0;
      const showApplyToRemaining = supportedFiles.length > 1;
      const parsedBackupByFile = new Map<File, ParsedBackupArchive>();
      const backupArchives: ParsedBackupArchive[] = [];

      for (const file of supportedFiles.filter(isBackupFile)) {
        try {
          backupArchives.push(await parseBackupFile(file));
        } catch (error) {
          failedCount += 1;
          showGlobalFallback({ message: getImportFailureMessage(file, error), tone: 'error' });
        }
      }

      if (backupArchives.length > 0) {
        const { ignoredCount, selected } = selectBackupArchivesForRestore(backupArchives);
        selected.forEach((archive) => parsedBackupByFile.set(archive.file, archive));
        if (ignoredCount > 0) {
          showGlobalFallback({ message: t('import.ignored_low_priority_backups', [ignoredCount]), tone: 'info' });
        }
      }
      const importQueue = [
        ...supportedFiles.filter((file) => !isBackupFile(file)),
        ...supportedFiles.filter((file) => isBackupFile(file) && parsedBackupByFile.has(file)),
      ];

      for (const file of importQueue) {
        try {
          if (isBackupFile(file)) {
            const archive = parsedBackupByFile.get(file);
            if (!archive) continue;
            const backupIdentity = getBackupArchiveIdentity(archive);

            if (isFullBackupArchive(archive)) {
              const imported = createImportedBookDataFromBackup(archive);
              const documentFingerprint = await getBookFingerprint(imported);
              const fingerprint = imported.fingerprint || documentFingerprint;
              const outcome = await addBookResolvingConflicts({
                failureLabel: 'Failed to restore backup',
                file,
                findSameBook: (book) => {
                  const identity = getBookIdentity(book);
                  return (
                    book.id === archive.book.id ||
                    identity === backupIdentity ||
                    identity === fingerprint ||
                    identity === documentFingerprint
                  );
                },
                fingerprint,
                freshBookId: archive.book.id,
                imported,
                keepExistingTitleOnOverwrite: false,
                readerDataForBook: (bookId) => getBackupUserDataForBook(archive, bookId),
                requestConflictDecision,
                showApplyToRemaining,
                workingBooks,
              });
              if (outcome.cancelled || !outcome.book) continue;
              workingBooks = upsertBookListItem(workingBooks, outcome.book);
              importedCount += 1;
              continue;
            }

            const targetBook = workingBooks.find((book) => {
              const identity = getBookIdentity(book);
              return (
                book.id === archive.book.id || identity === backupIdentity || identity === archive.book.fingerprint
              );
            });
            if (!targetBook) {
              await requestConflictDecision(createMissingBackupBookState({ archive, file }));
              continue;
            }
            const decision = await requestConflictDecision(
              createBackupUserDataConflictState({
                archive,
                existingBook: targetBook,
                file,
                showApplyToRemaining,
              }),
            );
            if (decision.action === 'cancel') continue;
            await restoreBackupUserData({ archive, targetBookId: targetBook.id });
            importedCount += 1;
            continue;
          }

          const imported = await importBookFileWithFallback(file);
          const documentFingerprint = await getBookFingerprint(imported);
          const fingerprint = imported.fingerprint || documentFingerprint;
          const outcome = await addBookResolvingConflicts({
            failureLabel: 'Failed to import book',
            file,
            findSameBook: (book) => {
              const identity = getBookIdentity(book);
              return identity === fingerprint || identity === documentFingerprint;
            },
            fingerprint,
            imported,
            keepExistingTitleOnOverwrite: true,
            requestConflictDecision,
            showApplyToRemaining,
            workingBooks,
          });
          if (outcome.cancelled || !outcome.book) continue;
          workingBooks = upsertBookListItem(workingBooks, outcome.book);
          importedCount += 1;
        } catch (error) {
          failedCount += 1;
          showGlobalFallback({ message: getImportFailureMessage(file, error), tone: 'error' });
        }
      }

      setBookList(workingBooks);
      if (importedCount > 0 && failedCount > 0) {
        showGlobalFallback({ message: t('import.success_with_failures', [importedCount, failedCount]), tone: 'info' });
      } else if (importedCount > 0) {
        showGlobalFallback({ message: t('import.success', [importedCount]), tone: 'success' });
      } else if (failedCount > 0) {
        showGlobalFallback({ message: t('import.failed'), tone: 'error' });
      }
    })();
  }, [requestConflictDecision, setBookList]);

  return { conflictState, onAdd, onCancelConflict, onConfirmConflict };
};

export const useBookSearch = (inputRef: React.RefObject<HTMLInputElement | null>): BookSearchState => {
  const [searchValue, setSearchValue] = useState<string>('');
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchTitleResult, setSearchTitleResult] = useState<BookSummary[]>([]);
  const [searchAuthorResult, setSearchAuthorResult] = useState<BookSummary[]>([]);
  const [searchContentResult, setSearchContentResult] = useState<SearchResult[]>([]);
  const requestIdRef = useRef(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(safeReadStorage(SEARCH_HISTORY_KEY) || '[]');
      return Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 4)
        : [];
    } catch {
      return [];
    }
  });
  const rememberSearch = useCallback(
    (keyword: string) => {
      const value = keyword.trim();
      if (!value) return;
      const next = [value, ...recentSearches.filter((item) => item !== value)].slice(0, 4);
      setRecentSearches(next);
      safeWriteStorage(SEARCH_HISTORY_KEY, JSON.stringify(next));
    },
    [recentSearches],
  );
  const clearSearchHistory = useCallback(() => {
    setRecentSearches([]);
    safeWriteStorage(SEARCH_HISTORY_KEY, '[]');
  }, []);

  useEffect(() => {
    const target = inputRef.current;
    if (!target) return;

    // Chinese / Japanese / Korean IMEs emit a stream of `input` events while
    // the user is composing pinyin / kana — each candidate selection fires
    // input even though the user has not committed any text yet. Searching
    // on those would thrash the worker and pop confusing partial results.
    // We swallow them while compositionstart/end is in progress and only
    // run one final search when composition ends.
    let composing = false;

    const runSearch = (rawValue: string): void => {
      const value = trim(rawValue);
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setSearchValue(value);
      if (!value) {
        setSearchTitleResult([]);
        setSearchAuthorResult([]);
        setSearchContentResult([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      setSearchTitleResult([]);
      setSearchAuthorResult([]);
      setSearchContentResult([]);

      Promise.allSettled([searchBooksByTitle(value), searchBooksByAuthor(value), searchBooksByContent(value)]).then(
        (results) => {
          if (requestIdRef.current !== requestId) return;
          const [titleRes, authorRes, contentRes] = results;
          if (titleRes.status === 'fulfilled' && !titleRes.value.error) {
            setSearchTitleResult(titleRes.value.data);
          }
          if (authorRes.status === 'fulfilled' && !authorRes.value.error) {
            setSearchAuthorResult(authorRes.value.data);
          }
          if (contentRes.status === 'fulfilled' && !contentRes.value.error) {
            setSearchContentResult(contentRes.value.data);
          }
          setSearchLoading(false);
        },
      );
    };

    const debouncedRunSearch = debounce(runSearch, 500);

    const onSearchInput = (event: Event): void => {
      if (composing) return;
      const rawValue = (event.target as HTMLInputElement)?.value || '';
      debouncedRunSearch(rawValue);
    };

    const onCompositionStart = (): void => {
      composing = true;
    };

    const onCompositionEnd = (event: Event): void => {
      composing = false;
      const rawValue = (event.target as HTMLInputElement)?.value || '';
      debouncedRunSearch(rawValue);
    };

    target.addEventListener('input', onSearchInput);
    target.addEventListener('change', onSearchInput);
    target.addEventListener('compositionstart', onCompositionStart);
    target.addEventListener('compositionend', onCompositionEnd);
    return () => {
      // Drop any trailing debounced call — after unmount it would still fire
      // three worker searches (content search is expensive on big libraries).
      debouncedRunSearch.cancel();
      target.removeEventListener('input', onSearchInput);
      target.removeEventListener('change', onSearchInput);
      target.removeEventListener('compositionstart', onCompositionStart);
      target.removeEventListener('compositionend', onCompositionEnd);
    };
  }, [inputRef]);

  const clearSearch = useCallback(() => {
    requestIdRef.current += 1;
    const target = inputRef.current;
    if (target) {
      target.value = '';
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setSearchValue('');
    setSearchLoading(false);
    setSearchTitleResult([]);
    setSearchAuthorResult([]);
    setSearchContentResult([]);
  }, [inputRef]);

  return {
    clearSearch,
    searchValue,
    searchLoading,
    searchTitleResult,
    searchAuthorResult,
    searchContentResult,
    recentSearches,
    rememberSearch,
    clearSearchHistory,
  };
};

const renderHighlightedText = (text: string, keyword: string, bookId: string): React.ReactNode => {
  if (!text) return null;
  if (!keyword) return text;
  // Case-insensitive split with a capturing group: odd indexes are the
  // matched text (original casing preserved). The worker matches
  // case-insensitively, so the highlight must too.
  const segments = text.split(new RegExp(`(${escapeRegExp(keyword)})`, 'iu'));
  return segments.map((segment, index) =>
    index % 2 === 1 ? (
      <span key={`${bookId}-${index}`} className="text-blue-500">
        {segment}
      </span>
    ) : (
      <span key={`${bookId}-${index}`}>{segment}</span>
    ),
  );
};

interface SearchResultRowProps {
  book: BookSummary | SearchResult;
  highlightedField: 'title' | 'author' | 'matched';
  keyword: string;
  onOpen: () => void;
}

const SearchResultRow = ({ book, highlightedField, keyword, onOpen }: SearchResultRowProps): React.JSX.Element => {
  const { id, title = '', author = '', image } = book;
  const matchedText = (book as SearchResult).matchedText?.[0] || '';
  const resolvedImage = useResolvedBookImage(id, image);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(resolvedImage && !imageFailed);
  useEffect(() => {
    setImageFailed(false);
  }, [id, image]);

  return (
    <Link
      to={createReaderPath(id)}
      onClick={(event) => {
        onOpen();
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) clearReaderSignals();
      }}
      className="py-3.5 px-5 flex flex-row flex-nowrap items-center shrink-0 cursor-pointer hover:bg-light-gray-color-1 min-h-32"
      item-id={id}
    >
      {shouldShowImage ? (
        <img className="w-16 mr-5" src={resolvedImage} alt={title} onError={() => setImageFailed(true)} />
      ) : (
        <BookCoverFallback className="w-16 h-24 mr-5" title={title} />
      )}
      <div>
        <div className="text-lg text-text-color-1 font-medium break-all">
          {highlightedField === 'title' ? renderHighlightedText(title, keyword, id) : title}
        </div>
        <div className="text-base text-text-color-2 font-medium mt-1 break-all">
          {highlightedField === 'author' ? renderHighlightedText(author, keyword, id) : author}
        </div>
        {highlightedField === 'matched' && (
          <div className="text-base text-text-color-2 font-medium mt-1 break-all">
            {renderHighlightedText(matchedText, keyword, id)}
          </div>
        )}
      </div>
    </Link>
  );
};

interface SearchResultsPanelProps {
  className?: string;
  expanded?: boolean;
  height?: string;
  state: BookSearchState;
  panelClassName: string;
}

export const SearchResultsPanel = ({
  className = '',
  expanded,
  height = 'calc(100vh - var(--spacing) * 48)',
  state,
  panelClassName,
}: SearchResultsPanelProps): React.JSX.Element => {
  const { searchValue, searchLoading, searchTitleResult, searchAuthorResult, searchContentResult } = state;
  const noResult =
    Boolean(searchValue) &&
    !searchLoading &&
    searchTitleResult.length === 0 &&
    searchAuthorResult.length === 0 &&
    searchContentResult.length === 0;
  const isExpanded = expanded ?? Boolean(searchValue);

  return (
    <div
      className={`w-full transition-all duration-500 overflow-hidden mt-6 pb-6 ${className}`}
      style={{ height: isExpanded ? height : '0px' }}
    >
      <div className="overflow-y-auto h-full">
        {searchTitleResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pt-2">{t('ebook')}</div>
              <div>
                {searchTitleResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-title`}
                    book={book}
                    highlightedField="title"
                    keyword={searchValue}
                    onOpen={() => state.rememberSearch(searchValue)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {searchAuthorResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pt-2">{t('author')}</div>
              <div>
                {searchAuthorResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-author`}
                    book={book}
                    highlightedField="author"
                    keyword={searchValue}
                    onOpen={() => state.rememberSearch(searchValue)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {searchContentResult.length > 0 && !searchLoading && (
          <div className={panelClassName}>
            <div>
              <div className="text-text-color-2 text-base font-medium px-5 pt-2">
                {t('search_result_1')} <span className="text-blue-500">{searchValue}</span> {t('search_result_2')}
                {t('search_result_3')}
                {searchContentResult.length}
              </div>
              <div>
                {searchContentResult.map((book) => (
                  <SearchResultRow
                    key={`${book.id}-content`}
                    book={book}
                    highlightedField="matched"
                    keyword={searchValue}
                    onOpen={() => state.rememberSearch(searchValue)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {noResult && (
          <div className="h-full">
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-text-color-2 font-normal text-xl">{t('no_result')}</div>
            </div>
          </div>
        )}
        {searchLoading && (
          <div className="h-full">
            <div className="flex flex-col items-center justify-center h-full">
              <svg
                aria-hidden="true"
                className="text-[34px] text-text-color-2"
                fill="none"
                focusable="false"
                height="1em"
                viewBox="0 0 24 24"
                width="1em"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 0h24v24H0z" fill="none" />
                <path
                  d="M12 3c4.97 0 9 4.03 9 9"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                >
                  <animateTransform
                    attributeName="transform"
                    dur="1.5s"
                    repeatCount="indefinite"
                    type="rotate"
                    values="0 12 12;360 12 12"
                  />
                </path>
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface ImportCardProps {
  className: string;
  iconSize: number;
  onAdd: () => void;
}

export const ImportCard = ({ className, iconSize, onAdd }: ImportCardProps): React.JSX.Element => {
  return (
    <button
      className={className}
      type="button"
      aria-label={t('import.books')}
      title={t('import.books')}
      onClick={onAdd}
    >
      <HomePlusIcon style={{ width: iconSize, height: iconSize }} />
    </button>
  );
};

export const Home = (): React.JSX.Element => {
  const [currentDevice] = useCheckDevice();
  if (currentDevice === DEVICE_ENUM.MOBILE) return <MobileHome />;
  if (currentDevice === DEVICE_ENUM.DESKTOP) return <DesktopHome />;
  return <Loading />;
};

export const DesktopHome = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { bookList, setBookList } = useHomeBookList();
  const searchState = useBookSearch(inputRef);
  const { conflictState, onAdd, onCancelConflict, onConfirmConflict } = useHomeBookImport(bookList, setBookList);
  const recentBookList = useMemo(() => getRecentHomeBooks(bookList), [bookList]);
  const isSearching = Boolean(searchState.searchValue);

  return (
    <div className="home-page home-page-desktop">
      <header className={`home-hero ${isSearching ? 'is-searching' : ''}`}>
        <h1 className="home-logo">
          <img src={`${import.meta.env.BASE_URL}weread-logo.png`} alt="微信读书" width="160" height="36" />
        </h1>
        <div className="home-search-field">
          <HomeSearchIcon className="home-search-icon" />
          <input
            type="search"
            aria-label={t('search')}
            className="home-search-input"
            placeholder={t('search')}
            ref={inputRef}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') searchState.rememberSearch(event.currentTarget.value);
              if (event.key === 'Escape') searchState.clearSearch();
            }}
          />
          {isSearching && (
            <button
              className="home-search-clear"
              type="button"
              aria-label={t('search.clear')}
              onClick={searchState.clearSearch}
            >
              <HomeSearchClearIcon />
            </button>
          )}
        </div>
        {!isSearching && searchState.recentSearches.length > 0 && (
          <div className="home-search-history">
            <span>{t('search.recent')}</span>
            {searchState.recentSearches.map((keyword) => (
              <button
                key={keyword}
                type="button"
                onClick={() => {
                  const input = inputRef.current!;
                  input.value = keyword;
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.focus();
                }}
              >
                {keyword}
              </button>
            ))}
            <button
              className="home-search-history-clear"
              type="button"
              aria-label={t('search.clear_history')}
              title={t('search.clear_history')}
              onClick={searchState.clearSearchHistory}
            >
              <HomeSearchClearIcon />
            </button>
          </div>
        )}
        {isSearching && (
          <SearchResultsPanel
            className="home-search-results"
            height="calc(100vh - 184px)"
            state={searchState}
            panelClassName="home-search-result-panel"
          />
        )}
      </header>
      {!isSearching && (
        <main className="home-bookcase-section">
          <div className="home-section-inner">
            <div className="home-section-head">
              <h2 className="home-section-title">{t(bookList.length ? 'home.continue' : 'home.start')}</h2>
              <div className="home-section-actions">
                <button className="library-import-button" type="button" onClick={onAdd}>
                  <HomePlusIcon />
                  <span>{t('import.books')}</span>
                </button>
                <Link className="home-shelf-link" to={ROUTE_PATH.SHELF}>
                  {t('my_bookcase')}
                </Link>
              </div>
            </div>
            {recentBookList.length > 0 ? (
              <div className="home-book-grid">
                {recentBookList.map((book) => (
                  <BookCard book={book} key={book.id} />
                ))}
              </div>
            ) : (
              <div className="library-empty">
                <BookCoverFallback title="微信读书" />
                <h3>{t('shelf.empty')}</h3>
                <p>{t('import.supported_formats')}</p>
                <button className="library-primary-button" type="button" onClick={onAdd}>
                  {t('import.books')}
                </button>
              </div>
            )}
          </div>
        </main>
      )}
      <ImportConflictDialog state={conflictState} onCancel={onCancelConflict} onConfirm={onConfirmConflict} />
    </div>
  );
};

export const MobileHome = (): React.JSX.Element => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { bookList, setBookList } = useHomeBookList();
  const searchState = useBookSearch(inputRef);
  const { conflictState, onAdd, onCancelConflict, onConfirmConflict } = useHomeBookImport(bookList, setBookList);
  const recentBookList = useMemo(() => getRecentHomeBooks(bookList), [bookList]);

  return (
    <div className="home-page home-page-mobile w-full min-h-svh">
      <div className="home-mobile-top">
        <div className="home-brand home-brand-mobile">
          <img alt="" src={`${import.meta.env.BASE_URL}read.svg`} />
          <span>weread</span>
        </div>
        <div className="home-mobile-search">
          <HomeSearchIcon className="home-mobile-search-icon" />
          <input ref={inputRef} placeholder={t('search')} type="text" />
          {searchState.searchValue && (
            <button
              aria-label={t('search.clear')}
              className="home-mobile-search-clear"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={searchState.clearSearch}
            >
              <HomeSearchClearIcon style={{ display: 'block', width: 16, height: 16 }} />
            </button>
          )}
        </div>
      </div>
      {searchState.searchValue && (
        <div className="px-5">
          <SearchResultsPanel state={searchState} panelClassName="block mx-auto bg-front-bg-color-3 rounded-xl mb-6" />
        </div>
      )}
      {!searchState.searchValue && (
        <div className="px-5 pb-10">
          <div className="home-section-head home-section-head-mobile">
            <h2 className="home-section-title">{t('home.recent')}</h2>
            <Link className="home-shelf-link" to={ROUTE_PATH.SHELF}>
              <span>{t('shelf.view')}</span>
              <HomeArrowRightIcon style={{ width: 14, height: 14 }} />
            </Link>
          </div>
          <div className="home-book-grid home-book-grid-mobile">
            <ImportCard className="home-import-card home-import-card-mobile" iconSize={32} onAdd={onAdd} />
            {recentBookList.map((book) => (
              <BookCard book={book} key={book.id} />
            ))}
          </div>
        </div>
      )}
      <ImportConflictDialog state={conflictState} onCancel={onCancelConflict} onConfirm={onConfirmConflict} />
    </div>
  );
};
