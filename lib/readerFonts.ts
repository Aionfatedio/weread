import { db } from '@/store';
import { READER_FONTS_STORE_NAME } from '@/lib/readerStoreNames';
import { sha256Hex } from '@/lib/utils';
import type { ReaderFontSetting } from '@/lib/readerSettings';

export interface ReaderLocalFontRecord {
  font: ReaderFontSetting;
  blob: Blob;
}

const loadedFontFaces = new Map<string, FontFace>();
let localFonts: ReaderFontSetting[] = [];

export const getReaderLocalFonts = (): ReaderFontSetting[] => localFonts;

export const readReaderLocalFontRecords = async (): Promise<ReaderLocalFontRecord[]> => {
  const records = await db.readByCursor<ReaderLocalFontRecord>({ storeName: READER_FONTS_STORE_NAME });
  if (records.error) throw new Error(records.message);
  return records.data;
};

export const hydrateReaderLocalFonts = async (): Promise<void> => {
  const records = await readReaderLocalFontRecords();
  for (const { font, blob } of records) {
    if (loadedFontFaces.has(font.id)) continue;
    const face = await new FontFace(font.family, await blob.arrayBuffer()).load();
    document.fonts.add(face);
    loadedFontFaces.set(font.id, face);
  }
  localFonts = records.map((record) => record.font);
};

export const importReaderLocalFont = async (file: File): Promise<ReaderFontSetting> => {
  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(new Uint8Array(bytes));
  const font: ReaderFontSetting = {
    id: `local-${hash}`,
    family: `WereadLocalFont-${hash}`,
    label: file.name.replace(/\.(?:otf|ttf|woff|woff2)$/i, '').trim() || file.name,
    source: 'local',
  };
  const face = await new FontFace(font.family, bytes).load();
  const persisted = await db.update<ReaderLocalFontRecord>({
    storeName: READER_FONTS_STORE_NAME,
    data: { font, blob: file },
  });
  if (persisted.error) throw new Error(persisted.message);
  const previous = loadedFontFaces.get(font.id);
  if (previous) document.fonts.delete(previous);
  document.fonts.add(face);
  loadedFontFaces.set(font.id, face);
  localFonts = [...localFonts.filter((entry) => entry.id !== font.id), font];
  return font;
};
