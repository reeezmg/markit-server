const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../authMiddleware');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// make sure you have a working middleware:
router.use(authenticateToken);

router.get('/', async (req, res) => {
  const clientId = req.user.clientId;   // comes from authenticateToken
  try {
    const query = `
      SELECT name, gender, dob,phone
      FROM clients
      WHERE id = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [clientId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // return only the first row because LIMIT 1
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching client details:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/clients/
router.put('/', async (req, res) => {
  const clientId = req.user.clientId;
  const { name, gender, dob } = req.body;   // dob in ISO string format (e.g. "1995-04-12")

  try {
    const query = `
      UPDATE clients
         SET name   = COALESCE($1, name),
             gender = COALESCE($2, gender),
             dob    = COALESCE($3, dob)
       WHERE id = $4
         AND deleted IS NOT TRUE
       RETURNING name, gender, dob;
    `;

    const { rows } = await pool.query(query, [name, gender, dob, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client not found or already deleted' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error updating client details:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/clients/
router.delete('/', async (req, res) => {
  const clientId = req.user.clientId;

  try {
    const query = `
      UPDATE clients
         SET deleted = TRUE
       WHERE id = $1
         AND deleted IS NOT TRUE
       RETURNING id;
    `;

    const { rows } = await pool.query(query, [clientId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client not found or already deleted' });
    }

    res.json({ message: 'Client marked as deleted' });
  } catch (err) {
    console.error('Error soft deleting client:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = router;   // 👈 use module.exports when using require()
