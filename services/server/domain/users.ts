/**
 * User directory. Passwords are bcrypt-hashed; every account starts with DEMO_PASSWORD.
 */
import bcrypt from 'bcryptjs';
import type { Role } from '../../auth/auth-middleware';

export interface User { id: string; username: string; name: string; role: Role; active: boolean; last_login: number | null; hash: string }
export type PublicUser = Omit<User, 'hash'>;

export class UserDirectory {
  private users: User[];

  constructor(password: string) {
    const hash = bcrypt.hashSync(password, 10);
    const u = (id: string, username: string, name: string, role: Role, active = true, lastAgoMs: number | null = null): User =>
      ({ id, username, name, role, active, last_login: lastAgoMs == null ? null : Date.now() - lastAgoMs, hash });
    this.users = [
      u('u1', 'ahmadi', 'سرگرد احمدی', 'commander', true, 7 * 3600_000),
      u('u2', 'maryam', 'مریم کاظمی', 'operator', true, 60_000),
      u('u3', 'reza', 'رضا نوری', 'analyst', true, 120_000),
      u('u4', 'ali', 'علی صادقی', 'planner', true, 3 * 3600_000),
      u('u5', 'sara', 'سارا مرادی', 'technical', true, 26 * 3600_000),
      u('u6', 'admin', 'مدیر سامانه', 'admin', true, null),
      u('u7', 'test', 'کاربر آزمایشی', 'operator', false, 40 * 86_400_000),
    ];
  }

  authenticate(username: string, password: string): PublicUser | null {
    const user = this.users.find((x) => x.username === username);
    if (!user || !user.active || !bcrypt.compareSync(password, user.hash)) return null;
    user.last_login = Date.now();
    return this.public(user);
  }

  byRole(role: Role): PublicUser | null { const u = this.users.find((x) => x.role === role && x.active); return u ? this.public(u) : null; }
  byId(id: string): PublicUser | null { const u = this.users.find((x) => x.id === id); return u ? this.public(u) : null; }
  list(): PublicUser[] { return this.users.map((u) => this.public(u)); }
  touch(id: string): void { const u = this.users.find((x) => x.id === id); if (u) u.last_login = Date.now(); }

  private public({ hash: _hash, ...rest }: User): PublicUser { return rest; }
}
