// "A newer version of Ledger is available" (server/updatecheck.js). Only a copy run from the ready-made
// Docker image is ever told: Home Assistant has its own update button, and a hosted copy is updated by
// its host. The line sits with the dashboard's other notices; the pop-up shows what changed and the two
// lines that update it. Ledger can't update itself.
import { useState } from 'react';
import { api, forgetLoaded, useData } from './lib';
import { Modal } from './ui';

type Update = {
  offered: boolean; on?: boolean; current?: string; latest?: string; newer?: boolean; failed?: boolean;
  notes?: { version: string; items: string[] }[]; checkedAt?: number; image?: string; page?: string;
};

async function copy(text: string) {
  try { if (navigator.clipboard && isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

function Line({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="update-line">
      <code>{text}</code>
      <button type="button" className="button-link" onClick={async () => { if (await copy(text)) { setDone(true); setTimeout(() => setDone(false), 2500); } }}>{done ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export function UpdateSteps({ u, onClose }: { u: Update; onClose: () => void }) {
  const image = `${u.image}:latest`;
  return (
    <Modal title={u.newer ? `Ledger ${u.latest} is available` : 'How to update Ledger'} onClose={onClose}>
      <p className="sub">This copy is running {u.current}.{u.newer ? '' : u.latest ? ' That is the newest version, so there is nothing to do today. When a newer one is out, the dashboard says so and these are the steps.' : ' When a newer version is out, the dashboard says so and these are the steps.'} Updating keeps your accounts, settings and everything you've entered.</p>
      {u.newer && !!u.notes?.length && (
        <div className="update-notes">
          <h3>What's new</h3>
          {u.notes.map((n) => (
            <div key={n.version}>
              <b>{n.version}</b>
              <ul>{n.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      <h3>How to update</h3>
      <ol className="update-steps">
        <li>On the computer that runs Ledger, open Docker Desktop and click the small <b>&gt;_</b> at the bottom right.</li>
        <li>Paste this line and press Enter. It removes the old version; your data is kept:<Line text="docker rm -f ledger" /></li>
        <li>Then paste this one and press Enter. It fetches the new version and starts it:<Line text={`docker run -d --pull always --name ledger --restart unless-stopped -p 4317:4317 -v ledger-data:/data ${image}`} /></li>
        <li>Ledger is back in a few seconds. Reload this page.</li>
      </ol>
      <p className="sub">These lines fit a copy started the way the instructions show. If you started yours differently (another name, port or folder, or with Compose), update it the way you started it. <a href={u.page} target="_blank" rel="noreferrer">The project's page</a> has the details.</p>
      <div className="add-actions"><button type="button" className="button" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/** The dashboard's line. Hidden per device for a week at a time; a still newer version brings it back. */
export function UpdateNotice() {
  const { data: u } = useData<Update>('/api/update');
  const [open, setOpen] = useState(false);
  const [, redraw] = useState(0);
  if (!u?.offered || !u.newer || !u.latest) return null;
  let hidden = false;
  try { const h = JSON.parse(localStorage.getItem('ledger-update-hide') || 'null'); hidden = !!h && h.version === u.latest && h.until > Date.now(); } catch { /* show it */ }
  if (hidden && !open) return null;
  return (
    <div className="bank-attention" role="status">
      <span className="grow"><b>Ledger {u.latest} is available.</b> This copy is running {u.current}.</span>
      <button className="button-link" onClick={() => setOpen(true)}>How to update</button>
      <button className="link" onClick={() => { try { localStorage.setItem('ledger-update-hide', JSON.stringify({ version: u.latest, until: Date.now() + 7 * 86400000 })); } catch { /* private window */ } redraw((n) => n + 1); }}>Hide for a week</button>
      {open && <UpdateSteps u={u} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Settings, "Updates": what is running, whether something newer is out, and the switch. */
export function UpdateSettings() {
  const { data: u, reload } = useData<Update>('/api/update');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!u?.offered) return null;
  const act = async (path: string, method: string, body?: unknown) => {
    setBusy(true); setErr('');
    try { await api(path, { method, body }); forgetLoaded(); reload(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const when = u.checkedAt ? new Date(u.checkedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <section className="card">
      <p className="sub">This copy is running <b>Ledger {u.current}</b>.{' '}
        {!u.on ? 'Checking for updates is switched off.' : u.newer ? <><b>Ledger {u.latest} is available.</b></> : u.latest ? "That is the newest version." : "It hasn't looked for a newer one yet."}
        {u.on && when ? ` Last looked ${when}${u.failed ? ", when GitHub couldn't be reached" : ''}.` : ''}</p>
      <label className="row check"><span className="grow wrap">Check for a newer version once a day<small>Ledger reads the latest version number and the list of changes from its project page on GitHub. Nothing about your household is sent; GitHub sees this computer's internet address, as it did when Ledger was installed. Ledger never updates itself: it tells you, and shows how.</small></span>
        <input type="checkbox" checked={!!u.on} disabled={busy} onChange={(e) => act('/api/update', 'PUT', { on: e.target.checked })} /></label>
      <div className="add-actions">
        <button type="button" className={u.newer ? 'button' : 'button-link'} data-go="how-to-update" onClick={() => setOpen(true)}>{u.newer ? 'How to update' : 'How updating works'}</button>
        {u.on && <button type="button" className="button-link" disabled={busy} onClick={() => act('/api/update/check', 'POST')}>{busy ? 'Looking…' : 'Check now'}</button>}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {open && <UpdateSteps u={u} onClose={() => setOpen(false)} />}
    </section>
  );
}
