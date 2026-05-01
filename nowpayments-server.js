/**
 * Gold Fundamentals — NOWPayments Bitcoin Backend
 * Deploy this on your existing Render server (autrader-pro-2.onrender.com)
 * or as a new Render web service.
 *
 * Install dependencies:
 *   npm install express cors crypto
 */

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ── CONFIG ── */
const NOWPAY_API_KEY = process.env.NOWPAY_API_KEY || 'e82a4699-1bc2-4ad6-9e33-522855a96417';
const NOWPAY_IPN_KEY = process.env.NOWPAY_IPN_KEY || 'VhXOz80D+ZgEDfGiq8+74ctu5gnaNtCf';
const SITE_URL       = process.env.SITE_URL       || 'https://goldfundamentals.netlify.app';

/* APK download links — one per product */
const APK_LINKS = {
  'gold-manual':  'https://www.appsgeyser.com/19605102',
  'au-trader':    'https://www.appsgeyser.com/19695951',
  'scalping-pro': 'https://www.appsgeyser.com/19752805'
};

const APK_LABELS = {
  'gold-manual':  'Gold Manual Trading',
  'au-trader':    'AuTrader Pro',
  'scalping-pro': 'Scalping Terminal Pro'
};

/* ── MIDDLEWARE ── */
app.use(cors({ origin: '*' }));

// Raw body needed for IPN signature verification
app.use('/nowpay/ipn', express.raw({ type: '*/*' }));

// JSON body for all other routes
app.use(express.json());

/* ══════════════════════════════════════════
   POST /nowpay/create-invoice
   Called by the website when customer clicks
   "Pay with Bitcoin". Creates a fresh invoice.
══════════════════════════════════════════ */
app.post('/nowpay/create-invoice', async (req, res) => {
  try {
    const { items, totalZAR } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }
    if (!totalZAR || totalZAR <= 0) {
      return res.status(400).json({ error: 'Invalid total amount' });
    }

    const itemIds   = items.join(',');
    const orderRef  = 'GF-BTC-' + Date.now();
    const itemNames = items.map(id => APK_LABELS[id] || id).join(' + ');

    // Build success URL — website will show download links on return
    const successUrl = `${SITE_URL}/?status=btc-success&items=${encodeURIComponent(itemIds)}&ref=${orderRef}`;
    const cancelUrl  = `${SITE_URL}/?status=cancel`;

    // NOWPayments invoice API
    // ZAR amount is sent directly — NOWPayments converts to BTC at live rate
    const body = {
      price_amount:    totalZAR,
      price_currency:  'ZAR',
      pay_currency:    'BTC',
      order_id:        orderRef,
      order_description: `Gold Fundamentals — ${itemNames}`,
      ipn_callback_url:  `https://autrader-pro-2.onrender.com/nowpay/ipn`,
      success_url:       successUrl,
      cancel_url:        cancelUrl,
      is_fixed_rate:     false,
      is_fee_paid_by_user: false
    };

    const response = await fetch('https://api.nowpayments.io/v1/invoice', {
      method:  'POST',
      headers: {
        'x-api-key':    NOWPAY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('NOWPayments invoice error:', data);
      return res.status(500).json({ error: data.message || 'Invoice creation failed' });
    }

    console.log(`[Invoice Created] ${orderRef} | R${totalZAR} | Items: ${itemIds}`);
    console.log(`  → Invoice URL: ${data.invoice_url}`);

    // Return the invoice URL to the frontend
    return res.json({
      success:     true,
      invoiceUrl:  data.invoice_url,
      invoiceId:   data.id,
      orderRef:    orderRef
    });

  } catch (err) {
    console.error('Create invoice error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ══════════════════════════════════════════
   POST /nowpay/ipn
   NOWPayments calls this when payment status
   changes (e.g. confirmed, finished).
══════════════════════════════════════════ */
app.post('/nowpay/ipn', (req, res) => {
  try {
    // 1. Verify the IPN signature
    const receivedSig = req.headers['x-nowpayments-sig'];
    if (!receivedSig) {
      console.warn('[IPN] Missing signature header');
      return res.status(400).send('Missing signature');
    }

    // NOWPayments signs the sorted JSON body with your IPN key using HMAC-SHA512
    const rawBody = req.body.toString('utf8');
    let parsed;
    try { parsed = JSON.parse(rawBody); }
    catch (e) {
      console.warn('[IPN] Invalid JSON body');
      return res.status(400).send('Invalid JSON');
    }

    // Sort the keys and re-stringify for signature check
    const sorted    = JSON.stringify(parsed, Object.keys(parsed).sort());
    const expected  = crypto
      .createHmac('sha512', NOWPAY_IPN_KEY)
      .update(sorted)
      .digest('hex');

    if (receivedSig !== expected) {
      console.warn('[IPN] Signature mismatch — possible fraud attempt');
      return res.status(400).send('Invalid signature');
    }

    // 2. Process the payment status
    const {
      payment_status,
      order_id,
      payment_id,
      actually_paid,
      pay_currency,
      price_amount,
      price_currency
    } = parsed;

    console.log(`[IPN] Order: ${order_id} | Status: ${payment_status} | Paid: ${actually_paid} ${pay_currency}`);

    // Statuses: waiting → confirming → confirmed → finished → failed/expired/refunded
    if (payment_status === 'finished' || payment_status === 'confirmed') {
      // Extract item IDs from order_id — format: GF-BTC-{timestamp}
      // Items were stored in the order description / success URL
      // For a production system you'd store this in a database.
      // For now we log it and you can manually verify + send APK.
      console.log(`[IPN] ✅ PAYMENT CONFIRMED`);
      console.log(`  Order:   ${order_id}`);
      console.log(`  Amount:  ${price_amount} ${price_currency}`);
      console.log(`  BTC Paid: ${actually_paid} ${pay_currency}`);
      console.log(`  Payment ID: ${payment_id}`);
      // TODO: look up order in DB → send customer their APK email
    }

    if (payment_status === 'failed' || payment_status === 'expired') {
      console.log(`[IPN] ❌ Payment ${payment_status} for order ${order_id}`);
    }

    // Always respond 200 to acknowledge receipt
    return res.status(200).send('OK');

  } catch (err) {
    console.error('[IPN] Error:', err);
    return res.status(500).send('Server error');
  }
});

/* ── HEALTH CHECK ── */
app.get('/nowpay/health', (req, res) => {
  res.json({ status: 'ok', service: 'Gold Fundamentals NOWPayments', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`NOWPayments server running on port ${PORT}`);
});

module.exports = app;
