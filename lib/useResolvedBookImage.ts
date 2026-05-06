import { useEffect, useState } from 'react';
import {
  getBookResourceUrl,
  isResourcePlaceholderUrl,
  parseResourcePlaceholderKey,
} from '@/lib/bookResources';

export const useResolvedBookImage = (bookId: string | undefined, image: string | undefined): string => {
  const [resolved, setResolved] = useState<string>(() => (image && !isResourcePlaceholderUrl(image) ? image : ''));

  useEffect(() => {
    if (!image) {
      setResolved('');
      return;
    }
    if (!isResourcePlaceholderUrl(image)) {
      setResolved(image);
      return;
    }
    if (!bookId) {
      setResolved('');
      return;
    }
    const key = parseResourcePlaceholderKey(image);
    if (!key) {
      setResolved('');
      return;
    }

    let active = true;
    getBookResourceUrl(bookId, key).then((url) => {
      if (active) setResolved(url || '');
    });
    return () => {
      active = false;
    };
  }, [bookId, image]);

  return resolved;
};
