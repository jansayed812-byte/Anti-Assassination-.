/**
 * Phase 12: Unit tests — Auth Middleware
 */
import { describe, it, expect } from 'vitest';
import { TokenService } from '../../services/auth/token-service';

const SECRET = 'test-secret-key-32chars-minimum!!';

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
