import { useNavigate } from 'react-router-dom';
import type { BookInfo } from '@/store/books';
import {
  createEmptyReaderSearchHighlight,
  setCurrentBookDetail,
  setPageNum,
  setReaderNavigationTarget,
  setReaderSearchHighlight,
  setTextSyntaxTree,
} from '@/lib/subscribe';
import { createEmptyTextSyntaxTree } from '@/lib/transformText';
import { startSpaViewTransition } from '@/lib/navigation';
import { ROUTE_PATH } from '@/router';
import { useIsMobile } from '@/lib/hooks';
import { useResolvedBookImage } from '@/lib/useResolvedBookImage';
import './index.scss';

interface BookCardProps {
  book: BookInfo;
}

const clearReaderSignals = () => {
  setPageNum(0);
  setCurrentBookDetail(null);
  setReaderNavigationTarget({ revision: 0 });
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
  setTextSyntaxTree(createEmptyTextSyntaxTree());
};

const useBookCardNavigate = (id: string | number | undefined) => {
  const navigate = useNavigate();
  return (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (id === undefined) return;
    const target = `${ROUTE_PATH.BOOK_DETAIL}?id=${id}`;
    startSpaViewTransition(() => {
      clearReaderSignals();
      navigate(target);
    });
  };
};

const DESKTOP_CARD_CLASS =
  'w-2xs h-40 bg-front-bg-color-3 p-5 cursor-pointer rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5';

const MOBILE_CARD_CLASS =
  'w-24 h-36 bg-front-bg-color-3 p-3 cursor-pointer rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5';

export const BookCard = ({ book }: BookCardProps): React.JSX.Element => {
  const isMobile = useIsMobile();
  const { id, image, title = '', author = '' } = book || {};
  const onClick = useBookCardNavigate(id);
  const resolvedImage = useResolvedBookImage(id, image);

  return (
    <a
      onClick={onClick}
      href={`/weread/book-detail?id=${id}`}
      style={{ viewTransitionName: `book-info-${id}` }}
      className={isMobile ? MOBILE_CARD_CLASS : DESKTOP_CARD_CLASS}
    >
      {!isMobile && (
        <div className="grow-0">
          {resolvedImage && <img className="h-28 object-cover mr-5" src={resolvedImage} alt={title} />}
        </div>
      )}
      <div className={isMobile ? 'grow shrink basis-0 w-full overflow-hidden truncate' : 'grow shrink basis-0 min-w-36'}>
        <div className="text-text-color-1 font-medium truncate break-all" title={isMobile ? title : undefined}>
          {title}
        </div>
        <div className={`text-sm text-text-color-2 mt-2 ${isMobile ? 'truncate' : ''}`} title={isMobile ? author : undefined}>
          {author}
        </div>
      </div>
    </a>
  );
};
