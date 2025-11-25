const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const router = express.Router();

const SECRET = process.env.JWT_SECRET || 'your-secret';

// 🟢 Initialize PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/yourdb',
});

// ------------------------
// 🔹 CLIENT OTP LOGIN FLOW
// ------------------------
router.post('/login', async (req, res) => {
  const { phone } = req.body;
  console.log('Auth request received with phone:', phone);

  if (!phone) {
    return res.status(400).json({ error: 'Phone number and OTP are required' });
  }

  const client = await pool.connect();
  try {
    // 🔹 Find client by phone
    const { rows } = await client.query('SELECT * FROM clients WHERE phone = $1', [phone]);
    const user = rows[0];

    if (!user) return res.status(404).json({ error: 'Client not found' });

    // // 🔹 Verify OTP
    // if (!user.otp || user.otp !== otp || !user.otp_expiry || new Date(user.otp_expiry) < new Date()) {
    //   return res.status(400).json({ error: 'Invalid or expired OTP' });
    // }

    // // 🔹 Clear OTP
    // await client.query('UPDATE clients SET otp = NULL, otp_expiry = NULL WHERE id = $1', [user.id]);

    // 🔹 Generate JWT
   const token = jwt.sign({ clientId: user.id }, SECRET);


    return res.json({ token, client: user });
  } catch (err) {
    console.error('Auth Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// 🔹 Generate OTP for Client
router.post('/otp', async (req, res) => {
  const { phone } = req.body;
  console.log('OTP request for client:', req.body);

  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const client = await pool.connect();
  try {
    // 🔹 Find or create client
    const { rows } = await client.query('SELECT * FROM clients WHERE phone = $1', [phone]);
    let user = rows[0];

    if (!user) {
      const insertRes = await client.query(
        'INSERT INTO clients (phone, name) VALUES ($1, $2) RETURNING *',
        [phone, '']
      );
      user = insertRes.rows[0];
    }

    // 🔹 Generate OTP valid for 2 minutes
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 2 * 60 * 1000);
    console.log(`Generated OTP for client ${phone}: ${otp}`);

    // 🔹 Save OTP
    await client.query('UPDATE clients SET otp = $1, otp_expiry = $2 WHERE id = $3', [
      otp,
      expiry,
      user.id,
    ]);

    // TODO: Send OTP via SMS/WhatsApp
    return res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('OTP Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------
// 🔹 DELIVERY PARTNER OTP LOGIN FLOW
// ---------------------------------------
router.post('/deliveryPartner/login', async (req, res) => {
  const { phone, otp } = req.body;
  console.log('Delivery Partner login request received with phone:', phone);

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone number and OTP are required' });
  }

  const db = await pool.connect();
  try {
    const { rows } = await db.query('SELECT * FROM delivery_partners WHERE phone = $1', [phone]);
    const partner = rows[0];

    if (!partner) return res.status(404).json({ error: 'Delivery Partner not found' });

    // if (!partner.otp || partner.otp !== otp || !partner.otp_expiry || new Date(partner.otp_expiry) < new Date()) {
    //   return res.status(400).json({ error: 'Invalid or expired OTP' });
    // }

    // await db.query('UPDATE delivery_partners SET otp = NULL, otp_expiry = NULL WHERE id = $1', [partner.id]);

   const token = jwt.sign({ deliveryPartnerId: partner.id }, SECRET);

    return res.json({ token, partner });
  } catch (err) {
    console.error('Delivery Partner Auth Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    db.release();
  }
});

// 🔹 Generate OTP for Delivery Partner
router.post('/deliveryPartner/otp', async (req, res) => {
  const { phone } = req.body;
  console.log('OTP request for delivery partner:', req.body);

  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const db = await pool.connect();
  try {
    const { rows } = await db.query('SELECT * FROM delivery_partners WHERE phone = $1', [phone]);
    let partner = rows[0];

    if (!partner) {
      const insertRes = await db.query(
        'INSERT INTO delivery_partners (phone, name) VALUES ($1, $2) RETURNING *',
        [phone, '']
      );
      partner = insertRes.rows[0];
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 2 * 60 * 1000);
    console.log(`Generated OTP for delivery partner ${phone}: ${otp}`);

    await db.query('UPDATE delivery_partners SET otp = $1, otp_expiry = $2 WHERE id = $3', [
      otp,
      expiry,
      partner.id,
    ]);

    return res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('Delivery Partner OTP Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    db.release();
  }
});

module.exports = router;
