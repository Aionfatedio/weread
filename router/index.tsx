import { Component, Suspense, lazy } from 'react';
import { Navigate, useRoutes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { Loading } from '@/components/Loading/index';
import { t } from '@/locales';

// Each route's bundle is fetched on demand. The reader page in particular
// pulls in EPUB parsing, the worker glue, and large rendering modules, so
// keeping it out of the initial chunk meaningfully cuts time-to-interactive.
const Home = lazy(() => import('@/pages/home/index').then((m) => ({ default: m.Home })));
const BookDetail = lazy(() => import('@/pages/book-detail/index').then((m) => ({ default: m.BookDetail })));
const Shelf = lazy(() => import('@/pages/shelf/index').then((m) => ({ default: m.Shelf })));

export enum ROUTE_PATH {
  HOME = '/',
  READER = '/reader',
  SHELF = '/shelf',
}

export const createReaderPath = (bookId: string | number): string =>
  `${ROUTE_PATH.READER}/${encodeURIComponent(bookId)}`;

// Lazy chunks can fail to load (offline, or a deploy replaced the hashed
// files this page's bundle still references). Without a boundary that
// rejection unmounts the whole tree into a blank page; offer a reload instead.
class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4">
        <div className="text-text-color-2">{t('route.load_failed')}</div>
        <button
          className="px-4 py-2 rounded-lg border border-border-color-1 text-text-color-1 cursor-pointer"
          type="button"
          onClick={() => window.location.reload()}
        >
          {t('route.reload')}
        </button>
      </div>
    );
  }
}

const withSuspense = (element: ReactElement): ReactElement => (
  <RouteErrorBoundary>
    <Suspense fallback={<Loading />}>{element}</Suspense>
  </RouteErrorBoundary>
);

export const Routes = (): ReactElement | null => {
  return useRoutes([
    {
      path: ROUTE_PATH.HOME,
      element: withSuspense(<Home />),
    },
    {
      path: `${ROUTE_PATH.READER}/:bookId`,
      element: withSuspense(<BookDetail />),
    },
    {
      path: ROUTE_PATH.SHELF,
      element: withSuspense(<Shelf />),
    },
    {
      path: '*',
      element: <Navigate to={ROUTE_PATH.HOME} replace />,
    },
  ]);
};
