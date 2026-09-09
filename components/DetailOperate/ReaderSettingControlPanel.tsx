import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_READER_PAGE_GAP_RATIO,
  DEFAULT_READER_SCROLL_PADDING_X,
  MAX_READER_PAGE_GAP_RATIO,
  MAX_READER_SCROLL_PADDING_X,
  MIN_READER_PAGE_GAP_RATIO,
  MIN_READER_SCROLL_PADDING_X,
  type ReaderFirstLineIndent,
  type ReaderPageTurnEffect,
  type ReaderReadingMode,
  applyReaderFirstLineIndent,
  emitReaderSettingChange,
  getStoredReaderFirstLineIndent,
  getStoredReaderPageGapRatio,
  getStoredReaderPageTurnEffect,
  getStoredReaderReadingMode,
  getStoredReaderScrollPaddingX,
  saveReaderFirstLineIndent,
  saveReaderPageGapRatio,
  saveReaderPageTurnEffect,
  saveReaderReadingMode,
  saveReaderScrollPaddingX,
} from '@/lib/readerSettings';
import { EVENT_NAME, syncHook } from '@/lib/subscribe';
import { t } from '@/locales';

const PAGE_TURN_EFFECT_OPTIONS: { key: ReaderPageTurnEffect; label: string }[] = [
  { key: 'jump', label: 'settings.page_turn.none' },
  { key: 'fade', label: 'settings.page_turn.fade' },
  { key: 'scroll', label: 'settings.page_turn.scroll' },
];

const READING_MODE_OPTIONS: { key: ReaderReadingMode; label: string }[] = [
  { key: 'paged', label: 'settings.mode.paged' },
  { key: 'scroll', label: 'settings.mode.scroll' },
];

const FIRST_LINE_INDENT_OPTIONS: { key: ReaderFirstLineIndent; label: string }[] = [
  { key: 'none', label: 'settings.indent.none' },
  { key: 'indent', label: 'settings.indent.indent' },
];

const SPACING_APPLY_DELAY = 300;

interface ReaderSpacingControlProps {
  readingMode: ReaderReadingMode;
}

const ReaderSpacingControl = ({ readingMode }: ReaderSpacingControlProps): React.JSX.Element => {
  const applyTimerRef = useRef<number | null>(null);
  const pendingApplyRef = useRef<(() => void) | null>(null);
  const [pageGapRatio, setPageGapRatio] = useState<number>(getStoredReaderPageGapRatio);
  const [scrollPaddingX, setScrollPaddingX] = useState<number>(getStoredReaderScrollPaddingX);

  const isPaged = readingMode === 'paged';
  const min = isPaged ? MIN_READER_PAGE_GAP_RATIO : MIN_READER_SCROLL_PADDING_X;
  const max = isPaged ? MAX_READER_PAGE_GAP_RATIO : MAX_READER_SCROLL_PADDING_X;
  const defaultValue = isPaged ? DEFAULT_READER_PAGE_GAP_RATIO : DEFAULT_READER_SCROLL_PADDING_X;
  const value = isPaged ? pageGapRatio : scrollPaddingX;
  const title = isPaged ? t('settings.page_gap') : t('settings.padding');
  const formatLabel = isPaged ? (v: number) => `${Math.round(v * 100)}%` : (v: number) => `${Math.round(v)}px`;

  const flushPendingApply = useCallback(() => {
    if (applyTimerRef.current) {
      window.clearTimeout(applyTimerRef.current);
      applyTimerRef.current = null;
    }
    const apply = pendingApplyRef.current;
    pendingApplyRef.current = null;
    apply?.();
  }, []);

  const scheduleApply = useCallback((next: number, paged: boolean) => {
    if (applyTimerRef.current) {
      window.clearTimeout(applyTimerRef.current);
    }
    pendingApplyRef.current = () => {
      if (paged) {
        saveReaderPageGapRatio(next);
      } else {
        saveReaderScrollPaddingX(next);
      }
      emitReaderSettingChange();
    };
    applyTimerRef.current = window.setTimeout(() => {
      applyTimerRef.current = null;
      const apply = pendingApplyRef.current;
      pendingApplyRef.current = null;
      apply?.();
    }, SPACING_APPLY_DELAY);
  }, []);

  useEffect(() => {
    flushPendingApply();
    setPageGapRatio(getStoredReaderPageGapRatio());
    setScrollPaddingX(getStoredReaderScrollPaddingX());
  }, [readingMode, flushPendingApply]);

  useEffect(() => {
    return () => {
      flushPendingApply();
    };
  }, [flushPendingApply]);

  const range = max - min;
  const ratio = range > 0 ? Math.min(Math.max((value - min) / range, 0), 1) : 0;
  const defaultRatio = range > 0 ? Math.min(Math.max((defaultValue - min) / range, 0), 1) : 0;

  return (
    <div className="reader-setting-section">
      <div className="reader-font-panel-title">{title}</div>
      <div
        className="font-panel-content-size-wrapper"
        style={
          {
            '--reader-font-size-default-dot-x': `calc(13px + (100% - 26px) * ${defaultRatio})`,
            '--reader-font-size-progress-width': `calc(26px + (100% - 26px) * ${ratio})`,
            '--reader-font-size-thumb-x': `calc(13px + (100% - 26px) * ${ratio})`,
          } as React.CSSProperties
        }
      >
        <div className="reader_font_control_slider_wrapper font-panel-content-size-slider">
          <div className="reader_font_control_slider_track">
            <input
              type="range"
              className="reader-control-range"
              aria-label={title}
              aria-valuetext={formatLabel(value)}
              min={min}
              max={max}
              step={isPaged ? 0.01 : 1}
              value={value}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (isPaged) setPageGapRatio(next);
                else setScrollPaddingX(next);
                scheduleApply(next, isPaged);
              }}
              onBlur={flushPendingApply}
            />
            <div className="reader_font_control_slider_track_progress"></div>
            <div className="reader_font_control_slider_default_dot"></div>
            <div className="reader_font_control_slider_dot">
              <span>{formatLabel(value)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ReaderSettingControlPanel = (): React.JSX.Element => {
  const pageTurnOptionRef = useRef<HTMLDivElement>(null);
  const readingModeOptionRef = useRef<HTMLDivElement>(null);
  const firstLineIndentOptionRef = useRef<HTMLDivElement>(null);
  const [pageTurnEffect, setPageTurnEffect] = useState<ReaderPageTurnEffect>(getStoredReaderPageTurnEffect);
  const [readingMode, setReadingMode] = useState<ReaderReadingMode>(getStoredReaderReadingMode);
  const [firstLineIndent, setFirstLineIndent] = useState<ReaderFirstLineIndent>(getStoredReaderFirstLineIndent);

  useEffect(() => {
    const optionElement = pageTurnOptionRef.current;
    if (!optionElement) return;

    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-page-turn-effect]');
      const effect = button?.dataset.pageTurnEffect as ReaderPageTurnEffect | undefined;
      if (!effect) return;
      setPageTurnEffect(effect);
      saveReaderPageTurnEffect(effect);
      emitReaderSettingChange();
    };

    optionElement.addEventListener('click', onClick);
    return () => {
      optionElement.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const optionElement = readingModeOptionRef.current;
    if (!optionElement) return;

    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-reading-mode]');
      const mode = button?.dataset.readingMode as ReaderReadingMode | undefined;
      if (!mode) return;
      syncHook.call(EVENT_NAME.FLUSH_READER_PROGRESS);
      setReadingMode(mode);
      saveReaderReadingMode(mode);
      emitReaderSettingChange();
      syncHook.call(EVENT_NAME.CLOSE_READER_CONTROL_PANEL);
    };

    optionElement.addEventListener('click', onClick);
    return () => {
      optionElement.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const optionElement = firstLineIndentOptionRef.current;
    if (!optionElement) return;

    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-first-line-indent]');
      const value = button?.dataset.firstLineIndent as ReaderFirstLineIndent | undefined;
      if (!value) return;
      setFirstLineIndent(value);
      saveReaderFirstLineIndent(value);
      applyReaderFirstLineIndent(value);
      emitReaderSettingChange();
    };

    optionElement.addEventListener('click', onClick);
    return () => {
      optionElement.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <div className="reader-setting-control-panel-wrapper">
      <div className="reader-setting-section">
        <div className="reader-font-panel-title">{t('settings.reading_mode')}</div>
        <div className="reader-reading-mode-options" ref={readingModeOptionRef}>
          {READING_MODE_OPTIONS.map((item) => (
            <button
              className={`reader-setting-option ${readingMode === item.key ? 'is-active' : ''}`}
              data-reading-mode={item.key}
              key={item.key}
              type="button"
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting-section">
        <div className="reader-font-panel-title">{t('settings.first_line_indent')}</div>
        <div className="reader-first-line-indent-options" ref={firstLineIndentOptionRef}>
          {FIRST_LINE_INDENT_OPTIONS.map((item) => (
            <button
              className={`reader-setting-option ${firstLineIndent === item.key ? 'is-active' : ''}`}
              data-first-line-indent={item.key}
              key={item.key}
              type="button"
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="reader-setting-section">
        <div className="reader-font-panel-title">{t('settings.page_turn')}</div>
        <div className="reader-page-turn-options" ref={pageTurnOptionRef}>
          {PAGE_TURN_EFFECT_OPTIONS.map((item) => (
            <button
              className={`reader-setting-option ${pageTurnEffect === item.key ? 'is-active' : ''}`}
              data-page-turn-effect={item.key}
              key={item.key}
              type="button"
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>

      <ReaderSpacingControl readingMode={readingMode} />
    </div>
  );
};
