import React, { useCallback, useEffect } from 'react';
import { Routes } from './router/index';
import { closeDB, initDB, resumeDB } from './store';
import { GlobalFallback } from '@/components/GlobalFallback';
import { Loading } from '@/components/Loading';
import 'ranui/button';
import './styles/view-transition.scss';
import '@khmyznikov/pwa-install';

export const App = (): React.JSX.Element => {
  const [dbReady, setDbReady] = React.useState(false);
  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      resumeDB();
    }
  }, []);
  const createPwaInstall = () => {
    const pwaInstall = document.createElement('pwa-install');
    pwaInstall.setAttribute('manifest-url', '/weread/manifest.json');
    pwaInstall.setAttribute('name', 'weread');
    pwaInstall.setAttribute('description', 'Progressive web application');
    pwaInstall.setAttribute('icon', '/weread/read.svg');
    document.body.appendChild(pwaInstall);
    return () => {
      document.body.removeChild(pwaInstall);
    };
  };
  useEffect(() => {
    let cancelled = false;
    initDB()
      .catch(() => false)
      .finally(() => {
        if (!cancelled) {
          setDbReady(true);
        }
      });
    const removePwaInstall = createPwaInstall();
    document.addEventListener('visibilitychange', onVisibilityChange, false);
    return () => {
      cancelled = true;
      closeDB();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      removePwaInstall();
    };
  }, []);
  if (!dbReady) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loading />
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
