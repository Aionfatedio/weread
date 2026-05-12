import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@/components/popover';
import { BookDetailMenu } from '@/components/DetailMenu';
import { EVENT_NAME, setReaderControlPanelActive, syncHook } from '@/lib/subscribe';
import { OcticonFont, OcticonMenu, OcticonNote, OcticonReadingMode } from '@/components/Octicon';
import { ReaderFontControlPanel } from '@/components/DetailOperate/ReaderFontControlPanel';
import { ReaderNotePanel } from '@/components/DetailOperate/ReaderNotePanel';
import { ReaderControlPanelLayer } from '@/components/DetailOperate/ReaderControlPanelLayer';
import { ReaderControlTooltip } from '@/components/DetailOperate/ReaderControlTooltip';
import { ReaderSettingControlPanel } from '@/components/DetailOperate/ReaderSettingControlPanel';
import { ReaderThemeControl } from '@/components/DetailOperate/ReaderThemeControl';
import {
  READER_CONTROL_PANEL_MOTION_DURATION,
  type ReaderControlPanelMotion,
  type ReaderControlPanelType,
} from '@/components/DetailOperate/controlPanelTypes';
import './index.scss';

const ReaderMenuIcon = (): React.JSX.Element => <OcticonMenu />;

const ReaderNoteIcon = (): React.JSX.Element => <OcticonNote />;

const ReaderSettingIcon = (): React.JSX.Element => <OcticonReadingMode />;

const ReaderFontIcon = (): React.JSX.Element => <OcticonFont />;

export const BookDetailOperate = (): React.JSX.Element => {
  const controlsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelCloseTimerRef = useRef<number | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const settingButtonRef = useRef<HTMLButtonElement>(null);
  const fontButtonRef = useRef<HTMLButtonElement>(null);
  const [activePanel, setActivePanel] = useState<ReaderControlPanelType | null>(null);
  const [renderedPanel, setRenderedPanel] = useState<ReaderControlPanelType | null>(null);
  const [panelMotion, setPanelMotion] = useState<ReaderControlPanelMotion>('enter');
  const [panelMotionId, setPanelMotionId] = useState(0);
  const isPanelActive = Boolean(activePanel);

  const clearPanelCloseTimer = useCallback(() => {
    if (panelCloseTimerRef.current) {
      window.clearTimeout(panelCloseTimerRef.current);
      panelCloseTimerRef.current = null;
    }
  }, []);

  const closePanel = useCallback(() => {
    clearPanelCloseTimer();
    setActivePanel(null);
    setPanelMotion('exit');
    setPanelMotionId((prev) => prev + 1);
    panelCloseTimerRef.current = window.setTimeout(() => {
      setRenderedPanel(null);
      panelCloseTimerRef.current = null;
    }, READER_CONTROL_PANEL_MOTION_DURATION);
  }, [clearPanelCloseTimer]);

  const openPanel = useCallback(
    (panel: ReaderControlPanelType) => {
      clearPanelCloseTimer();
      setRenderedPanel(panel);
      setPanelMotion(activePanel ? 'switch' : 'enter');
      setPanelMotionId((prev) => prev + 1);
      setActivePanel(panel);
    },
    [activePanel, clearPanelCloseTimer],
  );

  const togglePanel = useCallback(
    (panel: ReaderControlPanelType) => {
      if (activePanel === panel) {
        closePanel();
        return;
      }

      openPanel(panel);
    },
    [activePanel, closePanel, openPanel],
  );

  const getPanelAnchorElement = (panel: ReaderControlPanelType | null): HTMLElement | null => {
    if (panel === 'menu') return menuButtonRef.current;
    if (panel === 'note') return noteButtonRef.current;
    if (panel === 'setting') return settingButtonRef.current;
    if (panel === 'font') return fontButtonRef.current;
    return null;
  };

  useEffect(() => {
    return () => {
      clearPanelCloseTimer();
      setReaderControlPanelActive(false);
    };
  }, [clearPanelCloseTimer]);

  useEffect(() => {
    setReaderControlPanelActive(isPanelActive);
    return () => {
      setReaderControlPanelActive(false);
    };
  }, [isPanelActive]);

  useEffect(() => {
    if (!renderedPanel || panelMotion === 'exit' || panelMotion === 'idle') return;
    const timer = window.setTimeout(() => {
      setPanelMotion('idle');
    }, READER_CONTROL_PANEL_MOTION_DURATION);
    return () => {
      window.clearTimeout(timer);
    };
  }, [panelMotion, panelMotionId, renderedPanel]);

  useEffect(() => {
    syncHook.tap(EVENT_NAME.CLOSE_POPOVER, closePanel);
    return () => {
      syncHook.off(EVENT_NAME.CLOSE_POPOVER, closePanel);
    };
  }, [closePanel]);

  useEffect(() => {
    const openMenuSearchPanel = () => {
      openPanel('menu');
    };
    syncHook.tap(EVENT_NAME.OPEN_READER_MENU_SEARCH, openMenuSearchPanel);
    return () => {
      syncHook.off(EVENT_NAME.OPEN_READER_MENU_SEARCH, openMenuSearchPanel);
    };
  }, [openPanel]);

  useEffect(() => {
    if (!activePanel) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!target) return;
      if (controlsRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closePanel();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [activePanel, closePanel]);

  const panelContent = useMemo(() => {
    if (renderedPanel === 'menu') return <BookDetailMenu />;
    if (renderedPanel === 'note') return <ReaderNotePanel />;
    if (renderedPanel === 'setting') return <ReaderSettingControlPanel />;
    if (renderedPanel === 'font') return <ReaderFontControlPanel />;
    return null;
  }, [renderedPanel]);

  return (
    <>
      <div className="readerControls" ref={controlsRef}>
        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label="打开目录"
            aria-expanded={activePanel === 'menu'}
            className="reader-control-button reader-menu-control"
            ref={menuButtonRef}
            type="button"
            onClick={() => togglePanel('menu')}
          >
            <ReaderMenuIcon />
          </button>
          <ReaderControlTooltip label="目录" />
        </div>

        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label="打开笔记"
            aria-expanded={activePanel === 'note'}
            className="reader-control-button reader-note-control"
            ref={noteButtonRef}
            type="button"
            onClick={() => togglePanel('note')}
          >
            <ReaderNoteIcon />
          </button>
          <ReaderControlTooltip label="笔记" />
        </div>

        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label="打开阅读设置"
            aria-expanded={activePanel === 'setting'}
            className="reader-control-button reader-setting-control"
            ref={settingButtonRef}
            type="button"
            onClick={() => togglePanel('setting')}
          >
            <ReaderSettingIcon />
          </button>
          <ReaderControlTooltip label="阅读设置" />
        </div>

        <div className="reader-tooltip-container reader-control-tooltip-container">
          <button
            aria-label="打开字体设置"
            aria-expanded={activePanel === 'font'}
            className="reader-control-button reader-font-control"
            ref={fontButtonRef}
            type="button"
            onClick={() => togglePanel('font')}
          >
            <ReaderFontIcon />
          </button>
          <ReaderControlTooltip label="字体" />
        </div>

        <ReaderThemeControl />
      </div>
      <ReaderControlPanelLayer
        anchorElement={getPanelAnchorElement(activePanel || renderedPanel)}
        motion={panelMotion}
        motionId={panelMotionId}
        panelType={renderedPanel}
        panelRef={panelRef}
      >
        {panelContent}
      </ReaderControlPanelLayer>
    </>
  );
};

export const MobileBookDetailOperate = (): React.JSX.Element => {
  return (
    <div className="cursor-pointer">
      <Popover placement="top" trigger="click" overlay={<BookDetailMenu />}>
        <div className="reader-mobile-menu-trigger bg-front-bg-color-3 rounded-4xl flex items-center justify-center cursor-pointer">
          <ReaderMenuIcon />
        </div>
      </Popover>
    </div>
  );
};
