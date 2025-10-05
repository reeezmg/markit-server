const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../authMiddleware');

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

router.use(authenticateToken);

router.get("/trynbuy", async (req, res) => {
  const clientId = req.user.clientId;

  try {
    const query = `
      SELECT
        t.id AS trynbuy_id,
        t.order_number,
        t.created_at,
        t.checkout_method,
        t.subtotal,
        t.product_discount,
        t.total_discount,
        t.shipping,
        t.delivery_type,
        t.delivery_time,
        t.order_status,
        t.packing_status,
        json_build_object(
          'id', c.id,
          'name', c.name,
          'logo', c.logo
        ) AS company,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', v.id,
                'name', v.name,
                's_price', v.s_price,
                'd_price', v.d_price,
                'discount', v.discount,
                'images', v.images,
                'size', i.size,
                'quantity', tci.quantity
              )
            )
            FROM trynbuy_cart_items tci
            JOIN variants v ON tci.variant_id = v.id
            JOIN items i ON tci.item_id = i.id
            WHERE tci.trynbuy_id = t.id
          ), '[]'::json
        ) AS cartItems,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', v.id,
                'name', v.name,
                's_price', v.s_price,
                'd_price', v.d_price,
                'discount', v.discount,
                'images', v.images,
                'size', i.size,
                'quantity', tri.quantity
              )
            )
            FROM trynbuy_returned_items tri
            JOIN variants v ON tri.variant_id = v.id
            JOIN items i ON tri.item_id = i.id
            WHERE tri.trynbuy_id = t.id
          ), '[]'::json
        ) AS returnedItems
      FROM trynbuys t
      JOIN companies c ON t.company_id = c.id
      WHERE t.client_id = $1
      ORDER BY t.created_at DESC;
    `;

    const result = await pool.query(query, [clientId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching Trynbuy data:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



module.exports = router;
