import { useEffect, useState } from 'react';

export enum DEVICE_ENUM {
  UNKNOWN = 'unknown',
  MOBILE = 'mobile',
  DESKTOP = 'desktop',
}

const MOBILE_QUERY = '(max-width: 768px)';

const detectDevice = (): DEVICE_ENUM => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return DEVICE_ENUM.UNKNOWN;
  return window.matchMedia(MOBILE_QUERY).matches ? DEVICE_ENUM.MOBILE : DEVICE_ENUM.DESKTOP;
};

export const useCheckDevice = (): [DEVICE_ENUM] => {
  const [currentDevice, setCurrentDevice] = useState<DEVICE_ENUM>(DEVICE_ENUM.UNKNOWN);

  useEffect(() => {
    const update = () => setCurrentDevice(detectDevice());
    update();
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return [currentDevice];
};

export const useIsMobile = (): boolean => {
  const [device] = useCheckDevice();
  return device === DEVICE_ENUM.MOBILE;
};
