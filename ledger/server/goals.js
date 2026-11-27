// Savings goals: something to save toward (a holiday, an emergency fund, a car), with an amount
// and, if wanted, a date. Shown on the Accounts page and, once there is one, on the dashboard.
//
// How much is saved comes from one of two places:
//   - a linked account: the money in that account counts toward the goal. When several goals share
//     an account, its balance fills them in the order they were made, so the first is funded first
//     and nothing is counted twice;
//   - no account: the household types what they've saved, and updates it as they go.
// With a date, the goal also says how much to put away each month to get there.
//
// A goal can also follow the tax bill (added 2026-11-18, the owner's idea after noticing his tax fund
// works like a savings goal): `follow` = 'tax' means its amount isn't typed. It is whatever the Taxes
// page says is owed, worked out afresh each time, so the goal moves as income and withholding do.
// The figure comes from server/index.js through setTaxTarget (this file can't import that one).
import { db, iso } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '🎯', target REAL NOT NULL,
  target_date TEXT, account_id INTEGER, saved REAL NOT NULL DEFAULT 0, created TEXT NOT NULL)`);

if (!db.prepare('PRAGMA table_info(goals)').all().some((c) => c.name === 'follow')) db.exec('ALTER TABLE goals ADD COLUMN follow TEXT');
let taxTarget = null;
/** Hands this file a function giving { target, basis } for the tax bill, or null when there is nothing to go on. */
export const setTaxTarget = (fn) => { taxTarget = fn; };
const taxNow = () => { try { return taxTarget ? taxTarget() : null; } catch { return null; } };

const round = (n) => Math.round(n * 100) / 100;
const LINKABLE = ['savings', 'checking', 'investment', 'hsa'];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00`));

/** Every goal with what's saved, what's left and the monthly amount needed. */
if (!db.prepare('PRAGMA table_info(goals)').all().some((c) => c.name === 'sort')) db.exec('ALTER TABLE goals ADD COLUMN sort REAL');

export function goals() {
  const today = iso(new Date());
  const accounts = new Map(db.prepare('SELECT id, name, type, balance, available FROM accounts').all().map((a) => [a.id, a]));
  // What's left in each linked account as goals take their share, in the order the goals were made.
  const room = new Map();
  const tax = taxNow();
  return db.prepare('SELECT * FROM goals ORDER BY COALESCE(sort, id), id').all().map((g) => {
    // A goal that follows the tax bill takes its amount from the estimate, each time.
    if (g.follow === 'tax') g = { ...g, target: round(Math.max(0, tax?.target ?? 0)) };
    const acct = g.account_id ? accounts.get(g.account_id) : null;
    let saved = g.saved;
    if (acct) {
      if (!room.has(acct.id)) room.set(acct.id, Math.max(0, acct.type === 'checking' ? acct.available ?? acct.balance : acct.balance));
      saved = Math.min(room.get(acct.id), g.target);
      room.set(acct.id, room.get(acct.id) - saved);
    }
    saved = round(Math.max(0, saved));
    const left = round(Math.max(0, g.target - saved));
    let months = null;
    if (g.target_date) {
      const [y, m] = g.target_date.split('-').map(Number), [ty, tm] = today.split('-').map(Number);
      months = Math.max(1, (y - ty) * 12 + (m - tm) + (g.target_date.slice(8) >= today.slice(8) ? 0 : -1) + 1);
    }
    return {
      id: g.id, name: g.name, icon: g.icon, target: g.target, target_date: g.target_date || null,
      account: acct ? { id: acct.id, name: acct.name } : null, linkGone: !!g.account_id && !acct,
      follow: g.follow || null, basis: g.follow === 'tax' ? tax?.basis ?? 'none' : null,
      saved, left, pct: g.target > 0 ? Math.min(100, Math.round((saved / g.target) * 100)) : 0, done: g.target > 0 && left <= 0,
      past: !!g.target_date && g.target_date < today && left > 0,
      perMonth: left > 0 && months ? round(left / months) : null, months,
    };
  });
}

function read(body, existing) {
  const name = String(body?.name ?? existing?.name ?? '').trim().slice(0, 60);
  if (!name) return { error: 'Give the goal a name, such as Emergency fund.' };
  const follow = body?.follow === undefined ? existing?.follow || null : body.follow === 'tax' ? 'tax' : null;
  // A goal that follows the tax bill has no amount of its own; what the estimate says now is kept only as a placeholder.
  const target = follow === 'tax' ? Math.max(0.01, taxNow()?.target || 0.01) : Number(body?.target ?? existing?.target);
  if (!(target > 0)) return { error: 'Enter the amount you want to save.' };
  const date = body?.target_date === undefined ? existing?.target_date || '' : String(body.target_date || '').trim();
  if (date && !isDate(date)) return { error: "That date isn't one the app can read." };
  const accountId = body?.account_id === undefined ? existing?.account_id ?? null : body.account_id ? Number(body.account_id) : null;
  if (accountId && !db.prepare(`SELECT 1 FROM accounts WHERE id = ? AND type IN (${LINKABLE.map(() => '?').join(',')})`).get(accountId, ...LINKABLE)) return { error: 'Choose one of your savings or checking accounts.' };
  const saved = Number(body?.saved ?? existing?.saved ?? 0);
  if (!Number.isFinite(saved) || saved < 0) return { error: 'Enter what you have saved so far, or 0.' };
  const icon = String(body?.icon ?? existing?.icon ?? '🎯').trim().slice(0, 8) || '🎯';
  return { name, target: round(target), date: date || null, accountId, saved: round(saved), icon, follow };
}

export function installGoals(app) {
  const answer = () => ({
    goals: goals(),
    // Whether a goal can follow the tax bill here, and what that bill is now.
    tax: taxNow(),
    accounts: db.prepare(`SELECT id, name, type FROM accounts WHERE type IN (${LINKABLE.map(() => '?').join(',')}) ORDER BY type DESC, name`).all(...LINKABLE),
  });
  app.get('/api/goals', (_req, res) => res.json(answer()));

  app.post('/api/goals', (req, res) => {
    const g = read(req.body);
    if (g.error) return res.status(400).json({ error: g.error });
    db.prepare('INSERT INTO goals (name, icon, target, target_date, account_id, saved, created, follow) VALUES (?,?,?,?,?,?,?,?)').run(g.name, g.icon, g.target, g.date, g.accountId, g.saved, iso(new Date()), g.follow);
    res.json(answer());
  });

  app.patch('/api/goals/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM goals WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'That goal is no longer there.' });
    const g = read(req.body, existing);
    if (g.error) return res.status(400).json({ error: g.error });
    db.prepare('UPDATE goals SET name = ?, icon = ?, target = ?, target_date = ?, account_id = ?, saved = ?, follow = ? WHERE id = ?').run(g.name, g.icon, g.target, g.date, g.accountId, g.saved, g.follow, existing.id);
    res.json(answer());
  });

  // One place up or down. The order matters: goals that share an account are filled from the top.
  app.post('/api/goals/:id/move', (req, res) => {
    const dir = req.body?.dir === 'up' ? -1 : req.body?.dir === 'down' ? 1 : 0;
    const all = db.prepare('SELECT id FROM goals ORDER BY COALESCE(sort, id), id').all();
    const at = all.findIndex((g) => g.id === Number(req.params.id));
    if (!dir || at < 0) return res.status(400).json({ error: 'That goal could not be moved.' });
    const to = at + dir;
    if (all[to]) {
      [all[at], all[to]] = [all[to], all[at]];
      const set = db.prepare('UPDATE goals SET sort = ? WHERE id = ?');
      all.forEach((g, i) => set.run(i + 1, g.id));
    }
    res.json(answer());
  });

  app.delete('/api/goals/:id', (req, res) => {
    db.prepare('DELETE FROM goals WHERE id = ?').run(Number(req.params.id));
    res.json(answer());
  });
}
