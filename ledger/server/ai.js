// Which Anthropic key the AI features use, and what they have cost.
//
// Two possible keys:
//   - the household's own, saved on the Settings page (setting `anthropic_api_key`)
//   - an "included" one, given to this copy by whoever hosts it through the
//     environment variable LEDGER_AI_KEY. The household never sees it. Its use
//     is limited to LEDGER_AI_MONTHLY_LIMIT dollars a calendar month (3 unless
//     set) and to the model in LEDGER_AI_MODEL (Claude Haiku 5.5 unless set),
//     because the host pays for it.
// A saved key of their own always comes first. Every call is written to
// `ai_usage` with its estimated cost, which is what the limit is checked against.
import { db, getSetting, setSetting } from './db.js';
import { STATES, stateOf } from './states.js';

/** The state the household lives in, by name, for prompts that read bank descriptions or talk about tax. */
export const homeState = () => { const c = stateOf(getSetting('tax_state')); return STATES[c].unset ? 'the United States' : STATES[c].name; };

db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, month TEXT NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL,
  source TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost REAL NOT NULL)`);

// What each call carried, in plain words ("120 shop names"), so a household can see what left its copy.
// Never the content itself. Added 2026-11-23.
if (!db.prepare('PRAGMA table_info(ai_usage)').all().some((c) => c.name === 'sent')) db.exec('ALTER TABLE ai_usage ADD COLUMN sent TEXT');

/** Categories the household keeps away from Claude (setting `ai_private_cats`, a list of ids). */
export const privateCats = () => { try { const a = JSON.parse(getSetting('ai_private_cats', '[]')); return Array.isArray(a) ? [...new Set(a.map(Number).filter(Number.isInteger))] : []; } catch { return []; } };
/** A piece of SQL that leaves those categories out; empty when there are none. The ids are whole numbers. */
export const notPrivate = (col = 't.category_id') => { const ids = privateCats(); return ids.length ? ` AND ${col} NOT IN (${ids.join(',')})` : ''; };

// Dollars per million tokens, in and out (Anthropic's list prices, November 2026).
const PRICES = [
  ['claude-haiku-5-5', 0.1, 0.5],
  ['claude-sonnet-5-5', 2, 10],
  ['claude-opus-5-5', 4, 20],
];
const DEAREST = [0, 5, 25];
const priceOf = (model) => PRICES.find(([id]) => String(model).startsWith(id)) || DEAREST;

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const round = (n, p = 100) => Math.round(n * p) / p;

const includedKey = () => String(process.env.LEDGER_AI_KEY || '').trim();
export const includedLimit = () => { const n = Number(process.env.LEDGER_AI_MONTHLY_LIMIT); return Number.isFinite(n) && n > 0 ? n : 3; };
const includedModel = () => (PRICES.some(([id]) => id === process.env.LEDGER_AI_MODEL) ? process.env.LEDGER_AI_MODEL : 'claude-haiku-5-5');
// The person who hosts this copy can keep their key out of it (setting `ai_host_off`, set from their own
// Ledger: Settings, Family requests). The household then brings its own Anthropic key or goes without AI,
// and can't switch the included AI back on from here.
const hostOff = () => getSetting('ai_host_off', '0') === '1';
const includedOn = () => includedKey() !== '' && !hostOff() && getSetting('ai_included', '1') === '1';
const spent = (source, month = thisMonth()) => db.prepare('SELECT COALESCE(SUM(cost), 0) s FROM ai_usage WHERE month = ? AND source = ?').get(month, source).s;
const overLimit = () => spent('included') >= includedLimit();

/** 'own', 'included', or '' when no AI is available right now. */
export function aiSource() {
  if (getSetting('anthropic_api_key')) return 'own';
  if (includedOn() && !overLimit()) return 'included';
  return '';
}

/** The key to call Anthropic with, or '' when there is none or this month's included amount is used up. */
export const activeKey = () => { const s = aiSource(); return s === 'own' ? getSetting('anthropic_api_key') : s === 'included' ? includedKey() : ''; };

/** The model the included AI is held to, or null when the household's own choice applies. */
// A family copy always runs on the basic model, whichever key it uses (The owner, 2026-11-18: "don't give them the
// option to choose a more enhanced Claude, the basic is fine"); only his own copy chooses a model.
export const familyCopy = () => !!process.env.LEDGER_SETUP_CODE;
export const forcedModel = () => (aiSource() === 'included' || familyCopy() ? includedModel() : null);

/** Why the AI features are off, when the reason is the monthly limit. */
export const limitMessage = () => (!getSetting('anthropic_api_key') && includedOn() && overLimit()
  ? `This month's included AI use ($${includedLimit().toFixed(2)}) is used up. It starts again on the 1st, or you can add your own Anthropic key on the Settings page.`
  : '');

/** Writes down what one reply from Anthropic cost and returns that cost in dollars. Never throws: a missed note mustn't lose the reply. */
export function noteUsage(feature, response, source = aiSource() || 'own', sent = '') {
  try {
    const u = response?.usage || {};
    const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const output = u.output_tokens || 0;
    const [, pin, pout] = priceOf(response?.model);
    // Anthropic also charges $10 per 1,000 web searches (reading a page costs only its tokens).
    const cost = (input * pin + output * pout) / 1e6 + (u.server_tool_use?.web_search_requests || 0) * 0.01;
    db.prepare('INSERT INTO ai_usage (at, month, feature, model, source, input_tokens, output_tokens, cost, sent) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(Date.now(), thisMonth(), feature, String(response?.model || ''), source, input, output, cost, String(sent || '').slice(0, 300));
    return cost;
  } catch { return 0; /* the reply still stands */ }
}

const FEATURES = { check: 'A check that the AI answers', cfo: 'Ask your CFO', lookup: 'Tax rules looked up', recap: 'Dashboard recap', scan: 'Screenshots read', icon: 'Icons drawn', paydays: 'Pay calendars read', paystub: 'Pay stubs read', statements: 'Statements read', work: 'Work questions', budgets: 'Budget suggestions', logos: 'Logo searches', categories: 'Category suggestions' };

/** What the Settings page shows: which key is in use, the included allowance, and this month's use. */
export function aiStatus() {
  const month = thisMonth();
  const rows = db.prepare('SELECT feature, COUNT(*) n, SUM(cost) cost FROM ai_usage WHERE month = ? GROUP BY feature ORDER BY cost DESC').all(month);
  const last = db.prepare('SELECT month, SUM(cost) cost, COUNT(*) n FROM ai_usage WHERE month < ? GROUP BY month ORDER BY month DESC LIMIT 1').get(month);
  return {
    source: aiSource(),
    ownKey: !!getSetting('anthropic_api_key'),
    // Shown the steps for making a key of their own: a family copy with no AI available to it.
    bringOwn: familyCopy() && !getSetting('anthropic_api_key') && (hostOff() || !includedKey()),
    included: includedKey() && !hostOff() ? { on: includedOn(), limit: includedLimit(), used: round(spent('included')), usedUp: overLimit(), model: includedModel() } : null,
    usage: {
      month,
      cost: round(rows.reduce((a, r) => a + r.cost, 0)),
      requests: rows.reduce((a, r) => a + r.n, 0),
      by: rows.map((r) => ({ feature: FEATURES[r.feature] || r.feature, requests: r.n, cost: round(r.cost) })),
      last: last ? { month: last.month, cost: round(last.cost), requests: last.n } : null,
    },
  };
}

/** What the host's Ledger is told about this copy's AI, and how it switches its key on or off here. Nothing private. */
export function hostAi(change) {
  if (typeof change?.included === 'boolean') setSetting('ai_host_off', change.included ? '0' : '1');
  const lookups = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(cost), 0) cost FROM ai_usage WHERE month = ? AND feature = 'lookup'").get(thisMonth());
  return { included: includedKey() !== '' && !hostOff(), ownKey: !!getSetting('anthropic_api_key'), used: round(spent('included')), limit: includedLimit(), month: thisMonth(), lookups: lookups.n, lookupCost: round(lookups.cost) };
}

export function installAi(app) {
  app.get('/api/ai', (_req, res) => res.json(aiStatus()));
  // What was sent lately, and which categories are kept away from Claude.
  const sentView = () => ({
    log: db.prepare('SELECT at, feature, sent FROM ai_usage ORDER BY id DESC LIMIT 40').all().map((r) => ({ at: r.at, feature: FEATURES[r.feature] || r.feature, sent: r.sent || '' })),
    private: privateCats(),
    categories: db.prepare("SELECT id, name, icon FROM categories WHERE kind = 'expense' AND hidden = 0 ORDER BY sort, name").all(),
  });
  app.get('/api/ai/sent', (_req, res) => res.json(sentView()));
  app.put('/api/ai/private', (req, res) => {
    const known = new Set(db.prepare("SELECT id FROM categories WHERE kind = 'expense'").all().map((c) => c.id));
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n) => known.has(n)))];
    setSetting('ai_private_cats', JSON.stringify(ids));
    res.json(sentView());
  });
  app.put('/api/ai/included', (req, res) => { if (hostOff()) return res.status(400).json({ error: "The included AI isn't offered on this copy. Add your own Anthropic key to use the AI features." }); setSetting('ai_included', req.body?.on ? '1' : '0'); res.json(aiStatus()); });
}
