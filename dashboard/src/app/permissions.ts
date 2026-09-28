import type { Role } from '../api/types';
/** UI affordances only — mirrors services/auth/auth-middleware.ts; the server enforces the real check.
 * `read:admin` is deliberately not in the base READ set — see that file for why. */
const READ = ['read:positions', 'read:incidents', 'read:alerts', 'read:plans', 'read:scenarios', 'read:devices'];
const PERMS: Record<Role, string[]> = {
  viewer: READ,
  operator: [...READ, 'write:incidents', 'ack:alerts', 'write:alerts', 'command:devices', 'run:scenarios', 'switch:route'],
  analyst: [...READ, 'write:incidents', 'ack:alerts', 'validate:incidents', 'run:analysis', 'run:scenarios'],
  planner: [...READ, 'write:plans', 'ack:alerts', 'run:analysis', 'run:scenarios', 'switch:route'],
  commander: [...READ, 'write:incidents', 'ack:alerts', 'write:alerts', 'validate:incidents', 'write:plans', 'approve:plans', 'run:analysis', 'run:scenarios', 'command:devices', 'switch:route'],
  technical: [...READ, 'ack:alerts', 'write:devices', 'command:devices', 'run:maintenance', 'manage:keys'],
  admin: ['*'],
};
export const can = (role: Role | null, perm: string) => !!role && (PERMS[role].includes('*') || PERMS[role].includes(perm));
