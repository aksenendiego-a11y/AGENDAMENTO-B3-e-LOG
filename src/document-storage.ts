import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export type DocumentStorage = {
  put(key: string, content: Buffer, contentType: string): Promise<void>;
  get(key: string, maxBytes: number): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  close(): void;
};

export class DocumentStorageError extends Error {
  constructor(readonly operation: 'upload' | 'download' | 'delete') {
    super(`Document storage ${operation} failed`);
    this.name = 'DocumentStorageError';
  }
}

const validKey = (key: string) => /^[a-f0-9]{48}\.(?:pdf|xml)$/.test(key);

export function documentStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const localDirectory = path.resolve(env.DATA_DIR || path.join(process.cwd(), 'private_data'));
  return { localDirectory };
}

class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly directory: string) {}

  private resolve(key: string, operation: DocumentStorageError['operation']) {
    if (!validKey(key)) throw new DocumentStorageError(operation);
    const resolved = path.resolve(this.directory, key);
    if (path.dirname(resolved) !== this.directory) throw new DocumentStorageError(operation);
    return resolved;
  }

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    const filePath = this.resolve(key, 'upload');
    try {
      await mkdir(this.directory, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
        stream.once('error', reject);
        stream.once('finish', resolve);
        stream.end(content);
      });
    } catch {
      throw new DocumentStorageError('upload');
    }
  }

  async get(key: string, maxBytes: number): Promise<Buffer | null> {
    const filePath = this.resolve(key, 'download');
    try {
      const info = await stat(filePath);
      if (info.size > maxBytes) throw new DocumentStorageError('download');
      return await readFile(filePath);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new DocumentStorageError('download');
    }
  }

  async delete(key: string): Promise<void> {
    try { await rm(this.resolve(key, 'delete'), { force: true }); }
    catch { throw new DocumentStorageError('delete'); }
  }

  close(): void {}
}

export function createDocumentStorage(config: { localDirectory: string }): DocumentStorage {
  return new LocalDocumentStorage(config.localDirectory);
}
