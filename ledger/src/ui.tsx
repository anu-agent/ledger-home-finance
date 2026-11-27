import { Hint } from './GoLinks';
import { goTo } from './go';
import { at as under } from './base';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CatIcon, EmojiPick } from './icons';
import { api, cents, money } from './lib';
import { logoSources } from './logos';

/** A number box that saves when you leave it. Blank is allowed only with allowBlank. */
export function NumField({ label, value, onSave, step = 1, allowBlank = false, placeholder, hint }: {
  label: string; value: string | number | null; onSave: (v: string) => Promise<unknown>;
  step?: number; allowBlank?: boolean; placeholder?: string; hint?: string;
}) {
  const initial = value == null ? '' : String(value);
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  useEffect(() => setV(initial), [initial]);
  const save = async () => {
    const t = v.trim();
    if (t === initial) return;
    if (t === '' ? !allowBlank : !Number.isFinite(Number(t)) || Number(t) < 0) return setErr('Enter 0 or more');
    try {
      await onSave(t);
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number" min="0" step={step} inputMode="decimal" value={v} placeholder={placeholder}
        onChange={(e) => { setV(e.target.value); setErr(''); }}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {err ? <small className="bad">{err}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

/**
 * A merchant's logo when we know its website, otherwise the category icon.
 * Logos are served by the app itself, from a copy it keeps.
 */
export function Logo({ name, fallback, edit, as, also }: { name?: string | null; fallback?: string | number; edit?: boolean; as?: string; also?: string[] }) {
  // `as` is the name a choice is kept under when it isn't the name shown (accounts: "account 12").
  // `also`: other names whose logo will do (an account's own name and its payments' name).
  const sources = logoSources(name, as, also);
  const key = sources.join('|');
  // Which source we're on; moves to the next one if an image fails to load.
  const [at, setAt] = useState(0);
  useEffect(() => setAt(0), [key]);
  const icon = at >= sources.length ? <CatIcon icon={fallback ?? (name || '?').trim().charAt(0).toUpperCase()} /> : (
    <span className="emoji logo">
      <img src={under(sources[at])} alt="" loading="lazy" onError={() => setAt(at + 1)} />
    </span>
  );
  // With `edit`, the icon is a button that opens the logo choices for this name (LogoDialog, in the shell).
  if (!edit || !name) return icon;
  return <button type="button" className="logo-btn" aria-label={`Change the icon for ${name}`} title="Change this icon" onClick={(e) => { e.stopPropagation(); e.preventDefault(); dispatchEvent(new CustomEvent('ledger-logo-edit', { detail: { key: as || name, label: name.trim() } })); }}>{icon}</button>;
}

export function TxAmount({ amount }: { amount: number }) {
  return <span className={`num ${amount > 0 ? 'good' : ''}`}>{amount > 0 ? '+' : ''}{cents(Math.abs(amount))}</span>;
}

export function Meter({ icon, name, spent, budget, id }: { icon: string; name: string; spent: number; budget: number; id?: number }) {
  const over = spent > budget;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
  return (
    <div className="meter">
      <div className="meter-top">
        <span><CatIcon icon={icon} edit={id ? { id, name } : undefined} />{name}</span>
        <span className={`num ${over ? 'bad' : 'sub'}`}>
          {money(spent)} / {money(budget)}
        </span>
      </div>
      <div className="track" role="img" aria-label={`${name}: ${money(spent)} of ${money(budget)}${over ? ', over budget' : ''}`}>
        <div className={over ? 'fill over' : 'fill'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** True when the device asks for less motion; animations are skipped then. */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A figure that rolls to its new value instead of jumping. With `intro` it also
 * counts up from zero the first time it appears.
 */
export function Roll({ value, format, intro = false }: { value: number; format: (n: number) => string; intro?: boolean }) {
  const [shown, setShown] = useState(intro && !reducedMotion() ? 0 : value);
  const from = useRef(shown);
  useEffect(() => {
    const start = from.current;
    if (start === value || reducedMotion()) { from.current = value; setShown(value); return; }
    const t0 = performance.now();
    const ms = 650;
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(p === 1 ? value : v);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // If the tab is in the background, frames may not run: land on the value anyway.
    const safety = setTimeout(() => { from.current = value; setShown(value); }, ms + 400);
    return () => { cancelAnimationFrame(frame); clearTimeout(safety); };
  }, [value]);
  return <>{format(shown)}</>;
}

/** Shimmering outlines shown while a page's figures load. */
export function Skeleton({ tiles = 0, cards = 2, rows = 4 }: { tiles?: number; cards?: number; rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {tiles > 0 && (
        <section className="tiles">
          {Array.from({ length: tiles }, (_, i) => <div key={i} className="tile skel"><i style={{ width: '45%' }} /><i className="big" style={{ width: '70%' }} /><i style={{ width: '55%' }} /></div>)}
        </section>
      )}
      {Array.from({ length: cards }, (_, c) => (
        <section key={c} className="card skel">
          <i className="big" style={{ width: '30%' }} />
          {Array.from({ length: rows }, (_, r) => <i key={r} style={{ width: `${88 - ((r * 17 + c * 9) % 40)}%` }} />)}
        </section>
      ))}
    </div>
  );
}

/**
 * On a touch screen, a row that slides left to uncover its actions. With a
 * mouse it's just the row.
 */
export function SwipeRow({ actions, children }: { actions: React.ReactNode; children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; on: boolean | null } | null>(null);
  const [open, setOpen] = useState(false);
  const width = () => tray.current?.offsetWidth ?? 0;
  const place = (x: number, animate: boolean) => {
    if (!track.current) return;
    track.current.style.transition = animate ? 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    track.current.style.transform = x ? `translateX(${x}px)` : '';
  };
  const settle = (to: boolean) => { setOpen(to); place(to ? -width() : 0, true); };
  return (
    <div className="swipe">
      <div
        className="swipe-track" ref={track}
        onPointerDown={(e) => { if (e.pointerType === 'touch' && actions) drag.current = { x: e.clientX, y: e.clientY, base: open ? -width() : 0, on: null }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          // Decide once whether this is a sideways swipe or a scroll.
          if (d.on === null && Math.abs(dx) + Math.abs(dy) > 8) d.on = Math.abs(dx) > Math.abs(dy);
          if (d.on) place(Math.max(-width() - 24, Math.min(0, d.base + dx)), false);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d?.on) settle(d.base + (e.clientX - d.x) < -width() / 2);
        }}
        onPointerCancel={() => { if (drag.current?.on) settle(open); drag.current = null; }}
        onClickCapture={(e) => { if (open && !(e.target as HTMLElement).closest('.swipe-actions')) { e.preventDefault(); e.stopPropagation(); settle(false); } }}
      >
        {children}
        {actions && <div className="swipe-actions" ref={tray} aria-hidden={!open} onClick={() => settle(false)}>{actions}</div>}
      </div>
    </div>
  );
}

/** Shrinks a chosen picture to a small square PNG, as a data URL. */
async function logoPicture(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const scale = Math.min(size / bmp.width, size / bmp.height);
  canvas.getContext('2d')!.drawImage(bmp, (size - bmp.width * scale) / 2, (size - bmp.height * scale) / 2, bmp.width * scale, bmp.height * scale);
  return canvas.toDataURL('image/png');
}

/** Turns a drawing (SVG) into a 128-pixel picture, the form every chosen logo is kept in. */
async function drawingToPicture(svg: string): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  canvas.getContext('2d')!.drawImage(img, 0, 0, 128, 128);
  return canvas.toDataURL('image/png');
}

/**
 * "Logo" link that opens a small form to set a merchant's logo: from a website, a picture, an icon
 * Claude draws from a description, or back to the app's choice. `openOn`, when given, also opens it
 * when the page announces that value (the Transactions page does when a row's icon is clicked).
 */
export function LogoPicker({ name, openOn }: { name: string; openOn?: number | string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openOn == null) return;
    const hear = (e: Event) => { if ((e as CustomEvent).detail === openOn) setOpen(true); };
    addEventListener('ledger-logo-open', hear);
    return () => removeEventListener('ledger-logo-open', hear);
  }, [openOn]);
  if (!open) return <button className="link" onClick={() => setOpen(true)} aria-label={`Set the logo for ${name}`}>Logo</button>;
  return <LogoForm name={name} onClose={() => setOpen(false)} />;
}

/**
 * The logo choices in a small window of their own, opened by clicking any merchant icon drawn with
 * `<Logo edit>` (the outlook, recent activity, bills, the detail pages, reports). One sits in the shell.
 */
export function LogoDialog() {
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => {
    const hear = (e: Event) => { const d = (e as CustomEvent).detail || {}; setName(String(d.key || '')); setLabel(String(d.label || d.key || '')); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setName('');
    addEventListener('ledger-logo-edit', hear); addEventListener('keydown', key);
    return () => { removeEventListener('ledger-logo-edit', hear); removeEventListener('keydown', key); };
  }, []);
  if (!name) return null;
  return (
    <div className="logo-dialog-overlay" onClick={() => setName('')}>
      <div className="logo-dialog card" role="dialog" aria-modal="true" aria-label={`Icon for ${label}`} onClick={(e) => e.stopPropagation()}>
        <h2><Logo name={label} as={name} />{label}</h2>
        <p className="sub">Choose the icon shown for this everywhere in Ledger.</p>
        <LogoForm name={name} onClose={() => setName('')} />
      </div>
    </div>
  );
}

/**
 * A category menu that always ends with "New category…". Choosing that opens a small window for the
 * name and icon; the category is made there and then, chosen in the menu, and every page's list of
 * categories is refreshed. Used wherever a category is picked outside the two older menus on the
 * Transactions page, which have their own way of doing the same thing.
 */
export function CategoryPicker({ cats, value, onChange, label, blank, allowNew = true }: {
  cats: { id: number; name: string; icon: string }[]; value: string | number; onChange: (id: string) => void; label?: string; blank?: string; allowNew?: boolean;
}) {
  const [making, setMaking] = useState(false);
  const [f, setF] = useState({ name: '', icon: '' });
  const [made, setMade] = useState<{ id: number; name: string; icon: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!f.name.trim()) return setErr('Enter a name for the category.');
    setBusy(true);
    try {
      const c = await api('/api/categories', { method: 'POST', body: f });
      setMade(c); setMaking(false); setF({ name: '', icon: '' }); setErr('');
      onChange(String(c.id));
      dispatchEvent(new Event('ledger-refresh'));
    } catch (x: any) { setErr(x.message); }
    setBusy(false);
  };
  // The one just made is shown at once, before the refreshed list arrives.
  const list = made && !cats.some((c) => c.id === made.id) ? [...cats, made] : cats;
  return (
    <>
      <select value={value} aria-label={label} onChange={(e) => (e.target.value === 'new' ? setMaking(true) : onChange(e.target.value))}>
        {blank != null && <option value="">{blank}</option>}
        {list.filter((c: any) => !c.hidden || String(c.id) === String(value)).map((c: any) => <option key={c.id} value={c.id}>{c.icon} {c.name}{c.kind === 'aside' ? ' (not counted)' : ''}</option>)}
        {allowNew && <option value="new">＋ New category…</option>}
      </select>
      {making && createPortal(
        <div className="logo-dialog-overlay" onClick={() => setMaking(false)}>
          <form className="logo-dialog card zoomed" role="dialog" aria-modal="true" aria-label="New category" noValidate onSubmit={create} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setMaking(false)}>
            <h2>New category</h2>
            <label className="field"><span>Name</span><input type="text" value={f.name} maxLength={40} placeholder="Haircuts" autoFocus onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(''); }} /></label>
            <EmojiPick value={f.icon} onChange={(v) => setF({ ...f, icon: v })} />
            {err && <p className="bad" role="alert"><Hint text={err} /></p>}
            <div className="dialog-actions"><button type="submit" className="primary" disabled={busy}>Create</button><button type="button" onClick={() => setMaking(false)}>Cancel</button></div>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}

/** The icon choices for a category, opened by clicking a category icon drawn with `<CatIcon edit>`. */
export function IconDialog() {
  const [cat, setCat] = useState<{ id: number; name: string; icon: string } | null>(null);
  const [icon, setIcon] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const hear = (e: Event) => { const d = (e as CustomEvent).detail; setCat(d); setIcon(d?.icon || ''); setName(d?.name || ''); setErr(''); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setCat(null);
    addEventListener('ledger-icon-edit', hear); addEventListener('keydown', key);
    return () => { removeEventListener('ledger-icon-edit', hear); removeEventListener('keydown', key); };
  }, []);
  if (!cat) return null;
  const save = async () => {
    if (!icon.trim()) return setErr('Choose an icon.');
    try { await api(`/api/categories/${cat.id}`, { method: 'PATCH', body: { icon, name } }); setCat(null); dispatchEvent(new Event('ledger-refresh')); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="logo-dialog-overlay" onClick={() => setCat(null)}>
      <div className="logo-dialog card" role="dialog" aria-modal="true" aria-label={`Icon for ${cat.name}`} onClick={(e) => e.stopPropagation()}>
        <h2><CatIcon icon={icon || cat.icon} />{name || cat.name}</h2>
        <p className="sub">The name and icon of this category, everywhere in Ledger.</p>
        <label className="field"><span>Name</span><input type="text" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setErr(''); }} /></label>
        <EmojiPick value={icon} onChange={(v) => { setIcon(v); setErr(''); }} />
        {err && <p className="bad" role="alert"><Hint text={err} /></p>}
        <div className="dialog-actions"><button className="primary" onClick={save}>Save</button><button onClick={() => setCat(null)}>Cancel</button></div>
      </div>
    </div>
  );
}

function LogoForm({ name, onClose }: { name: string; onClose: () => void }) {
  const setOpen = (_: boolean) => onClose();
  // Asking Claude to draw an icon: what to draw, and the drawing that came back, to look at before keeping.
  const [asking, setAsking] = useState(false);
  const [want, setWant] = useState('');
  const [drawing, setDrawing] = useState('');
  const draw = async () => {
    setBusy(true); setErr('');
    try { setDrawing((await api('/api/logos/draw', { method: 'POST', body: { merchant: name, request: want.trim() || name } })).svg); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const [site, setSite] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (body: object) => {
    setBusy(true); setErr('');
    try {
      await api('/api/logos/merchant', { method: 'PUT', body: { merchant: name, ...body } });
      dispatchEvent(new Event('ledger-logos'));
      setOpen(false); setSite(''); setAsking(false); setDrawing(''); setWant('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <span className="logo-picker">
      <form onSubmit={(e) => { e.preventDefault(); if (site.trim()) save({ domain: site }); else setErr('Type a website, or choose a picture.'); }}>
        <input value={site} autoFocus placeholder="Website, like kroger.com" aria-label={`Website to take the logo for ${name} from`} autoCapitalize="none" autoCorrect="off"
          onChange={(e) => { setSite(e.target.value); setErr(''); }} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
        <button type="submit" className="primary" disabled={busy}>Use</button>
        <label className="pick">
          Choose a picture
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { save({ image: await logoPicture(f) }); } catch { setErr("That picture couldn't be read."); } } }} />
        </label>
        <button type="button" disabled={busy} onClick={() => { setAsking(!asking); setErr(''); }}>Ask Claude to draw one</button>
        <button type="button" disabled={busy} onClick={() => save({ clear: true })}>Use the app's</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </form>
      {asking && (
        <form className="logo-draw" onSubmit={(e) => { e.preventDefault(); draw(); }}>
          <input value={want} autoFocus placeholder={`What should it show? e.g. a silver SUV`} aria-label={`What the icon for ${name} should show`} maxLength={200} onChange={(e) => { setWant(e.target.value); setErr(''); }} />
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Drawing…' : drawing ? 'Draw another' : 'Draw it'}</button>
          {drawing && <img className="logo-drawn" alt={`Drawn icon for ${name}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing)}`} />}
          {drawing && <button type="button" disabled={busy} onClick={async () => { try { await save({ image: await drawingToPicture(drawing) }); } catch { setErr("That drawing couldn't be turned into a picture. Try drawing another."); } }}>Use this</button>}
        </form>
      )}
      {err && <span className="bad" role="alert"><Hint text={err} /></span>}
    </span>
  );
}

/**
 * A box for an amount of money that puts the commas in as you type ("12,500.75"). `value` and what
 * `onChange` gives back are the plain number as text ("12500.75"), ready for Number().
 */
export function MoneyInput({ value, onChange, placeholder, label, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; autoFocus?: boolean }) {
  const shown = (() => {
    if (value === '') return '';
    const [whole, cents] = value.split('.');
    return (whole === '' ? '0' : Number(whole).toLocaleString('en-US')) + (cents !== undefined ? `.${cents}` : '');
  })();
  const typed = (text: string) => {
    let v = text.replace(/[^0-9.]/g, '');
    const dot = v.indexOf('.');
    if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    onChange(v.replace(/^0+(?=\d)/, ''));
  };
  return <input type="text" inputMode="decimal" autoComplete="off" value={shown} placeholder={placeholder} aria-label={label} autoFocus={autoFocus} onChange={(e) => typed(e.target.value)} />;
}

/** True at phone width, where the side menu is gone and rows are pared down. */
export const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;

/**
 * A titled section that shows only its title until opened; which ones are open is remembered on the
 * device (localStorage `ledger-folds`). Settings is built from these, and on a phone so is Taxes.
 */
export function Fold({ id, title, note, startOpen = false, plain = false, children }: { id: string; title: React.ReactNode; note?: string; startOpen?: boolean; plain?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('ledger-folds') || '{}'); return id in saved ? !!saved[id] : startOpen; } catch { return startOpen; }
  });
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem('ledger-folds', JSON.stringify({ ...JSON.parse(localStorage.getItem('ledger-folds') || '{}'), [id]: !open })); } catch { /* private window */ }
  };
  // Something else on the page can ask for this section to be opened (see openFold).
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === id) setOpen(true); };
    addEventListener('ledger-fold-open', on);
    return () => removeEventListener('ledger-fold-open', on);
  }, [id]);
  return (
    <div className={`fold ${plain ? 'plain' : ''} ${open ? 'open' : ''}`} data-fold={id}>
      <button className="fold-head" aria-expanded={open} onClick={toggle}>
        <span className="grow">{title}{note && <small>{note}</small>}</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}

/** On a phone, a fold; on a computer, just what's inside it. */
export function PhoneFold(p: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return isPhone() ? <Fold {...p} /> : <>{p.children}</>;
}

export type SheetItem = { label: string; run: () => void; danger?: boolean; hint?: string } | null | false | undefined | '';

/**
 * The phone's list of things to do with a row: large buttons in a panel at the foot of the screen, in
 * place of the line of small links a computer shows. Plain on purpose: it appears with no sliding or
 * blur, since motion effects are what once made the phone slow. A choice closes it, then runs.
 */
export function Sheet({ title, sub, items, children, onClose }: { title: string; sub?: React.ReactNode; items: SheetItem[]; children?: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  const list = items.filter(Boolean) as Exclude<SheetItem, null | false | undefined | ''>[];
  return createPortal(
    <div className="sheet-layer" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>{title}</b>{sub && <small>{sub}</small>}</div>
        {children}
        {list.map((i) => (
          <button key={i.label} type="button" className={`sheet-item ${i.danger ? 'danger' : ''}`} onClick={() => { onClose(); i.run(); }}>
            <span>{i.label}</span>{i.hint && <small>{i.hint}</small>}
          </button>
        ))}
        <button type="button" className="sheet-item sheet-cancel" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}

/** The "⋯" button that opens a row's sheet. Only drawn at phone width (styles hide it elsewhere). */
export function More({ name, sub, items }: { name: string; sub?: React.ReactNode; items: () => SheetItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="more-btn" aria-label={`More for ${name}`} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>⋯</button>
      {open && <Sheet title={name} sub={sub} items={items()} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Shrinks a picture to a size that reads well and uploads quickly, as a JPEG data URL. */
export async function shrinkPicture(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * Asks for a picture and keeps it as the receipt of one purchase (any purchase, not only ones added through
 * the reader). Call it straight from a tap or click, since browsers only open the chooser then. The picture
 * is shrunk to a JPEG first, which is also the only kind the tax pack can print. `done` hears how it went.
 */
export function pickReceipt(id: number, done: (error?: string) => void) {
  const box = document.createElement('input');
  box.type = 'file'; box.accept = 'image/*'; box.hidden = true;
  box.onchange = async () => {
    const file = box.files?.[0];
    box.remove();
    if (!file) return;
    try {
      const r = await fetch(`/api/transactions/${id}/receipt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: await shrinkPicture(file) }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "The picture couldn't be kept.");
      done();
    } catch (e: any) { done(e?.message || "That picture couldn't be opened."); }
  };
  document.body.appendChild(box);
  box.click();
}

/**
 * Opens a folded section and brings it (or something inside it, by selector) into view: for a line elsewhere
 * on the page that says "go here". The section is remembered as open, as if it had been tapped.
 */
export function openFold(id: string, at?: string) { goTo({ fold: id, at }); }

/**
 * A pop-up for one small job that is finished and closed (adding a pay stub, reading an email before it is
 * sent), in the same glass window as the About topics. It closes on its x, on Escape, or when what is inside
 * calls `onClose`; not on a click outside, so a slip of the hand can't throw away what was typed.
 */
/** Says what was just removed and, with a token from the server, offers to put it back (server/undo.js). */
export const offerUndo = (text: string, token?: string) => dispatchEvent(new CustomEvent('ledger-undo', { detail: { text, token } }));
export function UndoToast() {
  const [t, setT] = useState<{ text: string; token?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent).detail);
    addEventListener('ledger-undo', on);
    return () => removeEventListener('ledger-undo', on);
  }, []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), t.token ? 12000 : 4500);
    return () => clearTimeout(id);
  }, [t]);
  if (!t) return null;
  const undo = async () => {
    setBusy(true);
    try { await api('/api/undo', { method: 'POST', body: { token: t.token } }); setT({ text: 'Put back.' }); dispatchEvent(new CustomEvent('ledger-refresh')); }
    catch (e: any) { setT({ text: e.message }); }
    setBusy(false);
  };
  return createPortal(
    <div className="toast undo-toast" role="status"><span>{t.text}</span>{t.token && <button type="button" disabled={busy} onClick={undo}>Undo</button>}</div>, document.body);
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="about-overlay modal-layer">
      <div className="about-pop modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="about-pop-head modal-head"><h2>{title}</h2><button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>, document.body);
}
