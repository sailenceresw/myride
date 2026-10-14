// SMS delivery for Nepal: Sparrow SMS (api.sparrowsms.com/v2) and Aakash SMS (sms.aakashsms.com/sms/v3),
// with automatic failover. Dev/test default is the console provider (prints instead of sending).
//
// Env:
//   SMS_PROVIDER = sparrow | aakash | console      (primary; default console)
//   SMS_FALLBACK = sparrow | aakash                (optional second provider)
//   SPARROW_TOKEN, SPARROW_FROM                     (token + NTA-approved sender ID from the Sparrow dashboard)
//   AAKASH_TOKEN                                    (auth_token from aakashsms.com)
//   ANDROID_SMS_HASH                                (11-char app hash → Android SMS Retriever auto-fill)

const SPARROW_URL = process.env.SPARROW_URL || 'https://api.sparrowsms.com/v2/sms/';
const AAKASH_URL = process.env.AAKASH_URL || 'https://sms.aakashsms.com/sms/v3/send';

// "+977 98…", "977-98…", "98…" → "98…" (only a 13-digit number carries the 977 country code).
const toLocal = (phone) => { const d = String(phone).replace(/\D/g, ''); return d.length === 13 && d.startsWith('977') ? d.slice(3) : d; };

const PROVIDERS = {
  console: {
    configured: () => true,
    async send(to, text, { log = console.log } = {}) {
      log(`[sms:console] → ${to}: ${text}`);
      return { ok: true, id: `console-${Date.now()}` };
    },
  },

  // Sparrow: POST form {token, from, to, text}; success = HTTP 200 + response_code 200.
  sparrow: {
    configured: () => !!(process.env.SPARROW_TOKEN && process.env.SPARROW_FROM),
    async send(to, text, { fetchImpl = fetch } = {}) {
      const body = new URLSearchParams({ token: process.env.SPARROW_TOKEN, from: process.env.SPARROW_FROM, to, text });
      const res = await fetchImpl(SPARROW_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
      const json = await res.json().catch(() => ({}));
      if (res.status === 200 && +json.response_code === 200) return { ok: true, id: json.message_id, credit: json.credit_consumed };
      return { ok: false, error: json.response || `HTTP ${res.status}` };
    },
  },

  // Aakash: POST form {auth_token, to, text}; success = error:false and the number in data.valid.
  aakash: {
    configured: () => !!process.env.AAKASH_TOKEN,
    async send(to, text, { fetchImpl = fetch } = {}) {
      const body = new URLSearchParams({ auth_token: process.env.AAKASH_TOKEN, to, text });
      const res = await fetchImpl(AAKASH_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
      const json = await res.json().catch(() => ({}));
      const valid = json?.data?.valid?.[0];
      if (json.error === false && valid) return { ok: true, id: valid.id, network: valid.network };
      const invalid = json?.data?.invalid?.[0];
      return { ok: false, error: json.message || (invalid ? `invalid number (${invalid.status})` : `HTTP ${res.status}`) };
    },
  },
};

function chain() {
  // Production never silently falls back to printing codes to the log: configure a real gateway.
  const primary = process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? '' : 'console');
  const list = [primary, process.env.SMS_FALLBACK].filter((p, i, a) => p && PROVIDERS[p] && a.indexOf(p) === i);
  return list.filter((p) => PROVIDERS[p].configured());
}

/**
 * Send one SMS, trying the primary provider then the fallback.
 * @returns {Promise<{ok:boolean, provider?:string, id?:any, error?:string, attempts:Array}>}
 */
async function sendSms(phone, text, opts = {}) {
  const to = toLocal(phone);
  if (!/^9[678]\d{8}$/.test(to)) return { ok: false, error: 'invalid Nepali mobile number', attempts: [] };
  const attempts = [];
  const providers = chain();
  if (!providers.length) return { ok: false, error: 'No SMS provider configured (set SPARROW_TOKEN+SPARROW_FROM or AAKASH_TOKEN)', attempts };
  for (const name of providers) {
    try {
      const r = await PROVIDERS[name].send(to, text, opts);
      attempts.push({ provider: name, ...r });
      if (r.ok) return { ok: true, provider: name, id: r.id, attempts };
    } catch (e) {
      attempts.push({ provider: name, ok: false, error: e.message });
    }
  }
  return { ok: false, error: attempts.at(-1)?.error || 'SMS failed', attempts };
}

const isConsole = () => process.env.NODE_ENV !== 'production' && (process.env.SMS_PROVIDER || 'console') === 'console';

// Message templates (≤ 160 GSM chars). OTP format works with Android SMS Retriever and iOS one-time-code auto-fill.
const templates = {
  otp: (code) => `<#> ${code} is your MyRide code. Valid 5 min. Never share it — MyRide staff will never ask.${process.env.ANDROID_SMS_HASH ? ` ${process.env.ANDROID_SMS_HASH}` : ''}`,
  deliveryCode: ({ code, sender, km }) => `MyRide: a delivery from ${String(sender).slice(0, 20)} is on its way (${km} km). Give the driver code ${code} only after you receive it.`,
  kycApproved: (name) => `MyRide Drive: Congratulations ${String(name).split(' ')[0]}! Your account is approved. Open the app, take a quick selfie and go online.`,
  kycAction: (status, reason) => `MyRide Drive: your application needs attention (${status}). ${String(reason || '').slice(0, 90)}`,
};

module.exports = { sendSms, templates, isConsole, toLocal, PROVIDERS };
