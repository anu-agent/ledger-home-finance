// Reads a screenshot of a bank's activity list (for example several pending
// debit card purchases) and returns the transactions in it for review. Nothing
// is saved here: the Transactions page shows the list and adds the ones you keep.
//
// Privacy: the picture is sent to Anthropic's API with your own key and is not
// stored by the app.
import Anthropic from '@anthropic-ai/sdk';
import { db, iso } from './db.js';
import { apiKey, model, readableError } from './recap.js';
import { noteUsage, aiSource, limitMessage } from './ai.js';
import { makeCategorizer } from './simplefin.js';
import { WAITING_DAYS } from './waiting.js';

const TOOL = {
  name: 'record_transactions',
  description: 'Record every transaction visible in a screenshot of an activity list, in the order shown; or the one purchase a photographed receipt is for.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            description: { type: 'string', description: 'The merchant or description exactly as shown' },
            amount: { type: 'number', description: 'Always positive, in dollars' },
            direction: { type: 'string', enum: ['out', 'in'], description: 'out for purchases, withdrawals and payments; in for deposits and refunds' },
            pending: { type: 'boolean', description: 'true if the screenshot marks it as pending or processing' },
            items: {
              type: 'array',
              description: "Only for a photographed receipt: every item bought, each with one of the household's categories. Empty for an activity list.",
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'The item in plain words, spelling out the receipt\'s abbreviation where you can (for example "White bread" for GV WHT BRD)' },
                  amount: { type: 'number', description: 'What this item cost in dollars, including the tax actually charged on it and less any discount on it' },
                  category: { type: 'string', description: "One of the household's category names, exactly as given" },
                },
                required: ['name', 'amount', 'category'],
                additionalProperties: false,
              },
            },
          },
          required: ['date', 'description', 'amount', 'direction', 'pending', 'items'],
          additionalProperties: false,
        },
      },
    },
    required: ['transactions'],
    additionalProperties: false,
  },
};

const SYSTEM = `You read pictures for a personal finance app. Most are screenshots of a bank or card app's activity list; some are photos of a paper receipt. Call record_transactions exactly once.

A screenshot of an activity list: record every transaction row you can see, including pending ones.

A photo of a receipt (a shop's till receipt, a restaurant bill, an invoice): record ONE transaction for the whole receipt, not one per item. Its description is the shop's name as printed at the top, its amount is the final total actually paid (after tax, and including a tip if one is written in), its date is the date printed on the receipt (today's date if none can be read), and its direction is out, or in if the receipt is plainly a refund. It is not pending. If the total can't be read, call the tool with an empty list.\n\nA receipt can cover more than one kind of spending (food, clothing and medicine in one supermarket trip), so for a receipt also list its items. You are given the household's own category names. For each item bought give a short plain name, the category from that list it belongs in (spelled exactly; if you can't tell, use the category most of the receipt belongs to), and its cost. Several of the same thing can be one line.

Put the tax where it was really charged, because items on one receipt are often taxed at different rates (in many states food is taxed less than general goods, alcohol more, and some things not at all). Receipts show this: a letter or code beside each item (such as T, F, N, X or a number) and separate tax lines for each rate (TAX 1, TAX 2, a liquor or beer tax, a prepared-food tax). Work out which items each tax line applies to from those codes and rates, and add each tax line only to the items it was charged on, divided between them by their prices. Only when the receipt gives no way of telling which items a tax applies to should you share it across all the items in proportion. Do not use tax rates from memory: use only what is printed. Take an item's own coupon or discount off that item, and share a discount on the whole receipt in proportion. The items must add up to the receipt's total. For an activity list, leave items empty.`;

const round = (n) => Math.round(n * 100) / 100;

// First Security writes pending rows as "MemoPost: Pending: CKCD AUTH 11/13 LA HACIENDA".
// The useful parts are the purchase date and the merchant.
const BOILERPLATE = /^(?:memo\s?post:\s*)?(?:pending:\s*)?(?:(?:ckcd auth|pos db|pos debit|pos purchase|debit card purchase|ach debit)\s+)?(?:(\d{1,2})\/(\d{1,2})\s+)?/i;
export function tidy(description, date, today) {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  const m = BOILERPLATE.exec(text);
  const merchant = text.slice(m[0].length).trim() || text;
  if (m[1]) {
    // The most recent such month and day that isn't in the future.
    const y = Number(today.slice(0, 4));
    const pad = (n) => String(n).padStart(2, '0');
    for (const year of [y, y - 1]) {
      const d = `${year}-${pad(m[1])}-${pad(m[2])}`;
      if (!Number.isNaN(Date.parse(d)) && d <= today) return { merchant, date: d };
    }
  }
  return { merchant, date };
}

export async function readScreenshot(mediaType, data, categories = []) {
  const client = new Anthropic({ apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
  const source = aiSource();
  let response;
  try {
    response = await client.messages.create({
      model: model(),
      max_tokens: 16000,
      system: SYSTEM,
      tools: [TOOL],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: `Today is ${iso(new Date())}. Record the transactions in this picture.${categories.length ? ` The household's categories for spending: ${categories.join('; ')}.` : ''}` },
        ],
      }],
    });
  } catch (e) {
    throw readableError(e);
  }
  noteUsage('scan', response, source, 'a picture of a receipt or a bank screen, and the names of your categories');
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read that picture.');
  if (response.stop_reason === 'max_tokens') throw new Error('There was too much in that picture to read in one go. Try a screenshot with fewer rows.');
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!call || !Array.isArray(call.input?.transactions)) throw new Error("Claude couldn't find a list of transactions in that picture.");
  return call.input.transactions;
}

export function installScan(app) {
  app.post('/api/transactions/scan', async (req, res) => {
    if (!apiKey()) return res.status(400).json({ error: limitMessage() || 'Add an Anthropic API key on the Settings page to read screenshots.' });
    const account = db.prepare('SELECT id, type FROM accounts WHERE id = ?').get(Number(req.body?.account_id));
    if (!account) return res.status(400).json({ error: 'Choose the account the screenshot is from.' });
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
    if (!m) return res.status(400).json({ error: "That file isn't a picture the app can read. Use a PNG or JPEG screenshot." });
    if (m[2].length > 6_500_000) return res.status(400).json({ error: 'That picture is too large. Crop it to the list of transactions and try again.' });
    const spending = db.prepare("SELECT id, name FROM categories WHERE kind = 'expense' AND hidden = 0 ORDER BY sort").all();
    let found;
    try {
      found = await readScreenshot(m[1], m[2], spending.map((c) => c.name));
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
    const today = iso(new Date());
    const categorize = makeCategorizer();
    const atBank = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE account_id = ? AND manual = 0 AND abs(amount - ?) < 0.005
      AND date >= date(?, '-1 day') AND date <= date(?, '+${WAITING_DAYS} days')`);
    // (A waiting purchase that has been split is compared by its whole amount, parts included.)
    const typedIn = db.prepare(`SELECT COUNT(*) n FROM transactions t WHERE account_id = ? AND waiting = 1 AND split_of IS NULL AND abs(amount + COALESCE((SELECT SUM(k.amount) FROM transactions k WHERE k.split_of = t.id), 0) - ?) < 0.005
      AND date >= date(?, '-3 days') AND date <= date(?, '+3 days')`);
    // The bank's own entry for a purchase the picture shows, when there is one that hasn't been split:
    // a receipt for something already in the app can then be used to split that purchase.
    const bankRow = db.prepare(`SELECT id FROM transactions t WHERE account_id = ? AND manual = 0 AND pending = 0 AND split_of IS NULL AND abs(amount - ?) < 0.005
      AND date >= date(?, '-1 day') AND date <= date(?, '+${WAITING_DAYS} days') AND NOT EXISTS (SELECT 1 FROM transactions k WHERE k.split_of = t.id) ORDER BY date LIMIT 1 OFFSET ?`);
    // Two identical rows in the picture need two matching entries here to both count as already listed.
    const used = {};
    const items = [];
    for (const t of found.slice(0, 60)) {
      const amount = round(Math.abs(Number(t.amount)));
      let date = /^\d{4}-\d{2}-\d{2}$/.test(t.date) && !Number.isNaN(Date.parse(t.date)) ? t.date : today;
      if (date > today) date = today;
      const tidied = tidy(t.description, date, today);
      const merchant = tidied.merchant.slice(0, 120);
      date = tidied.date;
      if (!merchant || !(amount > 0)) continue;
      const direction = t.direction === 'in' ? 'in' : 'out';
      const signed = direction === 'in' ? amount : -amount;
      const key = `${date}|${signed}`;
      const seen = used[key] || 0;
      const already = atBank.get(account.id, signed, date, date).n > seen ? 'bank'
        : atBank.get(account.id, signed, date, date).n + typedIn.get(account.id, signed, date, date).n > seen ? 'typed' : null;
      const existing_id = already === 'bank' ? bankRow.get(account.id, signed, date, date, seen)?.id ?? null : null;
      if (already) used[key] = seen + 1;
      // A receipt's items, tidied: known categories only (anything else goes with the receipt's
      // main category), amounts made to add up to the total exactly, and a category that comes to
      // under $2 or 3% of the total folded into the main one so a pack of gum doesn't force a split.
      let lines = [];
      if (direction === 'out' && Array.isArray(t.items) && t.items.length) {
        lines = t.items.slice(0, 120).map((x) => ({
          name: String(x?.name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Item',
          amount: Number(x?.amount) > 0 ? Number(x.amount) : 0,
          category_id: spending.find((c) => c.name.toLowerCase() === String(x?.category || '').trim().toLowerCase())?.id ?? null,
        })).filter((x) => x.amount > 0);
        const sum = lines.reduce((a, x) => a + x.amount, 0);
        if (sum > 0 && lines.some((x) => x.category_id)) {
          const totals = new Map();
          for (const x of lines) if (x.category_id) totals.set(x.category_id, (totals.get(x.category_id) || 0) + x.amount);
          const main = [...totals].sort((a, b) => b[1] - a[1])[0][0];
          const small = Math.max(2, sum * 0.03);
          for (const x of lines) if (!x.category_id || (x.category_id !== main && totals.get(x.category_id) < small)) x.category_id = main;
          let left = amount;
          lines.forEach((x, n) => { x.amount = n === lines.length - 1 ? round(left) : round((x.amount / sum) * amount); left -= x.amount; });
          lines = lines.filter((x) => x.amount > 0);
        } else lines = [];
      }
      const byCat = new Map();
      for (const x of lines) byCat.set(x.category_id, (byCat.get(x.category_id) || 0) + x.amount);
      const mainCat = [...byCat].sort((a, b) => b[1] - a[1])[0]?.[0];
      items.push({ date, merchant, amount, direction, pending: !!t.pending, category_id: mainCat ?? categorize(merchant, signed, account.type), already, existing_id, lines });
    }
    res.json({ items });
  });
}
