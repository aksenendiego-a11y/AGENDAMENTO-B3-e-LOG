import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export interface Session { sub: string; role: 'admin' | 'company'; companyId: string | null; exp: number }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function issueToken(session: Omit<Session, 'exp'>, secret: string, ttlSeconds: number): string {
  const payload = encode({ ...session, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readToken(token: string, secret: string): Session | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<Session>;
    if (typeof decoded.sub !== 'string' || !decoded.sub || !['admin', 'company'].includes(decoded.role ?? '') || typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp) || decoded.exp <= Date.now() / 1000) return null;
    if (decoded.role === 'company' && (typeof decoded.companyId !== 'string' || !decoded.companyId)) return null;
    if (decoded.role === 'admin' && decoded.companyId !== null) return null;
    return decoded as Session;
  } catch { return null; }
}
