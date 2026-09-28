/**
 * Phase 10: Auth Middleware
 */
import { Request, Response, NextFunction } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

export type Role = 'viewer' | 'operator' | 'analyst' | 'planner' | 'commander' | 'technical' | 'admin';

/**
 * `branch` is the active branch the token acts in (role = the user's role there); `branches` lists every branch the
 * user may read (regional staff: all of them). Tokens without branch claims act in the default branch.
 */
export interface JWTClaims { sub: string; name: string; role: Role; exp: number; iat: number; branch?: string; branches?: string[]; scope?: 'branch' | 'regional' }
export interface AuditEntry { user_id: string; action: string; resource: string; ip: string; at: string; result: 'allow' | 'deny'; chain_hash: string; }

// `read:admin` (audit log, user directory, SLA/maintenance/compliance/keys) is deliberately kept out of the base
// READ set: every other permission there is safe for a read-only viewer (including a regional user's downgraded
// view of a branch they don't hold a role in), but the admin surface exposes IPs, usernames and key material and
// is granted only to the `admin` role below.
const READ = ['read:positions', 'read:incidents', 'read:alerts', 'read:plans', 'read:scenarios', 'read:devices'];
const PERMISSIONS: Record<Role, Set<string>> = {
  viewer:    new Set(READ),
  operator:  new Set([...READ, 'write:incidents', 'ack:alerts', 'write:alerts', 'command:devices', 'run:scenarios', 'switch:route']),
  analyst:   new Set([...READ, 'write:incidents', 'ack:alerts', 'validate:incidents', 'run:analysis', 'run:scenarios']),
  planner:   new Set([...READ, 'write:plans', 'ack:alerts', 'run:analysis', 'run:scenarios', 'switch:route']),
  commander: new Set([...READ, 'write:incidents', 'ack:alerts', 'write:alerts', 'validate:incidents', 'write:plans', 'approve:plans', 'run:analysis', 'run:scenarios', 'command:devices', 'switch:route']),
  technical: new Set([...READ, 'ack:alerts', 'write:devices', 'command:devices', 'run:maintenance', 'manage:keys']),
  admin:     new Set(['*']),
};

export function hasPermission(role: Role, permission: string): boolean { const p = PERMISSIONS[role]; return !!p && (p.has('*') || p.has(permission)); }

export function verifyJWT(token: string, secret: string): JWTClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    const given = Buffer.from(sig), want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as JWTClaims;
    if (!Number.isFinite(claims.exp) || claims.exp < Math.floor(Date.now() / 1000)) return null;
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
let RATE_LIMIT_RPM = 120;
/** Requests per minute allowed per client IP on permission-checked routes. */
export function setRateLimit(rpm: number): void { if (rpm > 0) RATE_LIMIT_RPM = rpm; }
function checkRateLimit(ip: string, maxRpm = RATE_LIMIT_RPM): boolean {
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

/**
 * Resolves the branch a request acts on — `:branch` route param, `X-Branch` header or `?branch=` — and attaches
 * its context as `req.ctx`. Unknown branch → 404; a branch outside the token's readable set → 403. Reading
 * another branch than the token's active one is allowed for readable branches but with the `viewer` role, so
 * every write there is refused by `requirePermission` (switch branch to act in it).
 */
export function branchScope<T>(lookup: (id: string) => T | undefined, defaultBranch: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user as JWTClaims | undefined;
    if (!user) { res.status(401).json({ error: 'Unauthenticated' }); return; }
    const active = user.branch ?? defaultBranch;
    const q = req.query.branch;
    const requested = req.params.branch || req.header('x-branch') || (typeof q === 'string' ? q : '') || active;
    const ctx = lookup(requested);
    if (!ctx) { res.status(404).json({ error: `unknown branch: ${requested}`, code: 'branch_not_found' }); return; }
    if (requested !== active) {
      if (!(user.branches ?? [active]).includes(requested)) {
        appendAudit({ user_id: user.sub, action: 'read:branch', resource: requested, ip: req.ip ?? 'unknown', at: new Date().toISOString(), result: 'deny' });
        res.status(403).json({ error: `no access to branch ${requested}`, code: 'branch_forbidden' }); return;
      }
      (req as any).user = { ...user, role: 'viewer' as Role };
    }
    (req as any).branch = requested;
    (req as any).ctx = ctx;
    next();
  };
}

export function getAuditLog(): AuditEntry[] { return [...auditLog]; }
