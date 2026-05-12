import { clearChapterPaginationCache } from '@/lib/chapterPagination';
import { deleteReaderAnnotationsForBook } from '@/lib/readerAnnotations';
import { deleteReaderProgress } from '@/lib/readerProgress';
import { deleteReaderReadingTimeForBook } from '@/lib/readerReadingTime';

export const clearReaderBookData = (bookId?: string | null): void => {
  if (!bookId) return;
  deleteReaderProgress(bookId);
  deleteReaderAnnotationsForBook(bookId);
  deleteReaderReadingTimeForBook(bookId);
  clearChapterPaginationCache(bookId);
};
