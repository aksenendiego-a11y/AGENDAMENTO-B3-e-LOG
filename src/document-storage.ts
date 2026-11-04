import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export type StorageDriver = 'local' | 'r2';

export type DocumentStorageConfig = {
  driver: StorageDriver;
  localDirectory: string;
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
};

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

export function documentStorageConfig(env: NodeJS.ProcessEnv = process.env): DocumentStorageConfig {
  const driver = env.STORAGE_DRIVER || 'local';
  if (driver !== 'local' && driver !== 'r2') throw new Error('STORAGE_DRIVER must be "local" or "r2"');
  const config: DocumentStorageConfig = {
    driver,
    localDirectory: path.resolve(env.DATA_DIR || path.join(process.cwd(), 'private_data')),
  };
  if (driver === 'local') return config;

  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  const missing = [
    ['R2_ACCOUNT_ID', accountId],
    ['R2_ACCESS_KEY_ID', accessKeyId],
    ['R2_SECRET_ACCESS_KEY', secretAccessKey],
    ['R2_BUCKET', bucket],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`R2 storage configuration missing: ${missing.join(', ')}`);

  const endpoint = env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`;
  let parsedEndpoint: URL;
  try { parsedEndpoint = new URL(endpoint); }
  catch { throw new Error('R2_ENDPOINT must be a valid HTTPS URL'); }
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.pathname !== '/' || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) {
    throw new Error('R2_ENDPOINT must be a credential-free HTTPS URL without query or fragment');
  }
  return {
    ...config,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: parsedEndpoint.toString().replace(/\/$/, ''),
    region: env.R2_REGION?.trim() || 'auto',
  };
}

class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly directory: string) {}

  private resolve(key: string, operation: DocumentStorageError['operation']) {
    if (!validKey(key)) throw new DocumentStorageError(operation);
    const resolved = path.resolve(this.directory, key);
    if (path.dirname(resolved) !== this.directory) throw new DocumentStorageError(operation);
    return resolved;
  }

  async put(key: string, content: Buffer): Promise<void> {
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

class R2DocumentStorage implements DocumentStorage {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    if (!validKey(key)) throw new DocumentStorageError('upload');
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: content, ContentLength: content.length, ContentType: contentType }));
    } catch { throw new DocumentStorageError('upload'); }
  }

  async get(key: string, maxBytes: number): Promise<Buffer | null> {
    if (!validKey(key)) throw new DocumentStorageError('download');
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      if (result.ContentLength !== undefined && result.ContentLength > maxBytes) {
        if (result.Body instanceof Readable) result.Body.destroy();
        throw new DocumentStorageError('download');
      }
      if (result.Body instanceof Readable) {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of result.Body) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > maxBytes) { result.Body.destroy(); throw new DocumentStorageError('download'); }
          chunks.push(buffer);
        }
        return Buffer.concat(chunks);
      }
      if ('transformToByteArray' in result.Body && typeof result.Body.transformToByteArray === 'function') {
        if (result.ContentLength === undefined) throw new DocumentStorageError('download');
        const bytes = await result.Body.transformToByteArray();
        if (bytes.byteLength > maxBytes) throw new DocumentStorageError('download');
        return Buffer.from(bytes);
      }
      return null;
    } catch (error) {
      const providerError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (providerError.name === 'NoSuchKey' || providerError.$metadata?.httpStatusCode === 404) return null;
      throw new DocumentStorageError('download');
    }
  }

  async delete(key: string): Promise<void> {
    if (!validKey(key)) throw new DocumentStorageError('delete');
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
    catch { throw new DocumentStorageError('delete'); }
  }

  close(): void { this.client.destroy(); }
}

export function createDocumentStorage(config: DocumentStorageConfig, client?: S3Client): DocumentStorage {
  if (config.driver === 'local') return new LocalDocumentStorage(config.localDirectory);
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    throw new Error('R2 storage configuration is incomplete');
  }
  const r2Client = client || new S3Client({
    endpoint: config.endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: config.region || 'auto',
    forcePathStyle: true,
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 15_000, socketTimeout: 15_000 }),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return new R2DocumentStorage(r2Client, config.bucket);
}
