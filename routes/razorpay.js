const express = require('express');
const Razorpay = require("razorpay");
const crypto = require('crypto');
const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

router.post("/initiate", async (req, res) => {
  const { amount, currency } = req.body;

  const order = await razorpay.orders.create({
    amount: amount * 100, // in paise
    currency: currency || "INR",
    payment_capture: 1,
  });

  res.json(order);
});


router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment data' })
    }

    // ✅ Create expected signature using your secret key
    const key_secret = process.env.RAZORPAY_SECRET // store this securely in .env
    const generated_signature = crypto
      .createHmac('sha256', key_secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex')

    // ✅ Compare with Razorpay’s signature
    if (generated_signature === razorpay_signature) {
      console.log('✅ Razorpay payment verified')

      // (Optional) You can now mark the Razorpay payment as verified in DB, e.g.:
      // await pool.query(
      //   'UPDATE payments SET verified = true WHERE razorpay_payment_id = $1',
      //   [razorpay_payment_id]
      // )

      return res.json({ success: true })
    } else {
      console.warn('❌ Invalid signature')
      return res.status(400).json({ success: false, message: 'Invalid signature' })
    }
  } catch (error) {
    console.error('❌ Payment verification error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})
module.exports = router;