// Savings goals (server/goals.js): the full card on the Accounts page, where goals are made and
// changed, and a short version for the dashboard that appears once there is a goal.
import { GO, jump } from '../go';
import { useEffect, useState } from 'react';
import { api, forgetLoaded, money, useData } from '../lib';
import { celebrate, once } from '../celebrate';
import { MoneyInput } from '../ui';

const ICONS = ['🎯', '🧾', '🛟', '🏖️', '✈️', '🚗', '🏠', '🎓', '🎁', '💍', '🐶', '🛠️', '👶', '🎄', '💻'];
type Form = { name: string; icon: string; target: string; target_date: string; account_id: string; saved: string; follow: string };
const BLANK: Form = { name: '', icon: '🎯', target: '', target_date: '', account_id: '', saved: '', follow: '' };
const monthYear = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** One goal's bar and the line under it. */
function GoalRow({ g, children }: { g: any; children?: React.ReactNode }) {
  // Confetti the first time this device sees the goal reached.
  useEffect(() => { if (g.done) once(`goal-${g.id}`, celebrate); }, [g.done, g.id]);
  return (
    <div className="goal">
      <div className="goal-head">
        <span className="goal-name"><span className="emoji">{g.icon}</span> {g.name}</span>
        <span className="num">{money(g.saved)} <span className="sub">of {money(g.target)}</span></span>
      </div>
      <div className="track tall" role="img" aria-label={`${g.pct}% of the way to ${g.name}`}><div className={`fill ${g.done ? 'done' : ''}`} style={{ width: `${g.pct}%` }} /></div>
      <div className="goal-foot">
        <small>
          {g.follow === 'tax' && g.target <= 0 ? (g.basis === 'none' ? 'Nothing to set aside yet: the Taxes page has no tax owed to go on. Enter your tax withheld there, or switch on a side gig.' : 'Nothing is owed right now.')
            : g.done ? 'Reached. Well done.'
            : g.past ? `${money(g.left)} to go. The date you set, ${monthYear(g.target_date)}, has passed.`
              : g.perMonth ? `${money(g.left)} to go: about ${money(g.perMonth)} a month to get there by ${monthYear(g.target_date)}.`
                : `${money(g.left)} to go.`}
          {g.account ? ` Counted from ${g.account.name}.` : g.linkGone ? ' The account it was linked to is gone; choose another.' : ''}
          {g.follow === 'tax' && g.target > 0 ? (g.basis === 'filing' ? ' The amount is what the Taxes page says you will owe at filing, and moves with it.' : ' The amount is the tax built up on your side-gig income so far, and grows as you earn.') : ''}
        </small>
        {children}
      </div>
    </div>
  );
}

/** The dashboard's short list. Shows nothing until the household has a goal. */
export function GoalsMini() {
  const { data } = useData('/api/goals');
  if (!data || !data.goals.length) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>Savings goals</h2><a href="#accounts" onClick={jump(GO.goals)}>Manage</a></div>
      {data.goals.map((g: any) => <GoalRow key={g.id} g={g} />)}
    </section>
  );
}

/** The full card: every goal, with the form to add or change one. */
export function GoalsCard() {
  const { data, reload } = useData('/api/goals');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [f, setF] = useState<Form>(BLANK);
  const [err, setErr] = useState('');
  if (!data) return null;
  const set = (k: keyof Form) => (e: any) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  const start = (g?: any) => {
    setF(g ? { name: g.name, icon: g.icon, target: String(g.target), target_date: g.target_date || '', account_id: g.account ? String(g.account.id) : '', saved: g.account ? '' : String(g.saved), follow: g.follow || '' } : BLANK);
    setEditing(g ? g.id : 'new'); setErr('');
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(editing === 'new' ? '/api/goals' : `/api/goals/${editing}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: { name: f.name, icon: f.icon, follow: f.follow || null, target: Number(f.target), target_date: f.target_date, account_id: f.account_id ? Number(f.account_id) : null, saved: f.account_id ? 0 : Number(f.saved) || 0 },
      });
      setEditing(null); forgetLoaded(); reload();
    } catch (e: any) { setErr(e.message); }
  };
  const move = async (g: any, dir: 'up' | 'down') => { try { await api(`/api/goals/${g.id}/move`, { method: 'POST', body: { dir } }); forgetLoaded(); reload(); } catch { /* stays where it was */ } };
  const remove = async (g: any) => { if (!confirm(`Remove the goal "${g.name}"? Your money isn't touched.`)) return; await api(`/api/goals/${g.id}`, { method: 'DELETE' }); forgetLoaded(); reload(); };
  return (
    <section className="card" data-go="goals">
      <div className="card-head"><h2>Savings goals</h2></div>
      {data.goals.length === 0 && editing == null && <p className="sub first">Something you're saving toward: an emergency fund, a holiday, a car. Give it an amount, and a date if you have one, and Ledger shows how far along you are and how much to put away each month.</p>}
      {data.goals.length > 1 && <p className="sub" style={{ margin: '0 0 6px' }}>Goals that share an account are filled from the top, so the arrows decide which one is filled first.</p>}
      {data.goals.map((g: any, i: number) => (
        <GoalRow key={g.id} g={g}>
          <span className="goal-actions">{data.goals.length > 1 && <span className="order-move"><button className="link" disabled={i === 0} aria-label={`Move ${g.name} up`} title="Move up" onClick={() => move(g, 'up')}>↑</button><button className="link" disabled={i === data.goals.length - 1} aria-label={`Move ${g.name} down`} title="Move down" onClick={() => move(g, 'down')}>↓</button></span>}<button className="link" onClick={() => start(g)}>Change</button><button className="link" onClick={() => remove(g)}>Remove</button></span>
        </GoalRow>
      ))}
      {editing == null ? <div className="add-actions" style={{ marginTop: 12 }}><button className="primary" onClick={() => start()}>Add a goal</button></div> : (
        <form onSubmit={save} noValidate className="add-grid" style={{ marginTop: 14 }}>
          <label>What you're saving for<input type="text" value={f.name} maxLength={60} placeholder="Emergency fund" onChange={set('name')} /></label>
          <label>Icon<select value={f.icon} onChange={set('icon')}>{[...new Set([f.icon, ...ICONS])].map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
          <label>How much
            <select value={f.follow} onChange={(e) => { const follow = e.target.value; setF({ ...f, follow, ...(follow === 'tax' && !f.name ? { name: 'Tax bill', icon: '🧾' } : {}) }); setErr(''); }}>
              <option value="">An amount I choose</option>
              <option value="tax">What I'll owe in tax (worked out for me)</option>
            </select>
            {f.follow === 'tax' && <small>{data.tax?.target > 0 ? `Right now that is ${money(data.tax.target)}. ` : ''}The amount comes from the Taxes page and changes as your income and tax withheld do, so you never retype it.</small>}
          </label>
          {f.follow !== 'tax' && <label>Amount to save<MoneyInput value={f.target} placeholder="3,000" onChange={(v) => { setF({ ...f, target: v }); setErr(''); }} /></label>}
          <label>By when (optional)<input type="date" value={f.target_date} onChange={set('target_date')} /></label>
          <label>Where the money is kept
            <select value={f.account_id} onChange={set('account_id')}>
              <option value="">I'll keep track myself</option>
              {data.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <small>{f.account_id ? "What's in that account counts toward the goal. If more than one goal uses the same account, the first goal you made is filled first." : 'Type what you have saved, and update it as you go.'}</small>
          </label>
          {!f.account_id && <label>Saved so far<MoneyInput value={f.saved} placeholder="0" onChange={(v) => { setF({ ...f, saved: v }); setErr(''); }} /></label>}
          <div style={{ alignSelf: 'end' }} className="add-actions">
            <button type="submit" className="primary">{editing === 'new' ? 'Add goal' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
