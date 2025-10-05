const express = require('express');
const { Pool } = require('pg');

const router = express.Router();


const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // or { user, host, database, password, port }
});

router.get('/', async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing lat or lng' });
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
    return res.status(400).json({ error: 'Invalid lat or lng' });
  }

  const sql = `
  SELECT 
    c.id,
    c.name,
    c.logo,
    c.category,
    c.description,
    c.storecode,
    c."store_unique_name" AS "storeUniqueName",
    c.currency,
    c.plan,
    c.gstin,
    c."upi_id" AS "upiId",
    -- Address fields
    a.id AS "addressId",
    a.name AS "addressName",
    a.street,
    a.locality,
    a.city,
    a.state,
    a.pincode,
    ST_X(a.coord::geometry) AS lng,
    ST_Y(a.coord::geometry) AS lat,
    -- Distance in meters
    ST_Distance(
      a.coord,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
    ) AS distance,
    -- Categories as array of names
    (
      SELECT COALESCE(json_agg(cat.name) FILTER (WHERE cat.id IS NOT NULL), '[]'::json)
      FROM categories cat
      WHERE cat.company_id = c.id
        AND cat.status = true
    ) AS categories
  FROM companies c
  JOIN addresses a ON a.company_id = c.id
  WHERE c.status = true
    AND a.coord IS NOT NULL
    AND ST_DWithin(
      a.coord,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      20000
    )
  ORDER BY distance ASC;
`;


  try {
    const t1 = Date.now();
    const { rows } = await pool.query(sql, [lngNum, latNum]); // note: lng then lat (ST_MakePoint(x,y) -> lon, lat)
    const t2 = Date.now();
    console.log('DB query took', t2 - t1, 'ms');

    // rows will be an array of objects already matching your selected aliases
    res.json(rows);
  } catch (err) {
    console.error('Error fetching nearby companies:', err);
    res.status(500).json({ error: 'Failed to fetch nearby shops' });
  }
});

module.exports = router;
