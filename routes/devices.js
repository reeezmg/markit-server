const express = require('express')
const router = express.Router()
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

router.post('/', async (req, res) => {
  const { userId, deviceId, token, userAgent } = req.body

  const client = await pool.connect()
  try {
    // ✅ Try to find existing record
    const existingResult = await client.query(
      `SELECT id, token 
       FROM cap_push_token 
       WHERE user_id = $1 AND device_id = $2`,
      [userId, deviceId]
    )

    if (existingResult.rows.length === 0) {
      // Insert new
      await client.query(
        `INSERT INTO cap_push_token (user_id, device_id, token, user_agent) 
         VALUES ($1, $2, $3, $4)`,
        [userId, deviceId, token, userAgent]
      )
    } else {
      // Update only if token changed
      const existing = existingResult.rows[0]
      if (existing.token !== token) {
        await client.query(
          `UPDATE cap_push_token 
           SET token = $1 
           WHERE id = $2`,
          [token, existing.id]
        )
      }
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Error saving push token:', err)
    res.status(500).json({ error: 'Failed to save push token' })
  } finally {
    client.release()
  }
})

module.exports = router
