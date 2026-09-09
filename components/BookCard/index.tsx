import { useHref, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { BookSummary } from '@/store/books';
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
  book: BookSummary;
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
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
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
  const tone = Array.from(title).reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 0) % 6;
  return (
    <div className={`book-cover-fallback ${className}`} data-cover-tone={tone} aria-hidden="true" title={title}>
      <div className="book-cover-pattern">
        <svg viewBox="0 0 100 112" focusable="false">
          <text x="50" y="94" textAnchor="middle">
            阅
          </text>
        </svg>
      </div>
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
      aria-label={`${title} · ${progressLabel}`}
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
        <div className="book-card-progress" aria-hidden="true">
          {progressLabel}
        </div>
      </div>
    </a>
  );
};
