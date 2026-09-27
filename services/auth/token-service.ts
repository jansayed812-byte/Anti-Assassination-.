/**
 * Phase 10: Token Service
 */
import { createHmac, randomBytes } from 'crypto';
import type { Role } from './auth-middleware';

export interface TokenPair { access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer'; }
interface RefreshEntry { userId: string; role: Role; expires: number; }

export class TokenService {
  private secret: string;
  private accessTTL: number;
  private refreshTTL: number;
  private refreshStore = new Map<string, RefreshEntry>();

  constructor(secret: string, accessTTL = 3600, refreshTTL = 86400 * 7) {
    this.secret = secret; this.accessTTL = accessTTL; this.refreshTTL = refreshTTL;
  }

  issue(userId: string, name: string, role: Role): TokenPair {
    const now = Math.floor(Date.now() / 1000);
    const jti = randomBytes(8).toString('hex');
    const access_token = this._signJWT({ sub: userId, name, role, iat: now, exp: now + this.accessTTL, jti });
    const refresh_token = randomBytes(32).toString('hex');
    this.refreshStore.set(refresh_token, { userId, role, expires: now + this.refreshTTL });
    return { access_token, refresh_token, expires_in: this.accessTTL, token_type: 'Bearer' };
  }

  refresh(refreshToken: string, name: string): TokenPair | null {
    const entry = this.refreshStore.get(refreshToken);
    if (!entry) return null;
    if (entry.expires < Math.floor(Date.now() / 1000)) { this.refreshStore.delete(refreshToken); return null; }
    this.refreshStore.delete(refreshToken);
    return this.issue(entry.userId, name, entry.role);
  }

  revoke(refreshToken: string): void { this.refreshStore.delete(refreshToken); }

  private _signJWT(claims: object): string {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const s = createHmac('sha256', this.secret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${s}`;
  }
}
