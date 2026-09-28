import { describe, it, expect } from 'vitest';
import { hasPermission, type Role } from '../../services/auth/auth-middleware';
import { can } from '../../dashboard/src/app/permissions';

const ROLES: Role[] = ['viewer', 'operator', 'analyst', 'planner', 'commander', 'technical', 'admin'];
const PERMS = [
  'read:positions', 'read:incidents', 'read:alerts', 'read:plans', 'read:scenarios', 'read:devices', 'read:admin',
  'write:incidents', 'ack:alerts', 'write:alerts', 'validate:incidents', 'write:plans', 'approve:plans', 'switch:route',
  'run:analysis', 'run:scenarios', 'command:devices', 'write:devices', 'run:maintenance', 'manage:keys',
];

describe('console permission mirror', () => {
  it('matches the server RBAC table for every role and permission', () => {
    for (const role of ROLES) for (const p of PERMS) expect([role, p, can(role, p)]).toEqual([role, p, hasPermission(role, p)]);
  });

  it('only the commander (and admin) can approve plans', () => {
    expect(ROLES.filter((r) => hasPermission(r, 'approve:plans'))).toEqual(['commander', 'admin']);
  });
});
