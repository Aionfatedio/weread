import { parseResourcePlaceholderKey } from '@/lib/bookResources';
import { readBackupZip } from '@/lib/backup/backupZip';
import { getFileExtension, sha256Hex } from '@/lib/utils';
import {
  BACKUP_FILE_EXTENSION,
  BACKUP_SCHEMA_VERSION,
  getBackupBookIdentity,
  isFullBackupManifest,
  toBookResourceRecords,
} from '@/lib/backup/backupSchema';
import { restoreBookUserData } from '@/store/books';
import type { ReaderBookData } from '@/lib/readerBookData';
import { isReaderSettingKey } from '@/lib/readerSettingStore';
import { t } from '@/locales';
import type {
  BackupBookPayload,
  BackupManifest,
  BackupResourceManifestItem,
  BackupUserDataPayload,
  ParsedBackupArchive,
} from '@/lib/backup/backupSchema';
import type { ImportedBookData } from '@/lib/bookImporter';
import {
  MAX_READER_FONT_SIZE,
  MAX_READER_PAGE_GAP_RATIO,
  MAX_READER_SCROLL_PADDING_X,
  MIN_READER_FONT_SIZE,
  MIN_READER_PAGE_GAP_RATIO,
  MIN_READER_SCROLL_PADDING_X,
} from '@/lib/readerSettings';
import type { ReaderFontSetting } from '@/lib/readerSettings';
import { READER_ANNOTATION_COLORS, READER_BOOKMARK_COLOR } from '@/lib/readerAnnotations';

const decoder = new TextDecoder('utf-8');

function assertBackup(condition: unknown, section: string): asserts condition {
  if (!condition) throw new Error(t('backup.invalid_data', [section]));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const hasUniqueIds = (records: Array<{ id: string }>): boolean =>
  new Set(records.map((record) => record.id)).size === records.length;

const readJsonEntry = <T>(entries: Map<string, { data: Uint8Array }>, path: string): T => {
  const entry = entries.get(path);
  if (!entry) {
    throw new Error(t('backup.missing_path', [path]));
  }
  return JSON.parse(decoder.decode(entry.data)) as T;
};

export const isBackupFile = (file: File): boolean => {
  return getFileExtension(file) === BACKUP_FILE_EXTENSION;
};

export const parseBackupFile = async (file: File): Promise<ParsedBackupArchive> => {
  const entries = await readBackupZip(file);
  const manifest = readJsonEntry<BackupManifest>(entries, 'manifest.json');
  assertBackup(isRecord(manifest), 'manifest');
  if (manifest.appName !== 'weread' || manifest.backupSchemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(t('backup.unsupported_version'));
  }
  assertBackup(
    manifest.bookCount === 1 &&
      Array.isArray(manifest.books) &&
      manifest.books.length === 1 &&
      isNonNegativeNumber(manifest.createdAt) &&
      ['full', 'user-data'].includes(manifest.exportKind) &&
      isRecord(manifest.includes) &&
      ['annotations', 'bookContent', 'bookStatus', 'progress', 'readingTime', 'resources', 'settings'].every(
        (key) => typeof (manifest.includes as unknown as Record<string, unknown>)[key] === 'boolean',
      ),
    'manifest',
  );
  const manifestBook = manifest.books[0];
  assertBackup(
    isRecord(manifestBook) && typeof manifestBook.id === 'string' && manifestBook.id.length > 0,
    'manifest.books',
  );
  assertBackup(manifest.includes.bookContent === (manifest.exportKind === 'full'), 'manifest.includes.bookContent');

  const book = readJsonEntry<BackupBookPayload>(entries, `books/${manifestBook.id}/book.json`);
  assertBackup(
    isRecord(book) &&
      book.id === manifestBook.id &&
      ['txt', 'epub'].includes(book.sourceType) &&
      typeof book.title === 'string' &&
      typeof book.author === 'string' &&
      typeof book.image === 'string' &&
      (book.fingerprint === undefined || typeof book.fingerprint === 'string') &&
      [book.createTime, book.modifyTime].every((value) => value === undefined || isNonNegativeNumber(value)),
    'book',
  );
  assertBackup(
    manifestBook.title === book.title &&
      manifestBook.author === book.author &&
      manifestBook.sourceType === book.sourceType &&
      manifestBook.fingerprint === book.fingerprint &&
      Number.isInteger(manifestBook.annotationCount) &&
      manifestBook.annotationCount >= 0 &&
      isNonNegativeNumber(manifestBook.readingTimeMs) &&
      (manifestBook.progressUpdatedAt === undefined || isNonNegativeNumber(manifestBook.progressUpdatedAt)) &&
      (manifestBook.readingStatus === undefined ||
        ['reading', 'read', 'finished'].includes(manifestBook.readingStatus)),
    'manifest.books',
  );
  if (manifest.includes.bookContent) {
    const document = book.document;
    assertBackup(
      isRecord(document) &&
        document.version === 1 &&
        document.sourceType === book.sourceType &&
        typeof document.rawText === 'string' &&
        typeof document.title === 'string' &&
        typeof document.author === 'string' &&
        Array.isArray(document.chapters) &&
        document.chapters.length > 0 &&
        document.chapters.every(
          (chapter) =>
            isRecord(chapter) &&
            typeof chapter.id === 'string' &&
            chapter.id.length > 0 &&
            typeof chapter.title === 'string' &&
            typeof chapter.text === 'string' &&
            (chapter.html === undefined || typeof chapter.html === 'string') &&
            isNonNegativeNumber(chapter.order),
        ),
      'book.document',
    );
    assertBackup(hasUniqueIds(document.chapters), 'book.document.chapters');
  }

  const userData: BackupUserDataPayload = {
    annotations: manifest.includes.annotations ? readJsonEntry(entries, 'user-data/annotations.json') : [],
    bookStatus: manifest.includes.bookStatus ? readJsonEntry(entries, 'user-data/book-status.json') : undefined,
    progress: manifest.includes.progress ? readJsonEntry(entries, 'user-data/progress.json') : undefined,
    readingTimeDaily: manifest.includes.readingTime ? readJsonEntry(entries, 'user-data/reading-time-daily.json') : [],
    readingTimeSegments: manifest.includes.readingTime
      ? readJsonEntry(entries, 'user-data/reading-time-segments.json')
      : [],
    settings: manifest.includes.settings ? readJsonEntry(entries, 'user-data/settings.json') : [],
  };
  assertBackup(
    Array.isArray(userData.annotations) &&
      userData.annotations.every(
        (annotation) =>
          isRecord(annotation) &&
          annotation.bookId === book.id &&
          typeof annotation.id === 'string' &&
          annotation.id.length > 0 &&
          typeof annotation.blockId === 'string' &&
          typeof annotation.text === 'string' &&
          [...READER_ANNOTATION_COLORS, READER_BOOKMARK_COLOR].some((color) => color === annotation.color) &&
          ['bookmark', 'marker', 'note', 'underline', 'wave'].includes(annotation.type) &&
          [annotation.createdAt, annotation.updatedAt, annotation.startOffset, annotation.endOffset].every(
            isNonNegativeNumber,
          ) &&
          annotation.endOffset >= annotation.startOffset &&
          [annotation.page, annotation.titleId].every((value) => value === undefined || isNonNegativeNumber(value)) &&
          [annotation.groupId, annotation.noteText].every((value) => value === undefined || typeof value === 'string'),
      ),
    'annotations',
  );
  assertBackup(hasUniqueIds(userData.annotations), 'annotations.id');
  const progress = userData.progress;
  assertBackup(
    progress == null ||
      (isRecord(progress) &&
        progress.bookId === book.id &&
        isNonNegativeNumber(progress.page) &&
        isNonNegativeNumber(progress.updatedAt) &&
        [
          'blockPageOffset',
          'blockScrollRatio',
          'titleId',
          'globalProgress',
          'lastReadAt',
          'readPercent',
          'totalReadingMs',
          'totalPageCount',
          'visiblePages',
        ].every((key) => progress[key] === undefined || isNonNegativeNumber(progress[key])) &&
        ['blockId', 'textBefore', 'textAfter', 'layoutKey'].every(
          (key) => progress[key] === undefined || typeof progress[key] === 'string',
        ) &&
        [progress.blockScrollRatio, progress.globalProgress].every((value) => value === undefined || value <= 1) &&
        (progress.readPercent === undefined || progress.readPercent <= 100) &&
        (progress.readingMode === undefined || ['paged', 'scroll'].includes(progress.readingMode))),
    'progress',
  );
  const status = userData.bookStatus;
  assertBackup(
    status == null ||
      (isRecord(status) &&
        status.bookId === book.id &&
        ['reading', 'read', 'finished'].includes(status.status) &&
        isNonNegativeNumber(status.updatedAt)),
    'book-status',
  );
  assertBackup(
    Array.isArray(userData.readingTimeDaily) &&
      userData.readingTimeDaily.every(
        (record) =>
          isRecord(record) &&
          record.bookId === book.id &&
          typeof record.id === 'string' &&
          typeof record.dayKey === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(record.dayKey) &&
          [record.durationMs, record.segmentCount, record.updatedAt].every(isNonNegativeNumber),
      ),
    'reading-time-daily',
  );
  assertBackup(
    new Set(userData.readingTimeDaily.map((record) => record.dayKey)).size === userData.readingTimeDaily.length,
    'reading-time-daily.dayKey',
  );
  assertBackup(
    Array.isArray(userData.readingTimeSegments) &&
      userData.readingTimeSegments.every(
        (segment) =>
          isRecord(segment) &&
          segment.bookId === book.id &&
          typeof segment.id === 'string' &&
          segment.id.length > 0 &&
          typeof segment.dayKey === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(segment.dayKey) &&
          [segment.durationMs, segment.startedAt, segment.endedAt].every(isNonNegativeNumber) &&
          segment.endedAt >= segment.startedAt &&
          [segment.page, segment.titleId].every((value) => value === undefined || isNonNegativeNumber(value)) &&
          (segment.readingMode === undefined || ['paged', 'scroll'].includes(segment.readingMode)),
      ),
    'reading-time-segments',
  );
  assertBackup(hasUniqueIds(userData.readingTimeSegments), 'reading-time-segments.id');
  assertBackup(
    Array.isArray(userData.settings) &&
      userData.settings.every(
        (record) =>
          isRecord(record) &&
          isReaderSettingKey(record.key) &&
          typeof record.value === 'string' &&
          isNonNegativeNumber(record.updatedAt),
      ),
    'settings',
  );
  assertBackup(
    new Set(userData.settings.map((record) => record.key)).size === userData.settings.length,
    'settings.key',
  );

  const settingOptions: Record<string, readonly string[]> = {
    'weread-reader-theme': ['light', 'dark'],
    'weread-reader-page-turn-effect': ['jump', 'fade', 'scroll'],
    'weread-reader-reading-mode': ['paged', 'scroll'],
    'weread-reader-first-line-indent': ['none', 'indent'],
  };
  for (const { key, value } of userData.settings) {
    if (settingOptions[key]) assertBackup(settingOptions[key].includes(value), key);
    if (key.startsWith('weread-reader-annotation-color'))
      assertBackup(
        READER_ANNOTATION_COLORS.some((color) => color === value),
        key,
      );
  }
  for (const [key, min, max] of [
    ['weread-reader-font-size', MIN_READER_FONT_SIZE, MAX_READER_FONT_SIZE],
    ['weread-reader-page-gap-ratio', MIN_READER_PAGE_GAP_RATIO, MAX_READER_PAGE_GAP_RATIO],
    ['weread-reader-scroll-padding-x', MIN_READER_SCROLL_PADDING_X, MAX_READER_SCROLL_PADDING_X],
  ] as const) {
    const setting = userData.settings.find((record) => record.key === key);
    if (setting) {
      const value = Number(setting.value);
      assertBackup(Number.isFinite(value) && value >= min && value <= max, key);
    }
  }

  const fontSetting = userData.settings.find((record) => record.key === 'weread-reader-font');
  if (fontSetting) {
    const selectedFont = JSON.parse(fontSetting.value) as ReaderFontSetting;
    assertBackup(
      isRecord(selectedFont) &&
        typeof selectedFont.id === 'string' &&
        typeof selectedFont.label === 'string' &&
        typeof selectedFont.family === 'string' &&
        ['default', 'system', 'local'].includes(selectedFont.source),
      'settings.font',
    );
    if (selectedFont.source === 'local') {
      const fonts = readJsonEntry<Array<{ font: ReaderFontSetting; path: string; size: number }>>(
        entries,
        'user-data/fonts.json',
      );
      assertBackup(
        Array.isArray(fonts) &&
          fonts.length === 1 &&
          isRecord(fonts[0]) &&
          isRecord(fonts[0].font) &&
          fonts[0].font.id === selectedFont.id &&
          typeof fonts[0].path === 'string' &&
          isNonNegativeNumber(fonts[0].size),
        'fonts',
      );
      const fontBytes = entries.get(fonts[0].path)?.data;
      assertBackup(fontBytes && fontBytes.byteLength === fonts[0].size, 'fonts.file');
      const hash = await sha256Hex(fontBytes as Uint8Array<ArrayBuffer>);
      assertBackup(
        selectedFont.id === `local-${hash}` && selectedFont.family === `WereadLocalFont-${hash}`,
        'fonts.identity',
      );
      const blob = new Blob([fontBytes as BlobPart]);
      // Decode before any transaction starts; a broken font must not make a
      // successfully restored setting unusable on the next application launch.
      await new FontFace(selectedFont.family, await blob.arrayBuffer()).load();
      userData.fonts = [{ font: selectedFont, blob }];
    }
  }

  const resourceManifest = manifest.includes.resources
    ? readJsonEntry<BackupResourceManifestItem[]>(entries, `books/${manifestBook.id}/resources/manifest.json`)
    : [];
  assertBackup(
    Array.isArray(resourceManifest) &&
      resourceManifest.every(
        (resource) =>
          isRecord(resource) &&
          typeof resource.resourceKey === 'string' &&
          resource.resourceKey.length > 0 &&
          typeof resource.path === 'string' &&
          typeof resource.mediaType === 'string' &&
          isNonNegativeNumber(resource.size),
      ),
    'resources',
  );
  assertBackup(
    new Set(resourceManifest.map((resource) => resource.resourceKey)).size === resourceManifest.length,
    'resources.resourceKey',
  );
  const resources = resourceManifest.map((resource) => {
    const entry = entries.get(resource.path);
    if (!entry) throw new Error(t('backup.missing_resource', [resource.resourceKey]));
    assertBackup(entry.data.byteLength === resource.size, resource.path);
    return { ...resource, blob: new Blob([entry.data as BlobPart], { type: resource.mediaType }) };
  });

  // A backup must not bypass the EPUB importer's local-only image boundary.
  const resourceKeys = new Set(resourceManifest.map((resource) => resource.resourceKey));
  const imageUrls = [book.image];
  if (book.document && manifest.includes.bookContent) {
    if (book.document.cover !== undefined) {
      assertBackup(typeof book.document.cover === 'string', 'book.document.cover');
      imageUrls.push(book.document.cover);
    }
    for (const chapter of book.document.chapters) {
      if (!chapter.html) continue;
      const template = document.createElement('template');
      template.innerHTML = chapter.html;
      for (const element of template.content.querySelectorAll('*')) {
        const tag = element.tagName.toLowerCase();
        assertBackup(/^(?:blockquote|br|h[1-6]|img|p|em|span|strong)$/.test(tag), 'book.document.html');
        assertBackup(
          Array.from(element.attributes).every(
            (attribute) => tag === 'img' && ['src', 'alt', 'data-resource-key'].includes(attribute.name),
          ),
          'book.document.html.attributes',
        );
        if (tag === 'img') imageUrls.push(element.getAttribute('src') || '');
      }
    }
  }
  for (const url of imageUrls.filter(Boolean)) {
    const resourceKey = parseResourcePlaceholderKey(url);
    assertBackup(
      resourceKey && (!manifest.includes.bookContent || resourceKeys.has(resourceKey)),
      'resources.reference',
    );
  }

  return { book, file, manifest, resources, userData };
};

export const getBackupArchiveIdentity = (archive: ParsedBackupArchive): string => {
  return getBackupBookIdentity(archive.book);
};

export const isFullBackupArchive = (archive: ParsedBackupArchive): boolean => {
  return isFullBackupManifest(archive.manifest) && Boolean(archive.book.document);
};

export const createImportedBookDataFromBackup = (archive: ParsedBackupArchive): ImportedBookData => {
  if (!archive.book.document) throw new Error(t('backup.user_data_only'));
  return {
    author: archive.book.author || '',
    document: archive.book.document,
    fingerprint: archive.book.fingerprint,
    image: archive.book.image || '',
    resources: toBookResourceRecords(archive.book.id, archive.resources),
    sourceType: archive.book.sourceType,
    title: archive.book.title || t('common.unnamed_book'),
  };
};

export const getBackupUserDataForBook = (archive: ParsedBackupArchive, bookId: string): ReaderBookData => {
  const { includes } = archive.manifest;
  const { userData } = archive;
  const remapId = (id: string): string => (archive.book.id === bookId ? id : `${bookId}:${id}`);
  return {
    annotations: includes.annotations
      ? userData.annotations.map((annotation) => ({
          ...annotation,
          bookId,
          id: remapId(annotation.id),
          groupId: annotation.groupId ? remapId(annotation.groupId) : undefined,
        }))
      : undefined,
    progress: includes.progress ? (userData.progress ? { ...userData.progress, bookId } : null) : undefined,
    bookStatus: includes.bookStatus ? (userData.bookStatus ? { ...userData.bookStatus, bookId } : null) : undefined,
    readingTimeDaily: includes.readingTime
      ? userData.readingTimeDaily.map((record) => ({
          ...record,
          bookId,
          id: `${bookId}:${record.dayKey}`,
        }))
      : undefined,
    readingTimeSegments: includes.readingTime
      ? userData.readingTimeSegments.map((segment) => ({
          ...segment,
          bookId,
          id: remapId(segment.id),
        }))
      : undefined,
    settings: includes.settings ? userData.settings : undefined,
    fonts: includes.settings ? userData.fonts : undefined,
  };
};

export const restoreBackupUserData = async ({
  archive,
  targetBookId,
}: {
  archive: ParsedBackupArchive;
  targetBookId: string;
}): Promise<void> => {
  await restoreBookUserData(targetBookId, getBackupUserDataForBook(archive, targetBookId));
};
