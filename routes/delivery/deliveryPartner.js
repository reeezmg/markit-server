// filepath: d:\markit\markit-server\routes\delivery\deliveryPartner.js
const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../../authMiddleware');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// ✅ Middleware for authentication
router.use(authenticateToken);

/**
 * ------------------------------------------------------------------
 * GET /api/delivery-partner/
 * Fetch delivery partner details for the logged-in user
 * ------------------------------------------------------------------
 */
router.get('/', async (req, res) => {
    const partnerId = req.user.deliveryPartnerId; // assuming partnerId is set by authenticateToken
    console.log('Fetched partnerId from token:', partnerId);

    if (!partnerId) {
        return res.status(401).json({ error: 'Unauthorized: partnerId missing' });
    }

    try {
        const query = `
      SELECT id, name, email, phone, status
      FROM delivery_partners
      WHERE id = $1 AND deleted IS NOT TRUE
      LIMIT 1;
    `;
        const { rows } = await pool.query(query, [partnerId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Delivery partner not found' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching delivery partner details:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * ------------------------------------------------------------------
 * GET /api/delivery-partner/:id
 * Fetch delivery partner details by id
 * ------------------------------------------------------------------
 */
router.get('/byid/:id', async (req, res) => {
    const id = req.params.id;

    if (!id) {
        return res.status(400).json({ error: 'Missing id parameter' });
    }

    try {
        const query = `
      SELECT id, name, email, phone, status
      FROM delivery_partners
      WHERE id = $1 AND deleted IS NOT TRUE
      LIMIT 1;
    `;
        const { rows } = await pool.query(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Delivery partner not found' });
        }

        res.json(rows[0]);

    } catch (err) {
        console.error('Error fetching delivery partner by id:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * ------------------------------------------------------------------
 * GET /api/delivery-partner/all
 * Fetch all delivery partners (not deleted)
 * ------------------------------------------------------------------
 */
router.get('/all', async (req, res) => {
    try {
        // use safe ordering by id to avoid relying on a non-existing created_at column
        const query = `
      SELECT *
      FROM delivery_partners
      WHERE deleted IS NOT TRUE
      ORDER BY id DESC;
    `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching all delivery partners:', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Internal server error', detail: err && err.message ? err.message : String(err) });
    }
});


/**
 * ------------------------------------------------------------------
 * POST /api/delivery-partner/
 * Create a new delivery partner
 * ------------------------------------------------------------------
 */
router.post('/', async (req, res) => {
    const {
        email,
        name,
        gender,
        dob,
        profilePic,
        phone,
        status,
        bloodGroup,
        ifsc,
        accountNo,
        bankName,
        upiId,
        branch,
        adharnumber,
        panNumber,
        drivingLicenseDoc,
        aadhaarCardDocs,
        panCardDoc,
        referral,
        otp,
        otpExpiry,
    } = req.body;

    try {
        const query = `
      INSERT INTO delivery_partners (
        email, name, gender, dob, profile_pic, phone, status,
        blood_group, ifsc, account_no, bank_name, upi_id, branch,
        adharnumber, pan_number, driving_license_doc, aadhaar_card_docs, pan_card_doc,
        referral, otp, otp_expiry,id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22
      )
      RETURNING id, name, email, phone, status;
    `;

        const values = [
            email || null,
            name || null,
            gender || null,
            dob || null,
            profilePic || null,
            phone || null,
            status === undefined ? true : status,
            bloodGroup || null,
            ifsc || null,
            accountNo || null,
            bankName || null,
            upiId || null,
            branch || null,
            adharnumber || null,
            panNumber || null,
            drivingLicenseDoc || null,
            aadhaarCardDocs || null,
            panCardDoc || null,
            referral || null,
            otp || null,
            otpExpiry ? new Date(otpExpiry) : null,
            uuidv4()
        ];

        const { rows } = await pool.query(query, values);
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('Error creating delivery partner:', err);

        if (err.code === '23505') {
            return res.status(409).json({
                error: 'Duplicate entry',
                detail: err.detail,
            });
        }

        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Update delivery partner email
 * PUT /api/delivery-partner/email
 */
router.put('/email', async (req, res) => {
    const partnerId = req.user?.partnerId;
    const { email } = req.body;

    if (!partnerId) {
        return res.status(401).json({ error: 'Unauthorized: partnerId missing' });
    }
    if (!email) {
        return res.status(400).json({ error: 'Missing email in request body' });
    }

    try {
        const query = `
      UPDATE delivery_partners
         SET email = $1,
             updated_at = NOW()
       WHERE id = $2
         AND deleted IS NOT TRUE
       RETURNING id, email;
    `;
        const { rows } = await pool.query(query, [email, partnerId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Delivery partner not found or already deleted' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Error updating delivery partner email:', err);
        if (err && err.code === '23505') {
            return res.status(409).json({ error: 'Email already in use', detail: err.detail });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Update delivery partner bank details
 * PUT /api/delivery-partner/bank
 */
router.put('/bank', async (req, res) => {
    const partnerId = req.user?.partnerId;
    const { ifsc, accountNo, bankName, upiId, branch } = req.body;

    if (!partnerId) {
        return res.status(401).json({ error: 'Unauthorized: partnerId missing' });
    }

    // require at least one bank field to update
    if ([ifsc, accountNo, bankName, upiId, branch].every((v) => v === undefined)) {
        return res.status(400).json({ error: 'At least one bank detail (ifsc, accountNo, bankName, upiId, branch) is required' });
    }
    try {
        const query = `
      UPDATE delivery_partners
         SET ifsc = COALESCE($1, ifsc),
             account_no = COALESCE($2, account_no),
             bank_name = COALESCE($3, bank_name),
             upi_id = COALESCE($4, upi_id),
             branch = COALESCE($5, branch),
             updated_at = NOW()
       WHERE id = $6
         AND deleted IS NOT TRUE
       RETURNING id,
                 ifsc,
                 account_no AS "accountNo",
                 bank_name AS "bankName",
                 upi_id AS "upiId",
                 branch;
    `;

        const values = [
            ifsc ?? null,
            accountNo ?? null,
            bankName ?? null,
            upiId ?? null,
            branch ?? null,
            partnerId,
        ];
        const { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Delivery partner not found or already deleted' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Error updating delivery partner bank details:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * ------------------------------------------------------------------
 * DELETE /api/delivery-partner/
 * Soft delete a delivery partner (mark as deleted)
 * ------------------------------------------------------------------
 */
router.delete('/', async (req, res) => {
    const partnerId = req.user?.partnerId;

    if (!partnerId) {
        return res.status(401).json({ error: 'Unauthorized: partnerId missing' });
    }

    try {
        const query = `
      UPDATE delivery_partners
      SET deleted = TRUE, updated_at = NOW()
      WHERE id = $1
        AND deleted IS NOT TRUE
      RETURNING id;
    `;

        const { rows } = await pool.query(query, [partnerId]);

        if (rows.length === 0) {
            return res
                .status(404)
                .json({ error: 'Delivery partner not found or already deleted' });
        }

        res.json({ message: 'Delivery partner marked as deleted' });
    } catch (err) {
        console.error('Error soft deleting delivery partner:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
