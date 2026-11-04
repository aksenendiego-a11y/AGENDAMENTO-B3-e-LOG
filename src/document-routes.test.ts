import { AddressInfo, Server } from 'node:net';
import { issueToken } from './security';

const mocks = vi.hoisted(() => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  storage: { put: vi.fn(), get: vi.fn(), delete: vi.fn(), close: vi.fn() },
}));

vi.mock('./db', () => ({ pool: mocks.pool }));
vi.mock('./document-storage', () => {
  class MockDocumentStorageError extends Error {
    constructor(readonly operation: 'upload' | 'download' | 'delete') { super(`Document storage ${operation} failed`); }
  }
  return {
    createDocumentStorage: () => mocks.storage,
    documentStorageConfig: () => ({ driver: 'r2', localDirectory: 'unused' }),
    DocumentStorageError: MockDocumentStorageError,
  };
});

const tokenSecret = 'unit-test-secret-that-is-not-a-credential';
const userToken = (companyId: string) => issueToken({ sub: `user-${companyId}`, role: 'company', companyId }, tokenSecret, 600);
const documentId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const knownObjectKey = `${'b'.repeat(48)}.xml`;

describe('document HTTP authorization and operation ordering', () => {
  let baseUrl: string;
  let server: Server;
  let app: typeof import('./app').default;

  beforeAll(async () => {
    vi.stubEnv('TOKEN_SECRET', tokenSecret);
    vi.stubEnv('MAX_DOCUMENT_BYTES', '16');
    vi.resetModules();
    app = (await import('./app')).default;
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    mocks.storage.put.mockReset().mockResolvedValue(undefined);
    mocks.storage.get.mockReset().mockResolvedValue(Buffer.from('<invoice/>'));
    mocks.storage.delete.mockReset().mockResolvedValue(undefined);
    mocks.pool.query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users WHERE id=$1')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('FROM booking_documents d JOIN bookings')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
    mocks.pool.connect.mockReset();
  });

  it('rejects missing and invalid sessions before querying document metadata or R2', async () => {
    const missing = await fetch(`${baseUrl}/api/v1/documents/${documentId}/download`);
    const invalid = await fetch(`${baseUrl}/api/v1/documents/${documentId}/download`, { headers: { authorization: 'Bearer invalid-token' } });
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(mocks.pool.query).not.toHaveBeenCalled();
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it('does not read a known object key when company A requests company B document metadata', async () => {
    mocks.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users WHERE id=$1')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('FROM booking_documents d JOIN bookings')) return { rowCount: 1, rows: [{ id: documentId, company_id: 'company-b', booking_company_id: 'company-b', storage_key: knownObjectKey, media_type: 'application/xml', original_name: 'invoice.xml' }] };
      return { rowCount: 1, rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/v1/documents/${documentId}/download`, { headers: { authorization: `Bearer ${userToken('company-a')}` } });
    expect(response.status).toBe(404);
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it('rejects metadata whose document company and booking company do not match', async () => {
    mocks.pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users WHERE id=$1')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('FROM booking_documents d JOIN bookings')) return { rowCount: 1, rows: [{ id: documentId, company_id: 'company-a', booking_company_id: 'company-b', storage_key: knownObjectKey, media_type: 'application/xml', original_name: 'invoice.xml' }] };
      return { rowCount: 1, rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/v1/documents/${documentId}/download`, { headers: { authorization: `Bearer ${userToken('company-a')}` } });
    expect(response.status).toBe(404);
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it('does not delete a known object key for another company', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT d.id,d.storage_key')) return { rowCount: 1, rows: [{ id: documentId, company_id: 'company-b', booking_company_id: 'company-b', storage_key: knownObjectKey, deleted_at: null }] };
      return { rowCount: 1, rows: [] };
    });
    mocks.pool.connect.mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const response = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/documents/${documentId}`, { method: 'DELETE', headers: { authorization: `Bearer ${userToken('company-a')}` } });
    expect(response.status).toBe(404);
    expect(mocks.storage.delete).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('returns not found without reading R2 when the database has no document', async () => {
    const response = await fetch(`${baseUrl}/api/v1/documents/${documentId}/download`, { headers: { authorization: `Bearer ${userToken('company-a')}` } });
    expect(response.status).toBe(404);
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it('does not write metadata when R2 upload fails', async () => {
    const { DocumentStorageError } = await import('./document-storage');
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM bookings WHERE id=$1')) return { rowCount: 1, rows: [{ id: bookingId, company_id: 'company-a' }] };
      if (sql.includes('FROM booking_documents WHERE booking_id=$1')) return { rowCount: 0, rows: [] };
      if (sql.includes('INSERT INTO booking_documents')) throw new Error('synthetic database failure');
      return { rowCount: 1, rows: [] };
    });
    mocks.pool.connect.mockResolvedValue({ query: clientQuery, release: vi.fn() });
    mocks.storage.put.mockRejectedValue(new DocumentStorageError('upload'));
    const form = new FormData();
    form.append('documentType', 'xml');
    form.append('file', new Blob(['<invoice/>'], { type: 'application/xml' }), 'test.xml');
    const response = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${userToken('company-a')}` }, body: form });
    expect(response.status).toBe(503);
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO booking_documents'), expect.anything());
    expect(mocks.storage.delete).toHaveBeenCalledOnce();
  });

  it('compensates an uploaded object when the database insert fails before commit', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM bookings WHERE id=$1')) return { rowCount: 1, rows: [{ id: bookingId, company_id: 'company-a' }] };
      if (sql.includes('FROM booking_documents WHERE booking_id=$1')) return { rowCount: 0, rows: [] };
      if (sql.includes('INSERT INTO booking_documents')) throw new Error('synthetic database failure');
      return { rowCount: 1, rows: [] };
    });
    mocks.pool.connect.mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const form = new FormData();
    form.append('documentType', 'xml');
    form.append('file', new Blob(['<invoice/>'], { type: 'application/xml' }), 'test.xml');
    const response = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${userToken('company-a')}` }, body: form });
    expect(response.status).toBe(500);
    expect(mocks.storage.put).toHaveBeenCalledOnce();
    expect(mocks.storage.delete).toHaveBeenCalledOnce();
  });

  it('retains an uploaded object when the database commit result is ambiguous', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM bookings WHERE id=$1')) return { rowCount: 1, rows: [{ id: bookingId, company_id: 'company-a' }] };
      if (sql.includes('FROM booking_documents WHERE booking_id=$1')) return { rowCount: 0, rows: [] };
      if (sql === 'COMMIT') throw new Error('synthetic connection loss during commit');
      if (sql.includes('INSERT INTO booking_documents')) return { rowCount: 1, rows: [{ id: documentId, booking_id: bookingId, media_type: 'application/xml', original_name: 'test.xml', byte_size: 10, created_at: new Date() }] };
      return { rowCount: 1, rows: [] };
    });
    mocks.pool.connect.mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const form = new FormData();
    form.append('documentType', 'xml');
    form.append('file', new Blob(['<invoice/>'], { type: 'application/xml' }), 'test.xml');
    const response = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${userToken('company-a')}` }, body: form });
    expect(response.status).toBe(500);
    expect(mocks.storage.put).toHaveBeenCalledOnce();
    expect(mocks.storage.delete).not.toHaveBeenCalled();
  });

  it('makes duplicate uploads idempotent and deletion retryable after an R2 failure', async () => {
    let uploadedDocument = false;
    const storedDocument = { id: documentId, booking_id: bookingId, company_id: 'company-a', media_type: 'application/xml', original_name: 'test.xml', byte_size: 10, created_at: new Date() };
    const uploadQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM bookings WHERE id=$1')) return { rowCount: 1, rows: [{ id: bookingId, company_id: 'company-a' }] };
      if (sql.includes('FROM booking_documents WHERE booking_id=$1')) return uploadedDocument ? { rowCount: 1, rows: [storedDocument] } : { rowCount: 0, rows: [] };
      if (sql.includes('INSERT INTO booking_documents')) { uploadedDocument = true; return { rowCount: 1, rows: [storedDocument] }; }
      return { rowCount: 1, rows: [] };
    });
    mocks.pool.connect.mockResolvedValue({ query: uploadQuery, release: vi.fn() });
    const makeForm = () => { const form = new FormData(); form.append('documentType', 'xml'); form.append('file', new Blob(['<invoice/>'], { type: 'application/xml' }), 'test.xml'); return form; };
    const headers = { authorization: `Bearer ${userToken('company-a')}` };
    const uploadUrl = `${baseUrl}/api/v1/bookings/${bookingId}/documents`;
    expect((await fetch(uploadUrl, { method: 'POST', headers, body: makeForm() })).status).toBe(201);
    expect((await fetch(uploadUrl, { method: 'POST', headers, body: makeForm() })).status).toBe(200);
    expect(mocks.storage.put).toHaveBeenCalledOnce();

    let tombstoned = false;
    const deleteQuery = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT d.id,d.storage_key')) return { rowCount: 1, rows: [{ id: documentId, company_id: 'company-a', booking_company_id: 'company-a', storage_key: knownObjectKey, deleted_at: tombstoned ? new Date() : null }] };
      if (sql.includes('UPDATE booking_documents SET deleted_at')) tombstoned = true;
      return { rowCount: 1, rows: [] };
    });
    mocks.pool.connect.mockResolvedValue({ query: deleteQuery, release: vi.fn() });
    const deleteUrl = `${baseUrl}/api/v1/bookings/${bookingId}/documents/${documentId}`;
    const { DocumentStorageError } = await import('./document-storage');
    mocks.storage.delete.mockRejectedValueOnce(new DocumentStorageError('delete'));
    expect((await fetch(deleteUrl, { method: 'DELETE', headers })).status).toBe(503);
    expect(tombstoned).toBe(true);
    mocks.storage.delete.mockResolvedValueOnce(undefined);
    expect((await fetch(deleteUrl, { method: 'DELETE', headers })).status).toBe(204);
    expect(mocks.storage.delete).toHaveBeenCalledTimes(2);
  });

  it('does not expose a direct route that accepts a storage key', async () => {
    const response = await fetch(`${baseUrl}/api/v1/objects/${knownObjectKey}`);
    expect(response.status).toBe(404);
    expect(mocks.storage.get).not.toHaveBeenCalled();
  });

  it('rejects a file above the configured byte limit in multipart parsing before storage', async () => {
    const form = new FormData();
    form.append('documentType', 'xml');
    form.append('file', new Blob([Buffer.alloc(17)], { type: 'application/xml' }), 'too-large.xml');
    const response = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${userToken('company-a')}` }, body: form });
    expect(response.status).toBe(413);
    expect(mocks.storage.put).not.toHaveBeenCalled();
  });
});
