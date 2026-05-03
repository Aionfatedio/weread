import { flushSync } from 'react-dom';

export const startSpaViewTransition = (apply: () => void): void => {
  const wrapped = () => flushSync(apply);
  const viewTransitionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  if (viewTransitionDocument.startViewTransition) {
    viewTransitionDocument.startViewTransition(wrapped);
  } else {
    wrapped();
  }
};
