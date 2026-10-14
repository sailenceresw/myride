// Nepal digital payments: eSewa ePay v2 and Khalti ePayment v2.
// Defaults are the providers' public sandbox credentials; set real merchant keys via env for production.
const crypto = require('crypto');

const ESEWA = {
  formUrl: process.env.ESEWA_FORM_URL || 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
  statusUrl: process.env.ESEWA_STATUS_URL || 'https://rc.esewa.com.np/api/epay/transaction/status/',
  productCode: process.env.ESEWA_PRODUCT_CODE || 'EPAYTEST',
  secret: process.env.ESEWA_SECRET || '8gBm/:&EnhH.1/q', // eSewa's published test key
};

const KHALTI = {
  base: process.env.KHALTI_BASE || 'https://dev.khalti.com/api/v2',
  secret: process.env.KHALTI_SECRET_KEY || '',
};

function esewaSign(fields, signedFieldNames) {
  const msg = signedFieldNames.split(',').map((k) => `${k}=${fields[k]}`).join(',');
  return crypto.createHmac('sha256', ESEWA.secret).update(msg).digest('base64');
}

// Fields for an auto-submitting HTML form POST to eSewa.
function esewaForm({ amount, uuid, successUrl, failureUrl }) {
  const fields = {
    amount: String(amount), tax_amount: '0', total_amount: String(amount), transaction_uuid: uuid,
    product_code: ESEWA.productCode, product_service_charge: '0', product_delivery_charge: '0',
    success_url: successUrl, failure_url: failureUrl,
    signed_field_names: 'total_amount,transaction_uuid,product_code',
  };
  fields.signature = esewaSign(fields, fields.signed_field_names);
  return { action: ESEWA.formUrl, fields };
}

// eSewa redirects to success_url?data=<base64 JSON>. Verify its signature before trusting it.
function esewaVerify(dataB64) {
  let data;
  try { data = JSON.parse(Buffer.from(String(dataB64), 'base64').toString('utf8')); } catch { return null; }
  if (!data?.signed_field_names || !data.signature) return null;
  const expected = esewaSign(data, data.signed_field_names);
  const ok = expected.length === data.signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(data.signature));
  return ok ? data : null;
}

async function khaltiInitiate({ amount, orderId, orderName, returnUrl, websiteUrl, customer }, fetchImpl = fetch) {
  if (!KHALTI.secret) return { sandboxUnavailable: true, message: 'Set KHALTI_SECRET_KEY (from test-admin.khalti.com) to enable Khalti' };
  const res = await fetchImpl(`${KHALTI.base}/epayment/initiate/`, {
    method: 'POST',
    headers: { Authorization: `Key ${KHALTI.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      return_url: returnUrl, website_url: websiteUrl,
      amount: Math.round(amount * 100), // paisa
      purchase_order_id: orderId, purchase_order_name: orderName,
      customer_info: { name: customer.name, phone: customer.phone },
    }),
  });
  return res.json(); // { pidx, payment_url, expires_at }
}

async function khaltiLookup(pidx, fetchImpl = fetch) {
  const res = await fetchImpl(`${KHALTI.base}/epayment/lookup/`, {
    method: 'POST',
    headers: { Authorization: `Key ${KHALTI.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pidx }),
  });
  return res.json(); // { status: 'Completed' | 'Pending' | ..., total_amount, transaction_id }
}

module.exports = { esewaForm, esewaVerify, esewaSign, khaltiInitiate, khaltiLookup, ESEWA };
