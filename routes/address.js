const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../authMiddleware');
const router = express.Router();

// 🔹 Initialize PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/yourdb',
});

// ✅ Protect all routes
router.use(authenticateToken);

// ------------------------------
// 🔹 GET all addresses for client
// ------------------------------
router.get('/', async (req, res) => {
  const clientId = req.user.clientId;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      SELECT 
        id, 
        name, 
        formatted_address AS "formattedAddress",
        house_details AS "houseDetails",
        landmark, 
        type, 
        lat, 
        lng, 
        active, 
        client_id AS "clientId",
        created_at AS "createdAt"
      FROM addresses
      WHERE client_id = $1
      ORDER BY created_at DESC
      `,
      [clientId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching addresses:', error);
    res.status(500).json({ error: 'Failed to fetch addresses', details: error.message });
  } finally {
    client.release();
  }
});

// ------------------------------
// 🔹 CREATE new address
// ------------------------------
router.post('/', async (req, res) => {
  const clientId = req.user.clientId;
  const {
    id,
    name,
    formattedAddress,
    houseDetails,
    landmark,
    type,
    lat,
    lng,
    active = true,
  } = req.body;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      INSERT INTO addresses 
        (client_id, name, formatted_address, house_details, landmark, type, lat, lng, active, created_at, updated_at, id)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(),$10)
      RETURNING 
        id, name, formatted_address AS "formattedAddress", house_details AS "houseDetails", landmark, type, lat, lng, active, client_id AS "clientId"
      `,
      [clientId, name, formattedAddress, houseDetails, landmark, type, lat, lng, active,id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating address:', error);
    res.status(500).json({ error: 'Failed to create address', details: error.message });
  } finally {
    client.release();
  }
});

// ------------------------------
// 🔹 UPDATE existing address
// ------------------------------
router.put('/:id', async (req, res) => {
  const clientId = req.user.clientId;
  const id = req.params.id;
  const { name, formattedAddress, houseDetails, landmark, type, lat, lng } = req.body;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      UPDATE addresses
      SET 
        name = $1,
        formatted_address = $2,
        house_details = $3,
        landmark = $4,
        type = $5,
        lat = $6,
        lng = $7,
        updated_at = NOW()
      WHERE id = $8 AND client_id = $9
      RETURNING id
      `,
      [name, formattedAddress, houseDetails, landmark, type, lat, lng, id, clientId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Address not found or client mismatch' });
    }

    res.json({ message: 'Address updated successfully' });
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({ error: 'Failed to update address', details: error.message });
  } finally {
    client.release();
  }
});

// ------------------------------
// 🔹 DELETE address
// ------------------------------
router.delete('/:id', async (req, res) => {
  const clientId = req.user.clientId;
  const id = req.params.id;

  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM addresses WHERE id = $1 AND client_id = $2 RETURNING id',
      [id, clientId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Address not found or client mismatch' });
    }

    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({ error: 'Failed to delete address', details: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
