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
  const { phone, otp } = req.body;
  console.log('Auth request received with phone:', phone);

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone number and OTP are required' });
  }

  const client = await pool.connect();
  try {
    // 🔹 Find client by phone
    const { rows } = await client.query('SELECT * FROM clients WHERE phone = $1', [phone]);
    const user = rows[0];

    if (!user) return res.status(404).json({ error: 'Client not found' });

    // 🔹 Verify OTP
    if (!user.otp || user.otp !== otp || !user.otp_expiry || new Date(user.otp_expiry) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // 🔹 Clear OTP
    await client.query('UPDATE clients SET otp = NULL, otp_expiry = NULL WHERE id = $1', [user.id]);

    // 🔹 Generate JWT
    const token = jwt.sign({ clientId: user.id }, SECRET, { expiresIn: '7d' });

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

// 🔹 Generate OTP for bot new and existing delivery partner
router.post('/deliveryPartner/otp', async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const db = await pool.connect();
  try {
    // Check if phone already exists
    const existingPartner = await db.query(
      'SELECT id FROM delivery_partners WHERE phone = $1',
      [phone]
    );

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 2 * 60 * 1000);

    if (existingPartner.rows.length > 0) {
      // UPDATE OTP for existing user
      await db.query(
        `UPDATE delivery_partners 
         SET otp = $1, otp_expiry = $2 
         WHERE phone = $3`,
        [otp, expiry, phone]
      );

      console.log(phone, 'OTP updated:', otp);
      return res.json({ message: "OTP sent successfully" });
    }

    // INSERT new user with only required fields
    const insert = await db.query(
        `INSERT INTO delivery_partners
        (id, phone, otp, otp_expiry, name, status, deleted)
        VALUES (uuid_generate_v4(), $1, $2, $3, '', FALSE, FALSE)
        RETURNING id;
        `,
      [phone, otp, expiry]
    );

    console.log(phone, 'OTP created for NEW user:', otp);
    return res.json({
      message: "Account created. OTP sent.",
      partnerId: insert.rows[0].id,
    });

  } catch (err) {
    console.error("OTP error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    db.release();
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

    if (partner.status === false) {
      return res.status(403).json({
        error: "This number is not registered. Please sign up.",
        code: "NOT_REGISTERED"
      });
    }

    if (!partner.otp || partner.otp !== otp || !partner.otp_expiry || new Date(partner.otp_expiry) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    await db.query('UPDATE delivery_partners SET otp = NULL, otp_expiry = NULL WHERE id = $1', [partner.id]);

    const token = jwt.sign({ deliveryPartnerId: partner.id }, SECRET, { expiresIn: '7d' });

    return res.json({ token, partner });
  } catch (err) {
    console.error('Delivery Partner Auth Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    db.release();
  }
});

// On board delivery partner after otp verification
router.put("/deliveryPartner/onboard-user", async (req, res) => {
  const deliveryPartnerId = req.user.deliveryPartnerId; // from JWT middleware

  if (!deliveryPartnerId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    name,
    // vehicle,
    gender,
    dob,
    bloodGroup,
    ifsc,
    accountNo,
    bankName,
    upiId,
    branch,
    adharnumber,
    panNumber,
    address,
  } = req.body;

  const db = await pool.connect();
  try {
    const update = await db.query(
      `UPDATE delivery_partners SET
        name = $1,
        gender = $2,
        dob = $3,
        blood_group = $4,
        ifsc = $5,
        account_no = $6,
        bank_name = $7,
        upi_id = $8,
        branch = $9,
        adharnumber = $10,
        pan_number = $11
      WHERE id = $12
      RETURNING *`,
      [
        name,
        gender,
        dob,
        bloodGroup,
        ifsc,
        accountNo,
        bankName,
        upiId,
        branch,
        adharnumber,
        panNumber,
        deliveryPartnerId,
        address,
      ]
    );

    return res.json({
      message: "Profile updated successfully",
      partner: update.rows[0],
    });

  } catch (err) {
    console.error("Profile update error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    db.release();
  }
});

module.exports = router;
