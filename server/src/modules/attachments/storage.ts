import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

export interface StorageAdapter {
  save(key: string, stream: Readable): Promise<{ url: string }>;
  delete(key: string): Promise<void>;
}
export class LocalStorageAdapter implements StorageAdapter {
  constructor(private root: string) {}
  async save(key: string, stream: Readable) { await pipeline(stream, createWriteStream(join(this.root, key), { flags: 'wx' })); return { url: `/uploads/${key}` }; }
  async delete(key: string) { await unlink(join(this.root, key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}
