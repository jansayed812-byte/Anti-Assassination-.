/**
 * Phase 12: Unit tests — Auth Middleware
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { TokenService } from '../../services/auth/token-service';
import { verifyJWT } from '../../services/auth/auth-middleware';

const SECRET = 'test-secret-key-32chars-minimum!!';
/** Hand-signs a token the same way TokenService does, for claims TokenService would never issue itself. */
const sign = (claims: object, secret = SECRET) => {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
};

describe('TokenService', () => {
  const svc = new TokenService(SECRET);

  it('issues access + refresh token', () => {
    const pair = svc.issue('u1', 'Ali', 'operator');
    expect(pair.access_token).toBeTruthy();
    expect(pair.refresh_token).toBeTruthy();
    expect(pair.token_type).toBe('Bearer');
    expect(pair.expires_in).toBeGreaterThan(0);
  });

  it('refresh token works once', () => {
    const pair = svc.issue('u2', 'Sara', 'viewer');
    const newPair = svc.refresh(pair.refresh_token, 'Sara');
    expect(newPair).not.toBeNull();
    expect(newPair!.access_token).not.toBe(pair.access_token);
    const again = svc.refresh(pair.refresh_token, 'Sara');
    expect(again).toBeNull();
  });

  it('revoke removes refresh token', () => {
    const pair = svc.issue('u3', 'Omar', 'admin');
    svc.revoke(pair.refresh_token);
    const result = svc.refresh(pair.refresh_token, 'Omar');
    expect(result).toBeNull();
  });

  it('access token has 3 parts', () => {
    const pair = svc.issue('u4', 'Test', 'viewer');
    expect(pair.access_token.split('.')).toHaveLength(3);
  });
});

describe('verifyJWT', () => {
  const svc = new TokenService(SECRET);
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts a token this service issued and returns its claims', () => {
    const pair = svc.issue('u5', 'Reza', 'analyst', { branch: 'MZR', branches: ['MZR'] });
    const claims = verifyJWT(pair.access_token, SECRET);
    expect(claims).toMatchObject({ sub: 'u5', role: 'analyst', branch: 'MZR' });
  });

  it('rejects a token whose signature was tampered with', () => {
    const pair = svc.issue('u6', 'Ali', 'commander');
    const [h, p, s] = pair.access_token.split('.');
    const flipped = s[0] === 'a' ? 'b' + s.slice(1) : 'a' + s.slice(1);
    expect(verifyJWT(`${h}.${p}.${flipped}`, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const forged = sign({ sub: 'u7', name: 'Forged', role: 'admin', iat: now(), exp: now() + 3600 }, 'a-different-secret-entirely!!');
    expect(verifyJWT(forged, SECRET)).toBeNull();
  });

  it('rejects malformed tokens (wrong part count, bad base64, empty)', () => {
    expect(verifyJWT('not-a-jwt', SECRET)).toBeNull();
    expect(verifyJWT('', SECRET)).toBeNull();
    expect(verifyJWT('a.b', SECRET)).toBeNull();
    expect(verifyJWT('a.b.c.d', SECRET)).toBeNull();
  });

  it('rejects an already-expired token', () => {
    const expired = new TokenService(SECRET, -1).issue('u8', 'Old', 'viewer');
    expect(verifyJWT(expired.access_token, SECRET)).toBeNull();
  });

  it('rejects a token with no expiry claim, rather than treating it as never expiring', () => {
    const noExp = sign({ sub: 'u9', name: 'No Exp', role: 'admin', iat: now() });
    expect(verifyJWT(noExp, SECRET)).toBeNull();
  });

  it('rejects a token with a non-numeric expiry claim', () => {
    const badExp = sign({ sub: 'u10', name: 'Bad Exp', role: 'admin', iat: now(), exp: 'never' });
    expect(verifyJWT(badExp, SECRET)).toBeNull();
  });
});
