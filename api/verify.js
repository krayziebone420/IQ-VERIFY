// This runs on Vercel's server, not in the browser — so it's safe to trust.
// It asks PayPal directly "was this order really paid?" before saying yes.

const usedTokens = new Set(); // resets on redeploy; fine for low volume, see note in chat

async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  const base = process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return { token: data.access_token, base };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the test page lives on a different domain
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const orderToken = req.query.token; // PayPal sends this back as ?token=... after payment
  const expectedAmount = req.query.tier === 'full' ? '14.99' : '3.99';

  if (!orderToken) {
    return res.status(400).json({ ok: false, reason: 'missing_token' });
  }
  if (usedTokens.has(orderToken)) {
    return res.status(200).json({ ok: false, reason: 'already_used' });
  }

  try {
    const { token, base } = await getAccessToken();
    const orderRes = await fetch(`${base}/v2/checkout/orders/${orderToken}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const order = await orderRes.json();

    const paid = order.status === 'COMPLETED' || order.status === 'APPROVED';
    const amount = order.purchase_units?.[0]?.amount?.value;

    if (!paid) return res.status(200).json({ ok: false, reason: 'not_paid', status: order.status });
    if (amount && Number(amount) < Number(expectedAmount) - 0.01) {
      return res.status(200).json({ ok: false, reason: 'wrong_amount' });
    }

    usedTokens.add(orderToken);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
};
