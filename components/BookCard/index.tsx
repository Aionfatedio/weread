import { useHref, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { BookInfo } from '@/store/books';
import { clearReaderSignals } from '@/lib/subscribe';
import { startSpaViewTransition } from '@/lib/navigation';
import { createReaderPath } from '@/router';
import { useIsMobile } from '@/lib/hooks';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import { getReaderProgress } from '@/lib/readerProgress';
import { getReaderBookStatus } from '@/lib/readerBookStatus';
import { t } from '@/locales';
import './index.scss';

interface BookCardProps {
  book: BookInfo;
}

// "已读 12%" / "未读" / "读完" — mirrors the WeRead recent-reading card label.
export const getBookProgressLabel = (bookId: string | undefined): string => {
  if (!bookId) return t('book.progress.unread');
  if (getReaderBookStatus(bookId) === 'finished') return t('book.progress.finished');
  const percent = getReaderProgress(bookId)?.readPercent;
  if (typeof percent === 'number' && Number.isFinite(percent) && percent > 0) {
    return t('book.progress.read', [Math.min(Math.round(percent), 100)]);
  }
  return t('book.progress.unread');
};

const useBookCardNavigate = (id: string | number | undefined) => {
  const navigate = useNavigate();
  return (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (id === undefined) return;
    const target = createReaderPath(id);
    startSpaViewTransition(() => {
      clearReaderSignals();
      navigate(target);
    });
  };
};

export const BookCoverFallback = ({
  className = '',
  title = '',
}: {
  className?: string;
  title?: string;
}): React.JSX.Element => {
  return (
    <div className={`book-cover-fallback ${className}`} aria-hidden="true" title={title}>
      <svg xmlns="http://www.w3.org/2000/svg" width="60%" height="60%" fill-opacity="0.3" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M5 19V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v13H7a2 2 0 0 0-2 2m0 0a2 2 0 0 0 2 2h12M9 3v14m7 0v4"
        />
      </svg>
    </div>
  );
};

export const BookCard = ({ book }: BookCardProps): React.JSX.Element => {
  const isMobile = useIsMobile();
  const { id, image, title = '', author = '' } = book || {};
  const onClick = useBookCardNavigate(id);
  const href = useHref(createReaderPath(id ?? ''));
  const resolvedImage = useResolvedBookImage(id, image);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(resolvedImage && !imageFailed);
  const progressLabel = getBookProgressLabel(id);
  useEffect(() => {
    setImageFailed(false);
  }, [id, image]);

  return (
    <a
      onClick={onClick}
      href={href}
      style={{ viewTransitionName: `book-info-${id}` }}
      className={`book-card-item ${isMobile ? 'book-card-mobile' : 'book-card-desktop'}`}
    >
      <div className="book-card-cover">
        {shouldShowImage ? (
          <img src={resolvedImage} alt={title} onError={() => setImageFailed(true)} />
        ) : (
          <BookCoverFallback title={title} />
        )}
      </div>
      <div className="book-card-info">
        <div className="book-card-title" title={title}>
          {title}
        </div>
        {author && (
          <div className="book-card-author" title={author}>
            {author}
          </div>
        )}
        <div className="book-card-progress">{progressLabel}</div>
      </div>
    </a>
  );
};
