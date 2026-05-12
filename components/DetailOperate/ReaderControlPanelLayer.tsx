import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { ReaderControlPanelMotion, ReaderControlPanelType } from '@/components/DetailOperate/controlPanelTypes';

interface ReaderControlPanelLayerProps {
  anchorElement: HTMLElement | null;
  children: React.ReactNode;
  motion: ReaderControlPanelMotion;
  motionId: number;
  panelType: ReaderControlPanelType | null;
  panelRef: React.RefObject<HTMLDivElement | null>;
}

const PANEL_OFFSET = 8;

const PANEL_VIEWPORT_MARGIN = 16;

export const ReaderControlPanelLayer = ({
  anchorElement,
  children,
  motion,
  motionId,
  panelType,
  panelRef,
}: ReaderControlPanelLayerProps): React.JSX.Element | null => {
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);

  const updatePosition = useCallback(() => {
    const panelElement = panelRef.current;
    if (!panelType || !anchorElement || !panelElement) return false;

    const anchorRect = anchorElement.getBoundingClientRect();
    const panelRect = panelElement.getBoundingClientRect();
    const panelWidth = panelElement.offsetWidth || panelRect.width;
    const panelHeight = panelElement.offsetHeight || panelRect.height;
    if (panelWidth <= 1 || panelHeight <= 1) {
      setPanelPosition(null);
      return false;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, viewportWidth - panelWidth - PANEL_VIEWPORT_MARGIN);
    const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, viewportHeight - panelHeight - PANEL_VIEWPORT_MARGIN);
    const left = Math.min(Math.max(anchorRect.left - panelWidth - PANEL_OFFSET, PANEL_VIEWPORT_MARGIN), maxLeft);
    const top = Math.min(Math.max(anchorRect.top, PANEL_VIEWPORT_MARGIN), maxTop);

    setPanelPosition((prev) => (prev?.left === left && prev.top === top ? prev : { left, top }));
    return true;
  }, [anchorElement, panelRef, panelType]);

  useLayoutEffect(() => {
    if (!panelType) return;
    setPanelPosition(null);

    let firstFrame = 0;
    let secondFrame = 0;
    if (!updatePosition()) {
      firstFrame = window.requestAnimationFrame(() => {
        if (!updatePosition()) {
          secondFrame = window.requestAnimationFrame(updatePosition);
        }
      });
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [motionId, panelType, updatePosition]);

  useEffect(() => {
    if (!panelType) return;

    window.addEventListener('resize', updatePosition);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && panelRef.current) {
      observer = new ResizeObserver(updatePosition);
      observer.observe(panelRef.current);
    }

    return () => {
      window.removeEventListener('resize', updatePosition);
      observer?.disconnect();
    };
  }, [panelRef, panelType, updatePosition]);

  if (!panelType) return null;

  return (
    <div className="reader-control-panel-layer">
      <div
        className="reader-control-panel"
        data-motion={motion}
        data-motion-id={motionId}
        data-reader-control-panel={panelType}
        ref={panelRef}
        style={
          {
            left: `${panelPosition?.left ?? 0}px`,
            top: `${panelPosition?.top ?? 0}px`,
            visibility: panelPosition ? 'visible' : 'hidden',
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
};
