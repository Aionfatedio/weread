import { useEffect, useState } from 'react';
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
import './index.scss';

interface BookCardProps {
  book: BookInfo;
}

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      const isMobileDevice = window.matchMedia('(max-width: 768px)').matches;
      setIsMobile(isMobileDevice);
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  return isMobile;
};

const clearReaderSignals = () => {
  setPageNum(0);
  setCurrentBookDetail(null);
  setReaderNavigationTarget({ revision: 0 });
  setReaderSearchHighlight(createEmptyReaderSearchHighlight());
  setTextSyntaxTree(createEmptyTextSyntaxTree());
};

const navigateToDetail = (
  navigate: ReturnType<typeof useNavigate>,
  id: string | number | undefined,
): void => {
  if (id === undefined) return;
  const target = `${ROUTE_PATH.BOOK_DETAIL}?id=${id}`;
  startSpaViewTransition(() => {
    clearReaderSignals();
    navigate(target);
  });
};

export const BookCard = ({ book }: BookCardProps): React.JSX.Element => {
  const isMobile = useIsMobile();

  return isMobile ? <MobileBookCard book={book} /> : <DesktopBookCard book={book} />;
};

export const DesktopBookCard = ({ book }: BookCardProps): React.JSX.Element => {
  const { id, image, title = '', author = '' } = book || {};
  const navigate = useNavigate();

  const toDetail = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    navigateToDetail(navigate, id);
  };

  return (
    <a
      onClick={toDetail}
      href={`/weread/book-detail?id=${id}`}
      style={{
        viewTransitionName: `book-info-${id}`,
      }}
      className="w-2xs h-40 bg-front-bg-color-3 p-5 cursor-pointer rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
    >
      <div className="grow-0">{image && <img className="h-28 object-cover mr-5" src={image} alt={title}></img>}</div>
      <div className="grow shrink basis-0 min-w-36">
        <div className="text-text-color-1 font-medium truncate break-all">{title}</div>
        <div className="text-sm text-text-color-2 mt-2">{author}</div>
      </div>
    </a>
  );
};

export const MobileBookCard = ({ book }: BookCardProps): React.JSX.Element => {
  const { id, title = '', author = '' } = book || {};
  const navigate = useNavigate();

  const toDetail = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    navigateToDetail(navigate, id);
  };

  return (
    <a
      onClick={toDetail}
      href={`/weread/book-detail?id=${id}`}
      style={{
        viewTransitionName: `book-info-${id}`,
      }}
      className="w-24 h-36 bg-front-bg-color-3 p-3 cursor-pointer rounded-xl mr-6 items-center flex hover:scale-110 transition-all mt-5"
    >
      {/* <div className="grow-0">{image && <img className="h-28 object-cover mr-5" src={image} alt={title}></img>}</div> */}
      <div className="grow shrink basis-0 w-full overflow-hidden truncate">
        <div className="text-text-color-1 font-medium truncate" title={title}>
          {title}
        </div>
        <div className="text-sm text-text-color-2 mt-2 truncate" title={author}>
          {author}
        </div>
      </div>
    </a>
  );
};
