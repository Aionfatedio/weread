import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_FONT_SIZE,
  MAX_READER_FONT_SIZE,
  MIN_READER_FONT_SIZE,
  type ReaderFontSetting,
  applyReaderFont,
  applyReaderFontSize,
  emitReaderSettingChange,
  getStoredReaderFont,
  getStoredReaderFontSize,
  saveReaderFont,
  saveReaderFontSize,
} from '@/lib/readerSettings';
import {
  type BrowserLocalFont,
  FONT_CATEGORY_ITEMS,
  type FontCategory,
  getFontCategory,
  mergeReaderFonts,
  normalizeLocalFonts,
} from '@/components/DetailOperate/fontPanelUtils';
import { t } from '@/locales';
import { getReaderLocalFonts, importReaderLocalFont } from '@/lib/readerFonts';
import { getErrorMessage } from '@/lib/utils';

const FONT_SIZE_APPLY_DELAY = 300;

const LOCAL_FONT_FILE_PATTERN = /\.(?:otf|ttf|woff|woff2)$/i;

let readerSessionSystemFonts: ReaderFontSetting[] = [];

const isMobileFontAccessViewport = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 760px)').matches;
};

const getReaderFontLabel = (font: ReaderFontSetting): string => {
  return font.id === DEFAULT_READER_FONT.id ? t('font.default') : font.label;
};

const clampReaderFontSize = (value: number): number => {
  return Math.min(Math.max(value, MIN_READER_FONT_SIZE), MAX_READER_FONT_SIZE);
};

export const ReaderFontControlPanel = (): React.JSX.Element => {
  const categoryRef = useRef<HTMLDivElement>(null);
  const fontGridRef = useRef<HTMLDivElement>(null);
  const localFontInputRef = useRef<HTMLInputElement>(null);
  const fontSizeApplyTimerRef = useRef<number | null>(null);
  const pendingFontSizeRef = useRef<number | null>(null);
  const [fontSize, setFontSize] = useState(DEFAULT_READER_FONT_SIZE);
  const [selectedFont, setSelectedFont] = useState<ReaderFontSetting>(DEFAULT_READER_FONT);
  const [systemFonts, setSystemFonts] = useState<ReaderFontSetting[]>(() =>
    mergeReaderFonts(readerSessionSystemFonts, getReaderLocalFonts()),
  );
  const [activeCategory, setActiveCategory] = useState<FontCategory>('all');
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const [fontAccessMessage, setFontAccessMessage] = useState('');
  const [isMobileFontAccess, setIsMobileFontAccess] = useState(isMobileFontAccessViewport);

  useEffect(() => {
    const storedFont = getStoredReaderFont();
    const storedFontSize = getStoredReaderFontSize();
    const normalizedFontSize = clampReaderFontSize(storedFontSize);
    setSelectedFont(storedFont);
    setFontSize(normalizedFontSize);
    if (normalizedFontSize !== storedFontSize) {
      saveReaderFontSize(normalizedFontSize);
    }
    const nextSystemFonts =
      storedFont.source === 'system'
        ? mergeReaderFonts(readerSessionSystemFonts, getReaderLocalFonts(), [storedFont])
        : mergeReaderFonts(readerSessionSystemFonts, getReaderLocalFonts());
    readerSessionSystemFonts = nextSystemFonts;
    setSystemFonts(nextSystemFonts);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 760px)');
    const updateMobileFontAccess = () => {
      setIsMobileFontAccess(media.matches);
    };
    updateMobileFontAccess();
    media.addEventListener('change', updateMobileFontAccess);
    return () => {
      media.removeEventListener('change', updateMobileFontAccess);
    };
  }, []);

  useEffect(() => {
    const input = localFontInputRef.current;
    if (!input) return;
    if (isMobileFontAccess) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
      return;
    }
    input.removeAttribute('webkitdirectory');
    input.removeAttribute('directory');
  }, [isMobileFontAccess]);

  const fontOptions = useMemo(() => {
    const optionMap = new Map<string, ReaderFontSetting>();
    optionMap.set(DEFAULT_READER_FONT.id, DEFAULT_READER_FONT);
    systemFonts.forEach((font) => optionMap.set(font.id, font));
    if (selectedFont.source !== 'default') {
      optionMap.set(selectedFont.id, selectedFont);
    }
    return Array.from(optionMap.values());
  }, [selectedFont, systemFonts]);

  const fontCategories = useMemo(() => {
    return FONT_CATEGORY_ITEMS.map((item) => {
      const count =
        item.key === 'all'
          ? fontOptions.length
          : fontOptions.filter((font) => getFontCategory(font) === item.key).length;
      return { ...item, count };
    });
  }, [fontOptions]);

  const visibleFonts = useMemo(() => {
    if (activeCategory === 'all') return fontOptions;
    return fontOptions.filter((font) => getFontCategory(font) === activeCategory);
  }, [activeCategory, fontOptions]);

  const flushFontSize = useCallback(() => {
    if (fontSizeApplyTimerRef.current !== null) {
      window.clearTimeout(fontSizeApplyTimerRef.current);
      fontSizeApplyTimerRef.current = null;
    }
    const nextFontSize = pendingFontSizeRef.current;
    pendingFontSizeRef.current = null;
    if (nextFontSize === null) return;
    saveReaderFontSize(nextFontSize);
    applyReaderFontSize(nextFontSize);
    emitReaderSettingChange();
  }, []);

  const scheduleApplyFontSize = (nextFontSize: number) => {
    setFontSize(nextFontSize);
    pendingFontSizeRef.current = nextFontSize;
    if (fontSizeApplyTimerRef.current !== null) window.clearTimeout(fontSizeApplyTimerRef.current);
    fontSizeApplyTimerRef.current = window.setTimeout(flushFontSize, FONT_SIZE_APPLY_DELAY);
  };

  useEffect(() => () => flushFontSize(), [flushFontSize]);

  const onSelectFont = useCallback((font: ReaderFontSetting) => {
    setSelectedFont(font);
    saveReaderFont(font);
    applyReaderFont(font);
    emitReaderSettingChange();
  }, []);

  const requestSystemFonts = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext) {
      setFontAccessMessage(t('font.requires_secure_context'));
      return;
    }

    const queryLocalFonts = (window as Window & { queryLocalFonts?: () => Promise<BrowserLocalFont[]> })
      .queryLocalFonts;

    if (!queryLocalFonts) {
      setFontAccessMessage(t('font.unsupported_local_access'));
      return;
    }

    setIsLoadingFonts(true);
    setFontAccessMessage(t('font.requesting_permission'));

    try {
      const fonts = await queryLocalFonts.call(window);
      const localFonts = await normalizeLocalFonts(fonts);
      readerSessionSystemFonts = localFonts;
      setSystemFonts(mergeReaderFonts(localFonts, getReaderLocalFonts()));
      setFontAccessMessage(localFonts.length > 0 ? '' : t('font.no_chinese_system_fonts'));
    } catch {
      setFontAccessMessage(t('font.permission_denied'));
    } finally {
      setIsLoadingFonts(false);
    }
  }, []);

  const requestLocalFonts = useCallback(() => {
    setFontAccessMessage('');
    localFontInputRef.current?.click();
  }, []);

  const onLocalFontInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length === 0) return;

    setIsLoadingFonts(true);
    setFontAccessMessage(t('font.loading_local'));
    try {
      const localFonts: ReaderFontSetting[] = [];
      for (const file of files.filter((file) => LOCAL_FONT_FILE_PATTERN.test(file.name))) {
        localFonts.push(await importReaderLocalFont(file));
      }
      const nextFonts = mergeReaderFonts(readerSessionSystemFonts, localFonts);
      readerSessionSystemFonts = nextFonts;
      setSystemFonts(nextFonts);
      setFontAccessMessage(localFonts.length > 0 ? '' : t('font.no_loadable_fonts'));
    } catch (error) {
      setSystemFonts(mergeReaderFonts(readerSessionSystemFonts, getReaderLocalFonts()));
      setFontAccessMessage(getErrorMessage(error));
    } finally {
      setIsLoadingFonts(false);
    }
  }, []);

  const requestFontAccess = isMobileFontAccess ? requestLocalFonts : requestSystemFonts;

  useEffect(() => {
    const categoryElement = categoryRef.current;
    if (!categoryElement) return;
    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-font-category]');
      const category = button?.dataset.fontCategory as FontCategory | undefined;
      if (category) {
        setActiveCategory(category);
      }
    };
    categoryElement.addEventListener('click', onClick);
    return () => {
      categoryElement.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const fontGridElement = fontGridRef.current;
    if (!fontGridElement) return;
    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement)?.closest<HTMLButtonElement>('[data-font-id]');
      const fontId = button?.dataset.fontId;
      const font = fontOptions.find((item) => item.id === fontId);
      if (font) {
        onSelectFont(font);
      }
    };
    fontGridElement.addEventListener('click', onClick);
    return () => {
      fontGridElement.removeEventListener('click', onClick);
    };
  }, [fontOptions, onSelectFont]);

  const fontSizeProgressRatio =
    (clampReaderFontSize(fontSize) - MIN_READER_FONT_SIZE) / (MAX_READER_FONT_SIZE - MIN_READER_FONT_SIZE);
  const defaultFontSizeProgressRatio =
    (DEFAULT_READER_FONT_SIZE - MIN_READER_FONT_SIZE) / (MAX_READER_FONT_SIZE - MIN_READER_FONT_SIZE);

  return (
    <div className="reader-font-control-panel-wrapper">
      <div className="reader-font-size-section">
        <div className="reader-font-panel-title">{t('font.size')}</div>
        <div
          className="font-panel-content-size-wrapper"
          style={
            {
              '--reader-font-size-default-dot-x': `calc(13px + (100% - 26px) * ${defaultFontSizeProgressRatio})`,
              '--reader-font-size-progress-width': `calc(26px + (100% - 26px) * ${fontSizeProgressRatio})`,
              '--reader-font-size-thumb-x': `calc(13px + (100% - 26px) * ${fontSizeProgressRatio})`,
            } as React.CSSProperties
          }
        >
          <div className="reader_font_control_slider_wrapper font-panel-content-size-slider">
            <div className="reader_font_control_slider_track">
              <input
                type="range"
                className="reader-control-range"
                aria-label={t('font.size')}
                aria-valuetext={`${fontSize}px`}
                min={MIN_READER_FONT_SIZE}
                max={MAX_READER_FONT_SIZE}
                step={1}
                value={fontSize}
                onChange={(event) => scheduleApplyFontSize(event.currentTarget.valueAsNumber)}
                onBlur={flushFontSize}
              />
              <div className="reader_font_control_slider_track_progress"></div>
              <div className="reader_font_control_slider_track_pre"></div>
              <div className="reader_font_control_slider_track_post"></div>
              <div className="reader_font_control_slider_default_dot"></div>
              <div className="reader_font_control_slider_dot">
                <span>{fontSize}px</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="reader-font-family-section">
        <div className="reader-font-panel-heading">
          <div className="reader-font-panel-title">{t('font.family')}</div>
          <div className="reader-font-action-area">
            {fontAccessMessage && <span className="reader-font-access-message">{fontAccessMessage}</span>}
            <button
              className="reader-font-access-button"
              disabled={isLoadingFonts}
              type="button"
              onClick={() => {
                void requestFontAccess();
              }}
            >
              {isLoadingFonts ? t('common.loading') : isMobileFontAccess ? t('font.load_local') : t('font.get_system')}
            </button>
            <input
              ref={localFontInputRef}
              accept=".otf,.ttf,.woff,.woff2"
              className="reader-font-local-input"
              multiple
              type="file"
              onChange={onLocalFontInputChange}
            />
          </div>
        </div>

        <div className="reader-font-category-tabs" role="tablist" aria-label={t('font.category')} ref={categoryRef}>
          {fontCategories.map((item) => (
            <button
              className={`reader-font-category-tab ${activeCategory === item.key ? 'is-active' : ''}`}
              data-font-category={item.key}
              key={item.key}
              type="button"
            >
              {t(item.labelKey)}[{item.count}]
            </button>
          ))}
        </div>

        <div className="reader-font-grid" ref={fontGridRef}>
          {visibleFonts.length > 0 ? (
            visibleFonts.map((font) => (
              <button
                className={`reader-font-option ${selectedFont.id === font.id ? 'is-active' : ''}`}
                data-font-id={font.id}
                key={font.id}
                style={{
                  fontFamily: font.family || undefined,
                }}
                title={getReaderFontLabel(font)}
                type="button"
              >
                {getReaderFontLabel(font)}
              </button>
            ))
          ) : (
            <div className="reader-font-empty">{t('font.no_fonts')}</div>
          )}
        </div>
      </div>
    </div>
  );
};
