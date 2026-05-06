import { finalizeEpubResources, parseEpubToReaderDocument } from '@/lib/epubParser';
import { createReader } from '@/lib/transformText';
import { createReaderDocumentFromText } from '@/lib/readerDocument';
import type { BookResourceRecord } from '@/lib/bookResources';
import type { ReaderBookDocument, ReaderBookSourceType } from '@/lib/readerDocument';

export interface ImportedBookData {
  author: string;
  document: ReaderBookDocument;
  image: string;
  sourceType: ReaderBookSourceType;
  title: string;
  resources: BookResourceRecord[];
  coverResourceKey?: string;
}

const getFileExtension = (file: File): string => {
  const index = file.name.lastIndexOf('.');
  return index === -1 ? '' : file.name.slice(index + 1).toLowerCase();
};

export const isSupportedBookFile = (file: File): boolean => {
  return ['epub', 'txt'].includes(getFileExtension(file));
};

export const importBookFile = async (file: File): Promise<ImportedBookData> => {
  const content = await createReader(file);
  const extension = getFileExtension(file);

  if (extension === 'epub') {
    // Pass the raw ArrayBuffer so the parser can transfer it (zero-copy) into
    // the EPUB worker. After this call `content` is detached and must not be
    // touched, which is safe here because we only read TXT files via the
    // other branch.
    const { document, resources, coverResourceKey } = await parseEpubToReaderDocument(content.buffer, file.name);
    return {
      author: document.author,
      document,
      image: document.cover || '',
      sourceType: 'epub',
      title: document.title,
      resources,
      coverResourceKey,
    };
  }

  if (extension === 'txt') {
    const document = createReaderDocumentFromText({
      content,
      title: file.name,
    });
    return {
      author: document.author,
      document,
      image: '',
      sourceType: 'txt',
      title: document.title,
      resources: [],
    };
  }

  throw new Error(`Unsupported book file type: ${file.name}`);
};

export { finalizeEpubResources };
