/**
 * User directory. Passwords are bcrypt-hashed; every account starts with DEMO_PASSWORD.
 *
 * Each user belongs to one or more branches with a role per branch. `scope: 'regional'` (headquarters staff)
 * adds read-only access to every branch; writing in a branch always needs a membership there. The display
 * language preference is stored per user and returned at login so it follows the user across devices.
 */
import bcrypt from 'bcryptjs';
import type { Role } from '../../auth/auth-middleware';
import { LANGS, tri, type Lang, type Tri } from '../i18n/types';

export interface Membership { branch: string; role: Role }
export interface Preferences { lang: Lang; theme: 'dark' | 'light' }
export interface User {
  id: string; username: string; name: Tri; role: Role; home_branch: string; memberships: Membership[];
  scope: 'branch' | 'regional'; active: boolean; last_login: number | null; prefs: Preferences; hash: string;
}
export type PublicUser = Omit<User, 'hash'>;

export class UserError extends Error { constructor(public code: string, message: string) { super(message); } }

export class UserDirectory {
  private users: User[];

  constructor(password: string, private branchIds: string[] = ['MZR', 'KBL', 'HRT']) {
    const hash = bcrypt.hashSync(password, 10);
    const u = (id: string, username: string, name: Tri, memberships: Membership[], opts: { scope?: User['scope']; active?: boolean; lastAgoMs?: number | null; lang?: Lang } = {}): User => ({
      id, username, name, role: memberships[0].role, home_branch: memberships[0].branch, memberships, scope: opts.scope ?? 'branch',
      active: opts.active ?? true, last_login: opts.lastAgoMs == null ? null : Date.now() - opts.lastAgoMs,
      prefs: { lang: opts.lang ?? 'dr', theme: 'dark' }, hash,
    });
    const all = (role: Role) => branchIds.map((branch) => ({ branch, role }));
    this.users = [
      u('u1', 'ahmadi', tri('جگړن احمدی', 'جګړن احمدي', 'Maj. Ahmadi'), [{ branch: 'MZR', role: 'commander' }], { scope: 'regional', lastAgoMs: 7 * 3600_000 }),
      u('u2', 'maryam', tri('مریم حبیبی', 'مریم حبیبي', 'Maryam Habibi'), [{ branch: 'MZR', role: 'operator' }], { lastAgoMs: 60_000 }),
      u('u3', 'reza', tri('رضا رحیمی', 'رضا رحیمي', 'Reza Rahimi'), [{ branch: 'MZR', role: 'analyst' }], { lastAgoMs: 120_000 }),
      u('u4', 'ali', tri('علی احمدزی', 'علي احمدزی', 'Ali Ahmadzai'), [{ branch: 'MZR', role: 'planner' }, { branch: 'KBL', role: 'planner' }], { lastAgoMs: 3 * 3600_000, lang: 'ps' }),
      u('u5', 'sara', tri('سارا امیری', 'سارا امیري', 'Sara Amiri'), [{ branch: 'MZR', role: 'technical' }, { branch: 'HRT', role: 'technical' }], { lastAgoMs: 26 * 3600_000 }),
      u('u6', 'admin', tri('مدیر سیستم', 'د سیستم مدیر', 'System administrator'), all('admin'), { scope: 'regional', lang: 'en' }),
      u('u7', 'test', tri('کاربر آزمایشی', 'آزمایښتي کارن', 'Test user'), [{ branch: 'MZR', role: 'operator' }], { active: false, lastAgoMs: 40 * 86_400_000 }),
      u('u8', 'karimi', tri('دگروال کریمی', 'ډګروال کریمي', 'Col. Karimi'), [{ branch: 'KBL', role: 'commander' }], { lastAgoMs: 5 * 3600_000, lang: 'ps' }),
      u('u9', 'farida', tri('فریده نظری', 'فریده نظري', 'Farida Nazari'), [{ branch: 'KBL', role: 'operator' }], { lastAgoMs: 15 * 60_000 }),
      u('u10', 'sultani', tri('جگړن سلطانی', 'جګړن سلطاني', 'Maj. Sultani'), [{ branch: 'HRT', role: 'commander' }], { lastAgoMs: 9 * 3600_000 }),
      u('u11', 'wahidi', tri('احمد وحیدی', 'احمد وحیدي', 'Ahmad Wahidi'), [{ branch: 'HRT', role: 'operator' }], { lastAgoMs: 40 * 60_000 }),
    ];
  }

  authenticate(username: string, password: string): PublicUser | null {
    const user = this.users.find((x) => x.username === username);
    if (!user || !user.active || !bcrypt.compareSync(password, user.hash)) return null;
    user.last_login = Date.now();
    return this.public(user);
  }

  /** Role of the user in a branch, or null when they have no membership there. */
  roleIn(id: string, branch: string): Role | null {
    return this.users.find((x) => x.id === id)?.memberships.find((m) => m.branch === branch)?.role ?? null;
  }

  /** Branches the user may read: their memberships, or every branch for regional staff. */
  readable(id: string): string[] {
    const u = this.users.find((x) => x.id === id);
    if (!u) return [];
    return u.scope === 'regional' ? [...this.branchIds] : [...new Set(u.memberships.map((m) => m.branch))];
  }

  byRole(role: Role, branch?: string): PublicUser | null {
    const u = this.users.find((x) => x.active && x.memberships.some((m) => m.role === role && (!branch || m.branch === branch)));
    return u ? this.public(u) : null;
  }
  byId(id: string): PublicUser | null { const u = this.users.find((x) => x.id === id); return u ? this.public(u) : null; }
  byUsername(username: string): PublicUser | null { const u = this.users.find((x) => x.username === username); return u ? this.public(u) : null; }
  list(branch?: string): PublicUser[] { return this.users.filter((u) => !branch || u.memberships.some((m) => m.branch === branch)).map((u) => this.public(u)); }
  touch(id: string): void { const u = this.users.find((x) => x.id === id); if (u) u.last_login = Date.now(); }

  /** Display names of everyone visible from the given branches (to render `by` fields, which store usernames). */
  people(branches: string[]): Array<{ username: string; name: Tri; branches: string[] }> {
    return this.users.filter((u) => u.memberships.some((m) => branches.includes(m.branch)))
      .map((u) => ({ username: u.username, name: u.name, branches: u.memberships.map((m) => m.branch) }));
  }

  setPreferences(id: string, prefs: Partial<Preferences>): PublicUser {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new UserError('user_not_found', `user not found: ${id}`);
    if (prefs.lang !== undefined && !LANGS.includes(prefs.lang)) throw new UserError('bad_lang', 'lang must be dr, ps or en');
    if (prefs.theme !== undefined && prefs.theme !== 'dark' && prefs.theme !== 'light') throw new UserError('bad_theme', 'theme must be dark or light');
    u.prefs = { ...u.prefs, ...(prefs.lang ? { lang: prefs.lang } : {}), ...(prefs.theme ? { theme: prefs.theme } : {}) };
    return this.public(u);
  }

  private public({ hash: _hash, ...rest }: User): PublicUser { return rest; }
}
