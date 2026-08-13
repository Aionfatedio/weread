import { describe, expect, it } from 'vitest';
import { createBackupZip, readBackupZip } from '@/lib/backup/backupZip';

const decoder = new TextDecoder();

describe('createBackupZip / readBackupZip', () => {
  it('round-trips string, binary and blob entries', async () => {
    const binary = new Uint8Array([0, 1, 2, 255]);
    const blob = await createBackupZip([
      { data: '{"a":1}\n', path: 'manifest.json' },
      { data: binary, path: 'books/中文书名/data.bin' },
      { data: new Blob(['blob-content']), path: 'user-data/notes.json' },
    ]);

    const entries = await readBackupZip(blob);
    expect(entries.size).toBe(3);
    expect(decoder.decode(entries.get('manifest.json')?.data)).toBe('{"a":1}\n');
    expect(Array.from(entries.get('books/中文书名/data.bin')?.data ?? [])).toEqual([0, 1, 2, 255]);
    expect(decoder.decode(entries.get('user-data/notes.json')?.data)).toBe('blob-content');
  });

  it('normalizes backslashes and parent segments out of entry paths', async () => {
    const blob = await createBackupZip([{ data: 'x', path: 'a\\..\\b.txt' }]);
    const entries = await readBackupZip(blob);
    expect(Array.from(entries.keys())).toEqual(['a/b.txt']);
  });

  it('produces a readable empty archive', async () => {
    const blob = await createBackupZip([]);
    const entries = await readBackupZip(blob);
    expect(entries.size).toBe(0);
  });

  it('rejects archives with corrupted entry data via CRC check', async () => {
    const blob = await createBackupZip([{ data: '{"a":1}', path: 'manifest.json' }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // First entry data begins right after the 30-byte local header + name.
    const dataOffset = 30 + 'manifest.json'.length;
    bytes[dataOffset] ^= 0xff;
    await expect(readBackupZip(new Blob([bytes]))).rejects.toThrow(/checksum mismatch/);
  });

  it('rejects truncated archives', async () => {
    const blob = await createBackupZip([{ data: 'x', path: 'a.txt' }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await expect(readBackupZip(new Blob([bytes.slice(0, 10)]))).rejects.toThrow(/Invalid BDZ archive/);
  });
});
