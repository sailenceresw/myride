// SMS delivery for Nepal: Sparrow SMS (api.sparrowsms.com/v2) and Aakash SMS (sms.aakashsms.com/sms/v3),
// with automatic failover. Dev/test default is the console provider (prints instead of sending).
//
// Env:
//   SMS_PROVIDER = sparrow | aakash | console      (primary; default console outside production)
//   SMS_FALLBACK = sparrow | aakash                (optional second provider)
//   SPARROW_TOKEN, SPARROW_FROM                     (token + NTA-approved sender ID from the Sparrow dashboard)
//   AAKASH_TOKEN                                    (auth_token from aakashsms.com)
//   ANDROID_SMS_HASH                                (11-char app hash → Android SMS Retriever auto-fill)

const SPARROW_URL = process.env.SPARROW_URL || 'https://api.sparrowsms.com/v2/sms/';
const AAKASH_URL = process.env.AAKASH_URL || 'https://sms.aakashsms.com/sms/v3/send';

/** Nepal mobile: 98x/97x (NTC, Ncell), 96x (Smart). The single source of this rule on the server. */
const PHONE_RE = /^9[678]\d{8}$/;

// "+977 98…", "977-98…", "98…" → "98…" (only a 13-digit number carries the 977 country code).
const toLocal = (phone) => { const d = String(phone).replace(/\D/g, ''); return d.length === 13 && d.startsWith('977') ? d.slice(3) : d; };

async function postForm(fetchImpl, url, params) {
  const res = await fetchImpl(url, { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(8000) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const PROVIDERS = {
  console: {
    configured: () => true,
    async send(to, text, { log = console.log } = {}) {
      log(`[sms:console] → ${to}: ${text}`);
      return { ok: true, id: `console-${Date.now()}` };
    },
  },
  // Sparrow: success = HTTP 200 + response_code 200.
  sparrow: {
    configured: () => !!(process.env.SPARROW_TOKEN && process.env.SPARROW_FROM),
    async send(to, text, { fetchImpl = fetch } = {}) {
      const { status, json } = await postForm(fetchImpl, SPARROW_URL, { token: process.env.SPARROW_TOKEN, from: process.env.SPARROW_FROM, to, text });
      if (status === 200 && +json.response_code === 200) return { ok: true, id: json.message_id, credit: json.credit_consumed };
      return { ok: false, error: json.response || `HTTP ${status}` };
    },
  },
  // Aakash: success = error:false and the number in data.valid.
  aakash: {
    configured: () => !!process.env.AAKASH_TOKEN,
    async send(to, text, { fetchImpl = fetch } = {}) {
      const { status, json } = await postForm(fetchImpl, AAKASH_URL, { auth_token: process.env.AAKASH_TOKEN, to, text });
      const valid = json?.data?.valid?.[0], invalid = json?.data?.invalid?.[0];
      if (json.error === false && valid) return { ok: true, id: valid.id, network: valid.network };
      return { ok: false, error: json.message || (invalid ? `invalid number (${invalid.status})` : `HTTP ${status}`) };
    },
  },
};

function chain() {
  // Production never silently falls back to printing codes to the log: configure a real gateway.
  const primary = process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? '' : 'console');
  return [primary, process.env.SMS_FALLBACK].filter((p, i, a) => p && PROVIDERS[p]?.configured() && a.indexOf(p) === i);
}

/**
 * Send one SMS, trying the primary provider then the fallback.
 * @returns {Promise<{ok:boolean, provider?:string, id?:any, error?:string, attempts:Array}>}
 */
async function sendSms(phone, text, opts = {}) {
  const to = toLocal(phone);
  if (!PHONE_RE.test(to)) return { ok: false, error: 'invalid Nepali mobile number', attempts: [] };
  const providers = chain();
  if (!providers.length) return { ok: false, error: 'No SMS provider configured (set SPARROW_TOKEN+SPARROW_FROM or AAKASH_TOKEN)', attempts: [] };
  const attempts = [];
  for (const provider of providers) {
    try {
      const r = await PROVIDERS[provider].send(to, text, opts);
      attempts.push({ provider, ...r });
      if (r.ok) return { ok: true, provider, id: r.id, attempts };
    } catch (e) {
      attempts.push({ provider, ok: false, error: e.message });
    }
  }
  return { ok: false, error: attempts.at(-1)?.error || 'SMS failed', attempts };
}

// Message templates (≤ 160 GSM chars). OTP format works with Android SMS Retriever and iOS one-time-code auto-fill.
const templates = {
  otp: (code) => `<#> ${code} is your MyRide code. Valid 5 min. Never share it — MyRide staff will never ask.${process.env.ANDROID_SMS_HASH ? ` ${process.env.ANDROID_SMS_HASH}` : ''}`,
  deliveryCode: ({ code, sender, km }) => `MyRide: a delivery from ${String(sender).slice(0, 20)} is on its way (${km} km). Give the driver code ${code} only after you receive it.`,
  kycApproved: (name) => `MyRide Drive: Congratulations ${String(name).split(' ')[0]}! Your account is approved. Open the app, take a quick selfie and go online.`,
  kycAction: (status, reason) => `MyRide Drive: your application needs attention (${status}). ${String(reason || '').slice(0, 90)}`,
};

module.exports = { sendSms, templates, toLocal, PHONE_RE, PROVIDERS };
