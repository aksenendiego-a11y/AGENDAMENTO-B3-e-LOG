import { hashPassword, issueToken, readToken, verifyPassword } from './security';

describe('security primitives', () => {
  it('hashes passwords and verifies only the matching password', () => {
    const encoded = hashPassword('Senha de teste forte!');
    expect(encoded).not.toContain('Senha de teste forte!');
    expect(verifyPassword('Senha de teste forte!', encoded)).toBe(true);
    expect(verifyPassword('outra senha', encoded)).toBe(false);
  });

  it('accepts signed sessions and rejects tampering and expiration', () => {
    const secret = 'local-test-secret-with-more-than-32-characters';
    const token = issueToken({ sub: 'user-1', role: 'company', companyId: 'company-1' }, secret, 60);
    expect(readToken(token, secret)?.companyId).toBe('company-1');
    expect(readToken(`${token}x`, secret)).toBeNull();
    expect(readToken(token, 'wrong-secret')).toBeNull();
    expect(readToken(issueToken({ sub: 'user-1', role: 'admin', companyId: null }, secret, -1), secret)).toBeNull();
  });
});
