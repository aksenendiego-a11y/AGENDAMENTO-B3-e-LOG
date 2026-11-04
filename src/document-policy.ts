import path from 'node:path';
import { SaxesParser } from 'saxes';
import { Session } from './security';

export type ValidatedDocument = {
  extension: '.pdf' | '.xml';
  mediaType: 'application/pdf' | 'application/xml';
  originalName: string;
};

export function validateDocumentUpload(input: {
  originalName: string;
  mimeType: string;
  size: number;
  documentType: unknown;
  maxBytes: number;
}): ValidatedDocument {
  const rawExtension = path.extname(input.originalName).toLowerCase();
  const type = input.documentType;
  if (!['.pdf', '.xml'].includes(rawExtension) || !['pdf', 'xml'].includes(String(type)) || rawExtension !== `.${type}`) {
    throw new Error('O arquivo não corresponde ao campo de documento informado');
  }
  const extension = rawExtension as '.pdf' | '.xml';
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > input.maxBytes) {
    throw new Error('Arquivo excede o tamanho máximo permitido');
  }
  const acceptedMimeTypes = extension === '.pdf' ? ['application/pdf'] : ['application/xml', 'text/xml'];
  if (!acceptedMimeTypes.includes(input.mimeType.toLowerCase())) throw new Error('MIME type não permitido para o documento');
  const originalName = path.basename(input.originalName.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || `document${extension}`;
  return { extension, mediaType: extension === '.pdf' ? 'application/pdf' : 'application/xml', originalName };
}

export function isDocumentAuthorized(session: Pick<Session, 'role' | 'companyId'>, documentCompanyId: string, bookingCompanyId: string): boolean {
  if (documentCompanyId !== bookingCompanyId) return false;
  return session.role === 'admin' || (session.role === 'company' && session.companyId === documentCompanyId);
}

export function validateDocumentContent(extension: '.pdf' | '.xml', content: Buffer): void {
  if (extension === '.pdf') {
    if (content.length < 32) throw new Error('PDF inválido ou corrompido');
    const text = content.toString('latin1');
    if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\n|\r)/.test(text)) throw new Error('PDF inválido ou corrompido');
    const pointer = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(text);
    if (!pointer) throw new Error('PDF inválido ou corrompido');
    const offset = Number(pointer[1]);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= content.length) throw new Error('PDF inválido ou corrompido');
    const xref = text.slice(offset, offset + 1024);
    const validXref = /^xref\b/.test(xref) ? /trailer\s*<</.test(text.slice(offset)) : /^\d+\s+\d+\s+obj\b/.test(xref) && /\/Type\s*\/XRef\b/.test(xref) && /stream\r?\n/.test(xref);
    if (!validXref) throw new Error('PDF inválido ou corrompido');
    return;
  }

  const text = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/, '');
  if (!text.trimStart().startsWith('<') || /<!\s*(DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('XML inválido ou contém declarações não permitidas');
  const parser = new SaxesParser({ xmlns: true });
  let rootSeen = false;
  parser.on('opentag', () => { rootSeen = true; });
  parser.on('error', error => { throw error; });
  parser.write(text).close();
  if (!rootSeen) throw new Error('XML vazio ou sem elemento raiz');
}
