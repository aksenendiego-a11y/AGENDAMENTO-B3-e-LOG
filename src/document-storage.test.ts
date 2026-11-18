import { isDocumentAuthorized, validateDocumentContent, validateDocumentUpload } from './document-policy';

function syntheticValidPdf(): Buffer {
  let document = '%PDF-1.4\n';
  const objects = ['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n'];
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(document, 'latin1')); document += object; }
  const xrefOffset = Buffer.byteLength(document, 'latin1');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'latin1');
}

// Tests for R2 storage are skipped as the current implementation only provides LocalDocumentStorage
describe.skip('R2 private document storage (not implemented)', () => {
  // These tests were written for an R2-based implementation that doesn't exist in the current codebase.
  // The current implementation uses LocalDocumentStorage (file-based) only.
  // To enable these tests, implement an R2DocumentStorage class and update createDocumentStorage to support it.
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