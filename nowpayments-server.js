const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3001;

const NOWPAY_API_KEY = process.env.NOWPAY_API_KEY || 'e82a4699-1bc2-4ad6-9e33-522855a96417';
const NOWPAY_IPN_KEY = process.env.NOWPAY_IPN_KEY || 'VhXOz80D+ZgEDfGiq8+74ctu5gnaNtCf';
const SITE_URL       = process.env.SITE_URL       || 'https://goldfundamentals.netlify.app';

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

app.use(cors({ origin: '*' }));
app.use('/nowpay/ipn', express.raw({ type: '*/*' }));
app.use(express.json());

app.post('/nowpay/create-invoice', async (req, res) => {
  try {
    const { items, totalZAR } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }
    if (!totalZAR || totalZAR <= 0) {
      return res.status(400).json({ error: 'Invalid total amount' });
    }

    const itemIds    = items.join(',');
    const orderRef   = 'GF-BTC-' + Date.now();
    const itemNames  = items.map(id => APK_LABELS[id] || id).join(' + ');
    const successUrl = SITE_URL + '/?status=btc-success&items=' + encodeURIComponent(itemIds) + '&ref=' + orderRef;
    const cancelUrl  = SITE_URL + '/?status=cancel';

    // Convert ZAR to USD before sending to NOWPayments
    const totalUSD = parseFloat((totalZAR / 18.5).toFixed(2));

    const invoiceBody = {
      price_amount:        totalUSD,
      price_currency:      'USD',
      pay_currency:        'BTC',
      order_id:            orderRef,
      order_description:   'Gold Fundamentals — ' + itemNames,
      ipn_callback_url:    'https://bitcoinpay-1.onrender.com/nowpay/ipn',
      success_url:         successUrl,
      cancel_url:          cancelUrl,
      is_fixed_rate:       false,
      is_fee_paid_by_user: false
    };

    const response = await fetch('https://api.nowpayments.io/v1/invoice', {
      method:  'POST',
      headers: {
        'x-api-key':    NOWPAY_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invoiceBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('NOWPayments error:', data);
      return res.status(500).json({ error: data.message || 'Invoice creation failed' });
    }

    console.log('Invoice created: ' + orderRef + ' | $' + totalUSD + ' USD | Items: ' + itemIds);

    return res.json({
      success:    true,
      invoiceUrl: data.invoice_url,
      invoiceId:  data.id,
      orderRef:   orderRef
    });

  } catch (err) {
    console.error('Create invoice error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/nowpay/ipn', (req, res) => {
  try {
    const receivedSig = req.headers['x-nowpayments-sig'];
    if (!receivedSig) {
      return res.status(400).send('Missing signature');
    }

    const rawBody = req.body.toString('utf8');
    let parsed;
    try { parsed = JSON.parse(rawBody); }
    catch (e) { return res.status(400).send('Invalid JSON'); }

    const sorted   = JSON.stringify(parsed, Object.keys(parsed).sort());
    const expected = crypto.createHmac('sha512', NOWPAY_IPN_KEY).update(sorted).digest('hex');

    if (receivedSig !== expected) {
      console.warn('IPN signature mismatch');
      return res.status(400).send('Invalid signature');
    }

    const { payment_status, order_id, payment_id, actually_paid, pay_currency, price_amount, price_currency } = parsed;

    console.log('IPN: ' + order_id + ' | ' + payment_status + ' | ' + actually_paid + ' ' + pay_currency);

    if (payment_status === 'finished' || payment_status === 'confirmed') {
      console.log('PAYMENT CONFIRMED: ' + order_id + ' | $' + price_amount + ' ' + price_currency);
    }

    return res.status(200).send('OK');

  } catch (err) {
    console.error('IPN error:', err);
    return res.status(500).send('Server error');
  }
});

app.get('/nowpay/health', (req, res) => {
  res.json({ status: 'ok', service: 'Gold Fundamentals NOWPayments', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('NOWPayments server running on port ' + PORT);
});

module.exports = app;
