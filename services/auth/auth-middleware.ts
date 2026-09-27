/**
 * Phase 10: Auth Middleware
 */
import { Request, Response, NextFunction } from 'express';
import { createHash, createHmac } from 'crypto';

export type Role = 'viewer' | 'operator' | 'commander' | 'admin';

export interface JWTClaims { sub: string; name: string; role: Role; exp: number; iat: number; }
export interface AuditEntry { user_id: string; action: string; resource: string; ip: string; at: string; result: 'allow' | 'deny'; chain_hash: string; }

const PERMISSIONS: Record<Role, Set<string>> = {
  viewer:    new Set(['read:positions', 'read:incidents', 'read:alerts']),
  operator:  new Set(['read:positions', 'read:incidents', 'read:alerts', 'write:incidents', 'ack:alerts']),
  commander: new Set(['read:positions', 'read:incidents', 'read:alerts', 'write:incidents', 'ack:alerts', 'validate:incidents', 'write:plans']),
  admin:     new Set(['*']),
};

function hasPermission(role: Role, permission: string): boolean { const p = PERMISSIONS[role]; return p.has('*') || p.has(permission); }

function verifyJWT(token: string, secret: string): JWTClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    if (sig !== expected) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as JWTClaims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

const auditLog: AuditEntry[] = [];
let lastHash = '0';

function appendAudit(entry: Omit<AuditEntry, 'chain_hash'>): void {
  const chain_hash = createHash('sha256').update(JSON.stringify({ ...entry, prev: lastHash })).digest('hex');
  auditLog.push({ ...entry, chain_hash });
  lastHash = chain_hash;
}

const rateLimits = new Map<string, { count: number; reset: number }>();
function checkRateLimit(ip: string, maxRpm = 120): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.reset) { rateLimits.set(ip, { count: 1, reset: now + 60_000 }); return true; }
  return ++entry.count <= maxRpm;
}

export function jwtAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing Bearer token' }); return; }
    const claims = verifyJWT(auth.slice(7), secret);
    if (!claims) { res.status(401).json({ error: 'Invalid or expired token' }); return; }
    (req as any).user = claims;
    next();
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user as JWTClaims | undefined;
    const ip = req.ip ?? 'unknown';
    if (!checkRateLimit(ip)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    if (!user) { res.status(401).json({ error: 'Unauthenticated' }); return; }
    const allowed = hasPermission(user.role, permission);
    appendAudit({ user_id: user.sub, action: permission, resource: req.path, ip, at: new Date().toISOString(), result: allowed ? 'allow' : 'deny' });
    if (!allowed) { res.status(403).json({ error: `Permission denied: ${permission}` }); return; }
    next();
  };
}

export function getAuditLog(): AuditEntry[] { return [...auditLog]; }
