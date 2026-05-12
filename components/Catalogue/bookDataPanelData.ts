import type { BookInfo } from '@/store/books';
import type { TextSyntaxTree } from '@/lib/transformText';
import { getReaderProgress } from '@/lib/readerProgress';
import { getReaderReadingTimeSummary } from '@/lib/readerReadingTime';

interface ReadingDayRecord {
  date: string;
  dayKey: string;
  durationMs: number;
  time: string;
  totalMinutes: number;
}

interface ReadingMonthRecord {
  days: ReadingDayRecord[];
  durationMs: number;
  month: string;
  monthKey: string;
  time: string;
  totalMinutes: number;
}

export interface ProcessedReadingDayRecord extends ReadingDayRecord {
  calculatedProgress: number;
  ratioProgress: number;
}

export interface ProcessedReadingMonthRecord extends ReadingMonthRecord {
  calculatedProgress: number;
  days: ProcessedReadingDayRecord[];
  ratioProgress: number;
}

export interface BookDataPanelData {
  lastRead: string;
  maxDailyDate: string;
  maxDailyDuration: { hours: number; minutes: number };
  monthlyRecords: ProcessedReadingMonthRecord[];
  readPercent: string;
  readingDays: number;
  showReadingRecords: boolean;
  startLabel: string;
  title: string;
  totalDuration: { hours: number; minutes: number };
  totalWords: { unit: string; value: string };
}

const PROGRESS_BASE_PERCENT = 30;

const MIN_READING_RECORD_DURATION_MS = 60_000;

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const getRatioPercent = (value: number, base: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) return 0;
  return clampPercent((value / base) * 100);
};

const getWeightedProgressPercent = (ratioPercent: number, basePercent = PROGRESS_BASE_PERCENT): number => {
  const safeBasePercent = clampPercent(basePercent);
  const safeRatioPercent = clampPercent(ratioPercent);
  return clampPercent(safeBasePercent + (safeRatioPercent / 100) * (100 - safeBasePercent));
};

export const getMonthBarWidth = ({
  isAnyExpanded,
  isExpanded,
  progress,
}: {
  isAnyExpanded: boolean;
  isExpanded: boolean;
  progress: number;
}): number => {
  if (isAnyExpanded && !isExpanded) return 100;
  return clampPercent(progress);
};

const getMinutesFromDuration = (durationMs: number): number => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.floor(durationMs / 60_000);
};

const formatDurationText = (durationMs: number): string => {
  const totalMinutes = getMinutesFromDuration(durationMs);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}小时${minutes}分钟`;
  if (hours > 0) return `${hours}小时`;
  return `${minutes}分钟`;
};

const getDurationParts = (durationMs: number): { hours: number; minutes: number } => {
  const totalMinutes = getMinutesFromDuration(durationMs);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
};

const getLocalDateFromDayKey = (dayKey: string): Date => {
  const [year = '0', month = '1', day = '1'] = dayKey.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const formatMonthDay = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

const formatDayKeyMonth = (dayKey: string): string => {
  const date = getLocalDateFromDayKey(dayKey);
  return `${date.getMonth() + 1}月`;
};

const formatDayKeyDay = (dayKey: string): string => {
  const date = getLocalDateFromDayKey(dayKey);
  return `${date.getDate()}日`;
};

const formatLastRead = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '从未阅读';
  const date = new Date(timestamp);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((todayStart - dateStart) / 86_400_000);
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '昨天';
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

const formatWordCount = (rawText: string): { unit: string; value: string } => {
  const count = rawText.replace(/\s/g, '').length;
  if (count >= 10_000) {
    return {
      unit: '万',
      value: (count / 10_000).toFixed(1).replace(/\.0$/, ''),
    };
  }
  return {
    unit: '字',
    value: String(count),
  };
};

const formatReadPercent = (value: number | undefined): string => {
  if (!Number.isFinite(value)) return '0';
  return `${Math.round(Math.min(Math.max(value || 0, 0), 100))}`;
};

const buildMonthlyRecords = (bookId?: string): ReadingMonthRecord[] => {
  if (!bookId) return [];
  const summary = getReaderReadingTimeSummary(bookId);
  const monthMap = new Map<string, ReadingMonthRecord>();

  summary.daily
    .filter((record) => record.durationMs > 0)
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
    .forEach((record) => {
      const monthKey = record.dayKey.slice(0, 7);
      const previous = monthMap.get(monthKey);
      const day: ReadingDayRecord = {
        date: formatDayKeyDay(record.dayKey),
        dayKey: record.dayKey,
        durationMs: record.durationMs,
        time: formatDurationText(record.durationMs),
        totalMinutes: getMinutesFromDuration(record.durationMs),
      };
      if (previous) {
        previous.durationMs += record.durationMs;
        previous.totalMinutes = getMinutesFromDuration(previous.durationMs);
        previous.time = formatDurationText(previous.durationMs);
        previous.days.push(day);
        return;
      }
      monthMap.set(monthKey, {
        days: [day],
        durationMs: record.durationMs,
        month: formatDayKeyMonth(record.dayKey),
        monthKey,
        time: formatDurationText(record.durationMs),
        totalMinutes: getMinutesFromDuration(record.durationMs),
      });
    });

  return Array.from(monthMap.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
};

const buildProcessedMonthlyRecords = (monthlyRecords: ReadingMonthRecord[]): ProcessedReadingMonthRecord[] => {
  const maxMonthMinutes = Math.max(0, ...monthlyRecords.map((record) => record.totalMinutes));
  return monthlyRecords.map((record) => {
    const maxDayMinutes = Math.max(0, ...record.days.map((day) => day.totalMinutes));
    const monthRatioProgress = getRatioPercent(record.totalMinutes, maxMonthMinutes);
    return {
      ...record,
      calculatedProgress: getWeightedProgressPercent(monthRatioProgress),
      days: record.days.map((day) => {
        const ratioProgress = getRatioPercent(day.totalMinutes, maxDayMinutes);
        return {
          ...day,
          calculatedProgress: getWeightedProgressPercent(ratioProgress),
          ratioProgress,
        };
      }),
      ratioProgress: monthRatioProgress,
    };
  });
};

export const buildBookDataPanelData = (bookDetail: BookInfo, textSyntaxTree: TextSyntaxTree): BookDataPanelData => {
  const progress = getReaderProgress(bookDetail.id);
  const summary = getReaderReadingTimeSummary(bookDetail.id);
  const monthlyRecords = buildMonthlyRecords(bookDetail.id);
  const sortedDaily = [...summary.daily]
    .filter((record) => record.durationMs > 0)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const maxDaily = [...summary.daily].sort((a, b) => b.durationMs - a.durationMs)[0];
  const totalDurationMs = Math.max(summary.totalMs, progress?.totalReadingMs || 0);
  const earliestDay = sortedDaily[0]?.dayKey;
  const wordCount = formatWordCount(textSyntaxTree.rawText || bookDetail.document?.rawText || '');

  return {
    lastRead: formatLastRead(progress?.lastReadAt || progress?.updatedAt),
    maxDailyDate: maxDaily?.durationMs ? formatMonthDay(getLocalDateFromDayKey(maxDaily.dayKey).getTime()) : '暂无记录',
    maxDailyDuration: getDurationParts(maxDaily?.durationMs || 0),
    monthlyRecords: buildProcessedMonthlyRecords(monthlyRecords),
    readPercent: formatReadPercent(progress?.readPercent),
    readingDays: summary.readingDays,
    showReadingRecords: totalDurationMs >= MIN_READING_RECORD_DURATION_MS,
    startLabel: earliestDay
      ? `${formatMonthDay(getLocalDateFromDayKey(earliestDay).getTime())}开始阅读`
      : '尚未开始阅读',
    title: bookDetail.title || '未命名书籍',
    totalDuration: getDurationParts(totalDurationMs),
    totalWords: wordCount,
  };
};
