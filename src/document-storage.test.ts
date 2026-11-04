import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { DocumentStorageError, createDocumentStorage, documentStorageConfig } from './document-storage';
import { isDocumentAuthorized, validateDocumentContent, validateDocumentUpload } from './document-policy';

const config = {
  driver: 'r2' as const,
  localDirectory: 'unused',
  accountId: 'test-account',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  bucket: 'private-test-bucket',
  endpoint: 'https://test-account.r2.cloudflarestorage.com',
  region: 'auto',
};
const key = `${'a'.repeat(48)}.xml`;

function syntheticValidPdf(): Buffer {
  let document = '%PDF-1.4\n';
  const objects = ['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n'];
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(document, 'latin1')); document += object; }
  const xrefOffset = Buffer.byteLength(document, 'latin1');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'latin1');
}

describe('R2 private document storage', () => {
  it('uploads, downloads through the API adapter, and deletes objects', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Body: Readable.from([Buffer.from('<doc/>')]) })
      .mockResolvedValueOnce({});
    const store = createDocumentStorage(config, { send } as unknown as S3Client);

    await store.put(key, Buffer.from('<doc/>'), 'application/xml');
    await expect(store.get(key, 100)).resolves.toEqual(Buffer.from('<doc/>'));
    await store.delete(key);

    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: config.bucket, Key: key, ContentLength: 6, ContentType: 'application/xml' });
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('returns null for a missing object and hides provider errors', async () => {
    const missing = Object.assign(new Error('not found'), { name: 'NoSuchKey' });
    const sendMissing = vi.fn().mockRejectedValueOnce(missing);
    const storeMissing = createDocumentStorage(config, { send: sendMissing } as unknown as S3Client);
    await expect(storeMissing.get(key, 100)).resolves.toBeNull();

    const sendFailed = vi.fn().mockRejectedValue(new Error('provider response must not escape'));
    const storeFailed = createDocumentStorage(config, { send: sendFailed } as unknown as S3Client);
    await expect(storeFailed.put(key, Buffer.from('x'), 'application/xml')).rejects.toMatchObject({ name: 'DocumentStorageError', operation: 'upload' });
    await expect(storeFailed.get(key, 100)).rejects.toMatchObject({ name: 'DocumentStorageError', operation: 'download' });
    await expect(storeFailed.delete(key)).rejects.toBeInstanceOf(DocumentStorageError);
  });

  it('rejects oversized downloads and closes the SDK client', async () => {
    const destroy = vi.fn();
    const send = vi.fn().mockResolvedValue({ ContentLength: 101, Body: Readable.from([Buffer.alloc(101)]) });
    const store = createDocumentStorage(config, { send, destroy } as unknown as S3Client);
    await expect(store.get(key, 100)).rejects.toMatchObject({ name: 'DocumentStorageError', operation: 'download' });
    store.close();
    expect(destroy).toHaveBeenCalledOnce();

    const unknownLength = vi.fn().mockResolvedValue({ Body: Readable.from([Buffer.alloc(60), Buffer.alloc(60)]) });
    const boundedStore = createDocumentStorage(config, { send: unknownLength } as unknown as S3Client);
    await expect(boundedStore.get(key, 100)).rejects.toMatchObject({ name: 'DocumentStorageError', operation: 'download' });
  });

  it('derives the default R2 endpoint and auto region from environment settings', () => {
    const resolved = documentStorageConfig({
      STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'account-123', R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'private-bucket',
    });
    expect(resolved.endpoint).toBe('https://account-123.r2.cloudflarestorage.com');
    expect(resolved.region).toBe('auto');
  });

  it('fails clearly when production selects R2 without credentials', () => {
    expect(() => documentStorageConfig({ NODE_ENV: 'production' })).toThrow(/explicitly configured/);
    expect(() => documentStorageConfig({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).toThrow(/not allowed in production/);
    expect(() => documentStorageConfig({ NODE_ENV: 'production', STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'account-123' })).toThrow(/R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET/);
    expect(() => createDocumentStorage({ driver: 'r2', localDirectory: 'unused' })).toThrow(/configuration is incomplete/);
  });

  it('rejects insecure or credential-bearing custom R2 endpoints', () => {
    const base = { STORAGE_DRIVER: 'r2', R2_ACCOUNT_ID: 'account-123', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'private-bucket' };
    expect(() => documentStorageConfig({ ...base, R2_ENDPOINT: 'http://r2.invalid' })).toThrow(/HTTPS/);
    expect(() => documentStorageConfig({ ...base, R2_ENDPOINT: 'https://user:password@r2.invalid' })).toThrow(/credential-free/);
    expect(() => documentStorageConfig({ ...base, R2_ENDPOINT: 'https://r2.invalid/sad-revest-documentos' })).toThrow(/credential-free/);
  });
});

describe('document upload policy', () => {
  const valid = { originalName: 'invoice.xml', mimeType: 'application/xml', size: 20, documentType: 'xml', maxBytes: 100 };

  it('requires a matching extension, document type, MIME type, and maximum size', () => {
    expect(validateDocumentUpload(valid).mediaType).toBe('application/xml');
    expect(() => validateDocumentUpload({ ...valid, mimeType: 'application/pdf' })).toThrow(/MIME type/);
    expect(() => validateDocumentUpload({ ...valid, size: 101 })).toThrow(/tamanho máximo/);
  });

  it('rejects file signatures that do not match their declared formats and malformed XML', () => {
    expect(() => validateDocumentContent('.pdf', syntheticValidPdf())).not.toThrow();
    expect(() => validateDocumentContent('.pdf', Buffer.from('<html>not a PDF</html>'))).toThrow(/PDF inválido/);
    expect(() => validateDocumentContent('.xml', Buffer.from('<invoice><broken></invoice>'))).toThrow();
    expect(() => validateDocumentContent('.xml', Buffer.from('<!DOCTYPE invoice [<!ENTITY x "secret">]><invoice>&x;</invoice>'))).toThrow(/DTD|declarações/);
  });

  it('checks database document ownership against the booking and session company', () => {
    expect(isDocumentAuthorized({ role: 'company', companyId: 'company-a' }, 'company-a', 'company-a')).toBe(true);
    expect(isDocumentAuthorized({ role: 'company', companyId: 'company-b' }, 'company-a', 'company-a')).toBe(false);
    expect(isDocumentAuthorized({ role: 'admin', companyId: null }, 'company-a', 'company-b')).toBe(false);
  });
});
