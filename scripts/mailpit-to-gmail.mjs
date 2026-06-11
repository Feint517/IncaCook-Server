// Dev helper: watches the local Mailpit inbox and re-sends each new email to
// its original recipient through Gmail SMTP, so OTP / magic-link codes that
// Supabase delivers only to Mailpit also land in a real inbox. Mailpit keeps
// working unchanged — this is a one-way forwarder running alongside it.
//
// Run:  pnpm mail:bridge   (reads Gmail SMTP creds from .env.test)
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54334';
const POLL_MS = Number(process.env.MAILPIT_POLL_MS ?? 4000);
const ENV_FILE = process.env.MAIL_ENV_FILE ?? '.env.test';

// Recipients on these domains are seed/fake addresses — forwarding them to
// Gmail would just bounce and risks getting the sender throttled, so skip them.
const SKIP_DOMAINS = [/\.test$/i, /(^|\.)exemple\.fr$/i, /(^|\.)example\.(com|org|net)$/i];

function loadEnv(path) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read ${path} — Gmail SMTP creds expected there (MAIL_HOST, MAIL_USER, ...).`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = loadEnv(ENV_FILE);
const MAIL_HOST = env.MAIL_HOST;
const MAIL_PORT = Number(env.MAIL_PORT ?? 587);
const MAIL_USER = env.MAIL_USER;
// Gmail app passwords are shown in groups of 4 for readability; the real value
// has no spaces.
const MAIL_PASS = (env.MAIL_PASS ?? '').replace(/\s+/g, '');
const FROM_NAME = env.MAIL_FROM_NAME ?? 'IncaCook (local)';
const FROM_EMAIL = env.MAIL_FROM_EMAIL ?? MAIL_USER;

if (!MAIL_HOST || !MAIL_USER || !MAIL_PASS) {
  console.error(`[mail:bridge] Missing MAIL_HOST / MAIL_USER / MAIL_PASS in ${ENV_FILE}`);
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: MAIL_HOST,
  port: MAIL_PORT,
  secure: MAIL_PORT === 465, // 587 uses STARTTLS (secure:false)
  auth: { user: MAIL_USER, pass: MAIL_PASS },
});

function isSkipped(address) {
  const domain = String(address).split('@')[1] ?? '';
  return SKIP_DOMAINS.some((re) => re.test(domain));
}

function extractCode(text) {
  const labelled = text?.match(/code[:\s]+(\d{4,8})/i);
  if (labelled) return labelled[1];
  const bare = text?.match(/\b(\d{6})\b/);
  return bare ? bare[1] : null;
}

async function mailpit(path) {
  const res = await fetch(`${MAILPIT_URL}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} -> HTTP ${res.status}`);
  return res.json();
}

const forwarded = new Set();

async function pollOnce() {
  const list = await mailpit('/api/v1/messages?limit=50');
  // Mailpit returns newest first; reverse so we forward in arrival order.
  const messages = [...(list.messages ?? [])].reverse();
  for (const summary of messages) {
    if (forwarded.has(summary.ID)) continue;
    forwarded.add(summary.ID);

    const recipients = (summary.To ?? [])
      .map((t) => t.Address)
      .filter((addr) => addr && !isSkipped(addr));
    if (recipients.length === 0) continue;

    const full = await mailpit(`/api/v1/message/${summary.ID}`);
    const code = extractCode(full.Text || full.Snippet || full.Subject || '');
    try {
      await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to: recipients.join(', '),
        subject: full.Subject ?? summary.Subject ?? '(no subject)',
        text: full.Text || undefined,
        html: full.HTML || undefined,
      });
      console.log(
        `[mail:bridge] forwarded -> ${recipients.join(', ')}` +
          (code ? `  (code ${code})` : '') +
          `  "${full.Subject ?? ''}"`,
      );
    } catch (err) {
      // Keep it in `forwarded` so we don't hammer Gmail retrying a bad address.
      console.error(`[mail:bridge] send failed -> ${recipients.join(', ')}: ${err.message}`);
    }
  }
}

async function main() {
  await transporter.verify();
  console.log(`[mail:bridge] Gmail SMTP ready as ${MAIL_USER}. Watching ${MAILPIT_URL} every ${POLL_MS}ms.`);

  // Seed the backlog as already-seen so we don't blast existing test emails.
  try {
    const list = await mailpit('/api/v1/messages?limit=200');
    for (const m of list.messages ?? []) forwarded.add(m.ID);
    console.log(`[mail:bridge] ignoring ${forwarded.size} pre-existing message(s); forwarding only new ones.`);
  } catch (err) {
    console.error(`[mail:bridge] could not read Mailpit backlog (is it running?): ${err.message}`);
  }

  // Throttle repeated poll failures (e.g. Mailpit not up yet) to one log line
  // until it recovers, so the shared dev terminal stays readable.
  let pollFailing = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce();
      if (pollFailing) {
        console.log('[mail:bridge] Mailpit reachable again.');
        pollFailing = false;
      }
    } catch (err) {
      if (!pollFailing) {
        console.error(`[mail:bridge] poll error (retrying quietly): ${err.message}`);
        pollFailing = true;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(`[mail:bridge] fatal: ${err.message}`);
  process.exit(1);
});
