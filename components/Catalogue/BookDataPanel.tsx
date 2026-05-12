import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';
import { BookCoverFallback } from '@/components/BookCard';
import { ChevronDownIcon, ChevronUpIcon } from '@/components/Catalogue/BookDataPanelIcons';
import { buildBookDataPanelData, getMonthBarWidth } from '@/components/Catalogue/bookDataPanelData';

interface BookDataPanelProps {
  bookDetail: BookInfo | null;
  coverFailed: boolean;
  coverUrl?: string;
  onClose: () => void;
  onCoverError: () => void;
  open: boolean;
  revision: number;
  textSyntaxTree: TextSyntaxTree;
}

const PANEL_MOTION_DURATION = 180;

export const BookDataPanel = ({
  bookDetail,
  coverFailed,
  coverUrl,
  onClose,
  onCoverError,
  open,
  revision,
  textSyntaxTree,
}: BookDataPanelProps): React.JSX.Element | null => {
  const [shouldRender, setShouldRender] = useState(open);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [animateBars, setAnimateBars] = useState(true);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setExpandedMonth(null);
      return;
    }
    const timer = window.setTimeout(() => setShouldRender(false), PANEL_MOTION_DURATION);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  const bookData = useMemo(() => {
    if (!shouldRender || !bookDetail) return null;
    return buildBookDataPanelData(bookDetail, textSyntaxTree);
  }, [bookDetail, revision, shouldRender, textSyntaxTree]);

  useEffect(() => {
    if (!bookData) return;
    setExpandedMonth((current) => {
      if (bookData.monthlyRecords.length === 0) return null;
      if (current !== null && current >= bookData.monthlyRecords.length) return null;
      return current;
    });
  }, [bookData]);

  const handleExpand = useCallback((index: number) => {
    setExpandedMonth((current) => (current === index ? null : index));
    setAnimateBars(false);
    window.setTimeout(() => setAnimateBars(true), 50);
  }, []);

  const shareCurrentBook = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href);
  }, []);

  const stopPanelEvent = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  const closeFromBackdrop = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.currentTarget === event.target) {
        onClose();
      }
    },
    [onClose],
  );

  if (!shouldRender || !bookData) return null;

  return (
    <div className="reader-catalog-data-overlay" data-state={open ? 'open' : 'closed'} onMouseDown={closeFromBackdrop}>
      <div
        className="reader-catalog-data-sheet bg-[#1e1e1e] w-full shadow-2xl overflow-hidden relative text-white"
        onMouseDown={stopPanelEvent}
      >
        <div className="p-6 pb-5">
          <div className="flex justify-between items-start mb-6 mt-2">
            <div className="flex-1 pr-6 flex flex-col justify-between min-w-0">
              <h2 className="text-[20px] font-bold text-gray-100 leading-snug tracking-wide line-clamp-2">
                {bookData.title}
              </h2>
              <div className="mt-3 text-[13px] text-gray-400">上次阅读 · {bookData.lastRead}</div>
            </div>
            <div className="w-[72px] h-[100px] flex-shrink-0 rounded shadow-md overflow-hidden bg-white/5 border border-white/10">
              {coverUrl && !coverFailed ? (
                <img
                  className="w-full h-full object-cover"
                  src={coverUrl}
                  alt={bookData.title}
                  onError={onCoverError}
                />
              ) : (
                <BookCoverFallback className="w-full h-full" title={bookData.title} />
              )}
            </div>
          </div>

          <div className="bg-[#2a2a2a] rounded-[16px] p-5 mb-4">
            <div className="flex justify-around mb-2 mt-1">
              <div className="flex flex-col items-center justify-center px-1">
                <span className="text-[13px] text-gray-400 mb-1">总字数</span>
                <div className="flex items-baseline gap-[2px]">
                  <span className="text-[26px] font-semibold text-gray-100">{bookData.totalWords.value}</span>
                  <span className="text-[12px] text-gray-300 font-normal">{bookData.totalWords.unit}</span>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-1">
                <span className="text-[13px] text-gray-400 mb-1">阅读天数</span>
                <div className="flex items-baseline gap-[2px]">
                  <span className="text-[26px] font-semibold text-gray-100">{bookData.readingDays}</span>
                  <span className="text-[12px] text-gray-300 font-normal">天</span>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center px-1">
                <span className="text-[13px] text-gray-400 mb-1">阅读进度</span>
                <div className="flex items-baseline gap-[2px]">
                  <span className="text-[26px] font-semibold text-gray-100">{bookData.readPercent}</span>
                  <span className="text-[12px] text-gray-300 font-normal">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#2a2a2a] rounded-[16px] p-5">
            <div className="flex justify-between mb-6 px-1">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-gray-400 mb-1">累计时长</div>
                <div className="flex items-baseline gap-[2px]">
                  <span className="text-[22px] font-bold text-gray-100">{bookData.totalDuration.hours}</span>
                  <span className="text-[12px] text-gray-300 font-normal mr-1">小时</span>
                  <span className="text-[22px] font-bold text-gray-100">{bookData.totalDuration.minutes}</span>
                  <span className="text-[12px] text-gray-300 font-normal">分钟</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">{bookData.startLabel}</div>
              </div>

              <div className="flex-1 pl-6 min-w-0">
                <div className="text-[13px] text-gray-400 mb-1">单日阅读最久</div>
                <div className="flex items-baseline gap-[2px]">
                  <span className="text-[22px] font-bold text-gray-100">{bookData.maxDailyDuration.hours}</span>
                  <span className="text-[12px] text-gray-300 font-normal mr-1">小时</span>
                  <span className="text-[22px] font-bold text-gray-100">{bookData.maxDailyDuration.minutes}</span>
                  <span className="text-[12px] text-gray-300 font-normal">分钟</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">{bookData.maxDailyDate}</div>
              </div>
            </div>

            {bookData.showReadingRecords ? (
              <div className="space-y-2 mt-2">
                {bookData.monthlyRecords.length > 0 ? (
                  bookData.monthlyRecords.map((record, index) => {
                    const isExpanded = expandedMonth === index;
                    const isAnyExpanded = expandedMonth !== null;
                    const barWidth = `${getMonthBarWidth({
                      isAnyExpanded,
                      isExpanded,
                      progress: record.calculatedProgress,
                    })}%`;

                    return (
                      <div className="flex flex-col" key={record.monthKey}>
                        {isExpanded ? (
                          <div className="flex justify-between items-center px-1 mb-1 mt-1">
                            <div className="text-[14px] text-gray-300">
                              <span className="font-bold">{record.month}</span>
                              <span className="mx-1">·</span>
                              <span className="font-bold">{record.time}</span>
                            </div>
                            <button
                              className="w-7 h-7 flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                              type="button"
                              onClick={() => handleExpand(index)}
                            >
                              <ChevronUpIcon />
                            </button>
                          </div>
                        ) : (
                          <button
                            className="relative w-full h-[28px] bg-[#282828] rounded-[6px] flex items-center px-3 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden text-left"
                            type="button"
                            onClick={() => handleExpand(index)}
                          >
                            <div
                              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#5bcdae] to-[#45b799] rounded-[6px] transition-[width] duration-300 ease-out"
                              style={{ width: barWidth }}
                            ></div>

                            <div className="relative z-10 w-full flex justify-between items-center text-[14px] text-white">
                              <div>
                                <span className="font-bold">{record.month}</span>
                                <span className="mx-1">·</span>
                                <span className="font-bold">{record.time}</span>
                              </div>
                              <ChevronDownIcon />
                            </div>
                          </button>
                        )}

                        <div
                          className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${
                            isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2 mb-1' : 'grid-rows-[0fr] opacity-0 mt-0 mb-0'
                          }`}
                        >
                          <div className="overflow-hidden space-y-2">
                            {record.days.map((day) => {
                              const dayBarWidth = isExpanded && animateBars ? `${day.calculatedProgress}%` : '0%';

                              return (
                                <div className="relative w-full h-[28px] bg-[#1e2227] rounded-[6px]" key={day.dayKey}>
                                  <div
                                    className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#68b5e6] to-[#4b9ee2] rounded-[6px] transition-[width] duration-[300ms] ease-out overflow-hidden"
                                    style={{ width: dayBarWidth }}
                                  >
                                    <div className="h-full w-full flex justify-between items-center px-3">
                                      <span className="text-[13px] font-medium text-white whitespace-nowrap">
                                        {day.date}
                                      </span>
                                      <span className="text-[13px] font-bold text-white whitespace-nowrap">
                                        {day.time}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-[44px] flex items-center justify-center text-[13px] text-gray-500">
                    暂无阅读记录
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-2">
          <button
            className="flex-1 bg-[#3a3a3a] hover:bg-[#4a4a4a] text-[#e0e0e0] py-[14px] rounded-[12px] font-medium text-[15px] transition-colors"
            type="button"
          >
            导出用户数据
          </button>
          <button
            className="flex-1 bg-[#0095ff] hover:bg-[#0084eb] text-white py-[14px] rounded-[12px] font-medium text-[15px] transition-colors shadow-lg shadow-blue-500/20"
            type="button"
            onClick={shareCurrentBook}
          >
            分享此书
          </button>
        </div>
      </div>
    </div>
  );
};
