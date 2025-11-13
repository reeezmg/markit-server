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

/* ------------------------------------------------------------------
   GET /api/delivery-partner/
   Fetch delivery partner details for the logged-in user
------------------------------------------------------------------- */
router.get('/', async (req, res) => {
    const partnerId = req.user.deliveryPartnerId;
    console.log('Fetched partnerId from token:', partnerId);

    if (!partnerId) {
        return res.status(401).json({ error: 'Unauthorized: partnerId missing' });
    }

    try {
        const partnerQuery = `
      SELECT 
        id,
        email,
        name,
        gender,
        dob,
        phone,
        status,
        ifsc,
        account_no AS "accountNo",
        bank_name AS "bankName",
        upi_id AS "upiId",
        adharnumber,
        pan_number AS "panNumber",
        driving_license_doc AS "drivingLicenseDoc",
        aadhaar_card_docs AS "aadhaarCardDocs",
        pan_card_doc AS "panCardDoc",
        referral,
        otp,
        otp_expiry AS "otpExpiry",
        blood_group AS "bloodGroup",
        branch,
        partner_id AS "partnerId",
        profile_pic AS "profilePic"
      FROM delivery_partners
      WHERE id = $1 AND deleted IS NOT TRUE
      LIMIT 1;
    `;
        const { rows } = await pool.query(partnerQuery, [partnerId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Delivery partner not found' });
        }

        const partner = rows[0];

        // parse aadhaar JSON safely
        if (partner.aadhaarCardDocs) {
            try {
                partner.aadhaarCardDocs = JSON.parse(partner.aadhaarCardDocs);
            } catch (_) {
                partner.aadhaarCardDocs = [partner.aadhaarCardDocs];
            }
        }

        // fetch latest address
        const addrQuery = `
      SELECT id, formatted_address AS "formattedAddress"
      FROM addresses
      WHERE "deliveryPartner_id" = $1
      AND active IS TRUE
      ORDER BY created_at DESC
      LIMIT 1;
    `;
        const { rows: addrRows } = await pool.query(addrQuery, [partner.id]);
        partner.address = addrRows[0] ? { formattedAddress: addrRows[0].formattedAddress } : null;

        res.json(partner);
    } catch (err) {
        console.error('Error fetching delivery partner details:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/* ------------------------------------------------------------------
   GET /api/delivery-partner/byid/:id
------------------------------------------------------------------- */
router.get('/byid/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id parameter' });

    try {
        const query = `
      SELECT 
        id,
        email,
        name,
        gender,
        dob,
        phone,
        status,
        ifsc,
        account_no AS "accountNo",
        bank_name AS "bankName",
        upi_id AS "upiId",
        adharnumber,
        pan_number AS "panNumber",
        driving_license_doc AS "drivingLicenseDoc",
        aadhaar_card_docs AS "aadhaarCardDocs",
        pan_card_doc AS "panCardDoc",
        referral,
        otp,
        otp_expiry AS "otpExpiry",
        blood_group AS "bloodGroup",
        branch,
        partner_id AS "partnerId",
        profile_pic AS "profilePic"
      FROM delivery_partners
      WHERE id = $1 AND deleted IS NOT TRUE
      LIMIT 1;
    `;
        const { rows } = await pool.query(query, [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Partner not found' });

        const partner = rows[0];
        if (partner.aadhaarCardDocs) {
            try {
                partner.aadhaarCardDocs = JSON.parse(partner.aadhaarCardDocs);
            } catch (_) {
                partner.aadhaarCardDocs = [partner.aadhaarCardDocs];
            }
        }

        const addrQuery = `
      SELECT id, formatted_address AS "formattedAddress"
      FROM addresses
      WHERE "deliveryPartner_id" = $1
      AND active IS TRUE
      ORDER BY created_at DESC
      LIMIT 1;
    `;
        const { rows: addrRows } = await pool.query(addrQuery, [partner.id]);
        partner.address = addrRows[0] ? { formattedAddress: addrRows[0].formattedAddress } : null;

        res.json(partner);
    } catch (err) {
        console.error('Error fetching delivery partner by id:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/* ------------------------------------------------------------------
   GET /api/delivery-partner/all
------------------------------------------------------------------- */
router.get('/all', async (req, res) => {
    try {
        const query = `
      SELECT 
        dp.id,
        dp.email,
        dp.name,
        dp.gender,
        dp.dob,
        dp.phone,
        dp.status,
        dp.ifsc,
        dp.account_no AS "accountNo",
        dp.bank_name AS "bankName",
        dp.upi_id AS "upiId",
        dp.adharnumber,
        dp.pan_number AS "panNumber",
        dp.driving_license_doc AS "drivingLicenseDoc",
        dp.aadhaar_card_docs AS "aadhaarCardDocs",
        dp.pan_card_doc AS "panCardDoc",
        dp.referral,
        dp.otp,
        dp.otp_expiry AS "otpExpiry",
        dp.blood_group AS "bloodGroup",
        dp.branch,
        dp.partner_id AS "partnerId",
        dp.profile_pic AS "profilePic",
        addr.formatted_address AS "formattedAddress"
      FROM delivery_partners dp
      LEFT JOIN LATERAL (
        SELECT formatted_address
        FROM addresses
        WHERE "deliveryPartner_id" = dp.id
          AND active IS TRUE
        ORDER BY id DESC
        LIMIT 1
      ) addr ON true
      WHERE dp.deleted IS NOT TRUE
      ORDER BY dp.id DESC;
    `;
        const { rows } = await pool.query(query);

        const partners = rows.map((row) => {
            let aadhaarDocs = row.aadhaarCardDocs;
            try {
                if (aadhaarDocs) aadhaarDocs = JSON.parse(aadhaarDocs);
            } catch (_) {
                aadhaarDocs = aadhaarDocs ? [aadhaarDocs] : [];
            }

            return {
                ...row,
                aadhaarCardDocs: aadhaarDocs,
                address: row.formattedAddress ? { formattedAddress: row.formattedAddress } : null,
            };
        });

        res.json(partners);
    } catch (err) {
        console.error('Error fetching all delivery partners:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/* ------------------------------------------------------------------
   POST /api/delivery-partner/
------------------------------------------------------------------- */
router.post('/', async (req, res) => {
    // Normalize both camelCase and snake_case
    const body = req.body;

    const {
        email,
        name,
        gender,
        dob,
        phone,
        address,
        status,
        referral,
        otp,
        otp_expiry,
    } = body;

    // Map both styles of naming to one consistent naming convention
    const profilePic = body.profilePic || body.profile_pic || null;
    const bloodGroup = body.bloodGroup || body.blood_group || null;
    const ifsc = body.ifsc || null;
    const accountNo = body.accountNo || body.account_no || null;
    const bankName = body.bankName || body.bank_name || null;
    const upiId = body.upiId || body.upi_id || null;
    const branch = body.branch || null;
    const adharnumber = body.adharnumber || body.adhar_number || null;
    const panNumber = body.panNumber || body.pan_number || null;
    const drivingLicenseDoc = body.drivingLicenseDoc || body.driving_license_doc || null;
    const aadhaarCardDocs = body.aadhaarCardDocs || body.aadhaar_card_docs || null;
    const panCardDoc = body.panCardDoc || body.pan_card_doc || null;
    const otpExpiry = body.otpExpiry || body.otp_expiry || null;

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const id = uuidv4();

        const insertPartner = `
            INSERT INTO delivery_partners (
                id, email, name, gender, dob, profile_pic, phone, status,
                blood_group, ifsc, account_no, bank_name, upi_id, branch,
                adharnumber, pan_number, driving_license_doc, aadhaar_card_docs, pan_card_doc,
                referral, otp, otp_expiry
            )
            VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,
                $9,$10,$11,$12,$13,$14,
                $15,$16,$17,$18,$19,
                $20,$21,$22
            )
            RETURNING 
                id, name, email, phone, status,
                profile_pic AS "profilePic",
                blood_group AS "bloodGroup",
                ifsc, account_no AS "accountNo", bank_name AS "bankName", upi_id AS "upiId",
                branch, adharnumber, pan_number AS "panNumber",
                driving_license_doc AS "drivingLicenseDoc",
                aadhaar_card_docs AS "aadhaarCardDocs",
                pan_card_doc AS "panCardDoc",
                referral, otp, otp_expiry AS "otpExpiry";
        `;

        const { rows } = await client.query(insertPartner, [
            id,
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
            aadhaarCardDocs ? JSON.stringify(aadhaarCardDocs) : null,
            panCardDoc || null,
            referral || null,
            otp || null,
            otpExpiry ? new Date(otpExpiry) : null,
        ]);

        const createdPartner = rows[0];

        // Insert address if provided
        if (address) {
            const addrId = uuidv4();
            const insertAddress = `
                INSERT INTO addresses (id, formatted_address, "deliveryPartner_id", created_at, updated_at)
                VALUES ($1, $2, $3, NOW(), NOW())
                RETURNING formatted_address AS "formattedAddress";
            `;
            const { rows: addrRows } = await client.query(insertAddress, [addrId, address, createdPartner.id]);
            if (addrRows[0]) {
                createdPartner.address = { formattedAddress: addrRows[0].formattedAddress };
            }
        }

        await client.query('COMMIT');
        res.status(201).json(createdPartner);
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('Error creating delivery partner:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (client) client.release();
    }
});


/* ------------------------------------------------------------------
   PUT /api/delivery-partner/bank
------------------------------------------------------------------- */
router.put('/update-bank', async (req, res) => {
    const partnerId = req.user?.deliveryPartnerId;

    if (!partnerId)
        return res.status(401).json({ error: 'Unauthorized: partnerId missing' });

    // ✅ Normalize field names to support both camelCase and snake_case
    const body = req.body;
    const ifsc = body.ifsc || null;
    const accountNo = body.accountNo || body.account_no || null;
    const bankName = body.bankName || body.bank_name || null;
    const upiId = body.upiId || body.upi_id || null;
    const branch = body.branch || null;

    if ([ifsc, accountNo, bankName, upiId, branch].every((v) => v === null))
        return res.status(400).json({ error: 'At least one bank detail must be provided' });

    try {
        const query = `
            UPDATE delivery_partners
            SET 
                ifsc = COALESCE($1, ifsc),
                account_no = COALESCE($2, account_no),
                bank_name = COALESCE($3, bank_name),
                upi_id = COALESCE($4, upi_id),
                branch = COALESCE($5, branch)
            WHERE id = $6 AND deleted IS NOT TRUE
            RETURNING 
                id, 
                ifsc, 
                account_no AS "accountNo", 
                bank_name AS "bankName", 
                upi_id AS "upiId", 
                branch;
        `;

        const { rows } = await pool.query(query, [
            ifsc,
            accountNo,
            bankName,
            upiId,
            branch,
            partnerId,
        ]);

        if (!rows.length)
            return res.status(404).json({ error: 'Partner not found' });

        res.json(rows[0]);
    } catch (err) {
        console.error('Error updating bank details:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});



/* ------------------------------------------------------------------
   DELETE /api/delivery-partner/
------------------------------------------------------------------- */
router.delete('/', async (req, res) => {
    const partnerId = req.user?.partnerId;
    if (!partnerId) return res.status(401).json({ error: 'Unauthorized: partnerId missing' });

    try {
        const query = `
      UPDATE delivery_partners
      SET deleted = TRUE, updated_at = NOW()
      WHERE id = $1 AND deleted IS NOT TRUE
      RETURNING id;
    `;
        const { rows } = await pool.query(query, [partnerId]);
        if (!rows.length) return res.status(404).json({ error: 'Partner not found' });

        res.json({ message: 'Delivery partner marked as deleted' });
    } catch (err) {
        console.error('Error soft deleting delivery partner:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
