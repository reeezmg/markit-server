const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const Cursor = require('pg-cursor');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // or { user, host, database, password, port }
});

// GET variants of a specific company (only variants + items)

router.get('/company/:companyId', async (req, res) => {
  const { companyId } = req.params;

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  const client = await pool.connect();

  try {
   const sql = `
  SELECT v.id,
         v.name,
         v.images,
         v.s_price AS sprice,
         v.d_price AS dprice,
         v.discount,
         v.company_id,
         c.name AS company_name,       
         c.logo AS company_logo,       
         v.created_at AS "createdAt",
         p.name AS product_name,
         a.lat AS company_lat,
         a.lng AS company_lng,
         a.id AS company_location_id,
         COALESCE(
           json_agg(json_build_object(
             'id', i.id,
             'size', i.size,
             'qty', i.qty
           )) FILTER (WHERE i.id IS NOT NULL),
           '[]'
         ) AS items
  FROM variants v
  JOIN products p ON p.id = v.product_id
  JOIN companies c ON c.id = v.company_id 
  LEFT JOIN addresses a ON a.company_id = c.id  -- ✅ join addresses
  LEFT JOIN items i ON i.variant_id = v.id
  WHERE v.status = true
    AND v.company_id = $1
    AND array_length(v.images, 1) > 0
    AND EXISTS (
      SELECT 1 FROM items si
      WHERE si.variant_id = v.id
        AND COALESCE(si.qty, 0) > 0
    )
  GROUP BY v.id, p.name, c.name, c.logo, a.lat, a.lng, a.id
  ORDER BY v.created_at DESC
`;



    const cursor = client.query(new Cursor(sql, [companyId]));

    const batchSize = 50; // tune this (25–100 is good)
    const readNext = () => {
      cursor.read(batchSize, (err, rows) => {
        if (err) throw err;

        if (rows.length === 0) {
          cursor.close(() => client.release());
          return res.end();
        }

        for (const v of rows) {
          const formatted = {
            id: v.id,
            name: v.name,
            productName: v.product_name,
            images: v.images,
            sprice: v.sprice,
            dprice: v.dprice,
            discount: v.discount ?? 0,
            companyId: v.company_id,
            companyName: v.company_name,   
            companyLogo: v.company_logo, 
            companyLat: v.company_lat,     // ✅ new
            companyLng: v.company_lng,     // ✅ new
            companyLocationId: v.company_location_id, // ✅ new
            isNew: Date.now() - new Date(v.createdat).getTime() < 1000 * 60 * 60 * 24 * 30,
            outOfStock: v.items.every(i => (i.qty ?? 0) <= 0),
            items: v.items.map(i => ({
              id: i.id,
              size: i.size,
              qty: i.qty ?? 0,
            })),
          };

          res.write(JSON.stringify(formatted) + '\n');
        }

        setImmediate(readNext);
      });
    };

    readNext();
  } catch (error) {
    console.error('Error streaming variants:', error);
    client.release();
    res.status(500).end();
  }
});

router.get('/variant/:variantId', async (req, res) => {
  try {
    const { variantId } = req.params;
    const t1 = Date.now();

   const sql = `
  SELECT v.id,
         v.name,
         v.images,
         v.s_price AS sprice,
         v.d_price AS dprice,
         v.discount,
         v.company_id,
         c.name AS company_name,       
         c.logo AS company_logo,       
         v.created_at AS "createdAt",
         p.name AS product_name,
         a.lat AS company_lat,
         a.lng AS company_lng,
         a.id AS company_location_id,
         COALESCE(
           json_agg(json_build_object(
             'id', i.id,
             'size', i.size,
             'qty', i.qty
           )) FILTER (WHERE i.id IS NOT NULL),
           '[]'
         ) AS items
  FROM variants v
  JOIN products p ON p.id = v.product_id
  JOIN companies c ON c.id = v.company_id 
  LEFT JOIN addresses a ON a.company_id = c.id
  LEFT JOIN items i ON i.variant_id = v.id
  WHERE v.status = true
    AND v.company_id = $1
    AND array_length(v.images, 1) > 0
    AND EXISTS (
      SELECT 1 FROM items si
      WHERE si.variant_id = v.id
        AND COALESCE(si.qty, 0) > 0
    )
  GROUP BY 
    v.id, 
    p.name, 
    c.name, 
    c.logo, 
    a.lat, 
    a.lng,
    a.id 
  ORDER BY v.created_at DESC
`;


    const { rows } = await pool.query(sql, [variantId]);
    const t2 = Date.now();
    console.log('DB query took', t2 - t1, 'ms');

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    const row = rows[0];
    const formatted = {
      id: row.id,
      name: row.name,
      productName: row.product_name,
      images: row.images,
      sprice: row.sprice,
      dprice: row.dprice,
      discount: row.discount ?? 0,
      isNew: Date.now() - new Date(row.created_at).getTime() < 1000 * 60 * 60 * 24 * 30,
      outOfStock: row.items.every(i => (i.qty ?? 0) <= 0),
      items: row.items,
      variants: row.siblings,
      companyId: row.company_id,
      companyName: row.company_name, 
      companyLogo: row.company_logo, 
      companyLat: row.company_lat,  
      companyLng: row.company_lng, 
      companyLocationId: row.company_location_id 
    };


    res.json(formatted);
  } catch (error) {
    console.error('Error fetching variant details (raw SQL):', error);
    res.status(500).json({ error: 'Failed to fetch variant details' });
  }
});


router.get("/categories/:companyId", async (req, res) => {
  const { companyId } = req.params;

  try {
   const sql = `
      SELECT id, name
      FROM categories
      WHERE company_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(sql, [companyId]);

    res.json(rows);
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
