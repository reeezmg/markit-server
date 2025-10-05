const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/prisma'); // Adjust path as needed
const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'your-secret';

// 🔹 LOGIN with OTP verification
router.post('/login', async (req, res) => {
  const { phone, otp } = req.body;
  console.log('Auth request received with phone:', phone);

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone number and OTP are required' });
  }

  try {
    let client = await prisma.client.findUnique({
      where: { phone }
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found. Please request OTP first.' });
    }

    // 🔹 Check if OTP matches and not expired
    if (
      !client.otp ||
      client.otp !== otp ||
      !client.otpExpiry ||
      client.otpExpiry < new Date()
    ) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // 🔹 Clear OTP fields after successful verification
    await prisma.client.update({
      where: { id: client.id },
      data: {
        otp: null,
        otpExpiry: null
      }
    });

    // 🔹 Generate JWT token with client ID
    const token = jwt.sign({ clientId: client.id }, SECRET, { expiresIn: '7d' });

    return res.json({ token, client });
  } catch (error) {
    console.error('Auth Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔹 Generate OTP
router.post('/otp', async (req, res) => {
  const { phone } = req.body;
  console.log(req.body)

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    // Find or create client
    let client = await prisma.client.findUnique({ where: { phone } });
    if (!client) {
      client = await prisma.client.create({
        data: { phone, name: '' }
      });
    }

    // Generate OTP valid for 2 minutes
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 2 * 60 * 1000);
    console.log(`Generated OTP for ${phone}: ${otp} (valid for 2 minutes)`);
    // Save OTP + expiry in client
    await prisma.client.update({
      where: { id: client.id },
      data: { otp, otpExpiry: expiry }
    });

    // TODO: send OTP via SMS/WhatsApp/email
    return res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('OTP Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
