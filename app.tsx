import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Routes } from './router/index';
import { initDB, resumeDB } from './store';
import { GlobalFallback } from '@/components/GlobalFallback';
import { Loading } from '@/components/Loading';
import { t } from '@/locales';
import './styles/view-transition.scss';

export const App = (): JSX.Element => {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState(false);

  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      void resumeDB().then((ready) => {
        setDbReady(ready);
        setDbError(!ready);
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void initDB().then((ready) => {
      if (!cancelled) {
        setDbReady(ready);
        setDbError(!ready);
      }
    });

    document.addEventListener('visibilitychange', onVisibilityChange, false);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [onVisibilityChange]);
  if (!dbReady) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        {dbError ? (
          <p role="alert" className="max-w-md p-6 text-center">
            {t('storage.unavailable')}
          </p>
        ) : (
          <Loading />
        )}
        <GlobalFallback />
      </div>
    );
  }
  return (
    <div className="w-full h-full">
      <Routes />
      <GlobalFallback />
    </div>
  );
};
