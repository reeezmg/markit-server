const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../authMiddleware');

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

router.use(authenticateToken);

router.get('/trynbuy', async (req, res) => {
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

        -- ✅ All linked companies (many-to-many)
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', c.id,
                'name', c.name,
                'logo', c.logo
              )
            )
            FROM _try_n_buy_company tc
            JOIN companies c ON c.id = tc."A"
            WHERE tc."B" = t.id
          ),
          '[]'::json
        ) AS companies,

        -- ✅ Cart items with variant + product + company details
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', v.id,
                'name', v.name,
                'product_name', p.name,
                's_price', v.s_price,
                'd_price', v.d_price,
                'discount', v.discount,
                'images', v.images,
                'size', i.size,
                'quantity', tci.quantity,
                'company', json_build_object(
                  'id', co.id,
                  'name', co.name,
                  'logo', co.logo
                )
              )
            )
            FROM trynbuy_cart_items tci
            JOIN variants v ON tci.variant_id = v.id
            JOIN items i ON tci.item_id = i.id
            JOIN products p ON v.product_id = p.id
            JOIN companies co ON p.company_id = co.id
            WHERE tci.trynbuy_id = t.id
          ),
          '[]'::json
        ) AS cartItems,

        -- ✅ Returned items with variant + product + company details
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', v.id,
                'name', v.name,
                'product_name', p.name,
                's_price', v.s_price,
                'd_price', v.d_price,
                'discount', v.discount,
                'images', v.images,
                'size', i.size,
                'quantity', tri.quantity,
                'company', json_build_object(
                  'id', co.id,
                  'name', co.name,
                  'logo', co.logo
                )
              )
            )
            FROM trynbuy_returned_items tri
            JOIN variants v ON tri.variant_id = v.id
            JOIN items i ON tri.item_id = i.id
            JOIN products p ON v.product_id = p.id
            JOIN companies co ON p.company_id = co.id
            WHERE tri.trynbuy_id = t.id
          ),
          '[]'::json
        ) AS returnedItems

      FROM trynbuys t
      WHERE t.client_id = $1
      ORDER BY t.created_at DESC;
    `;

    const result = await pool.query(query, [clientId]);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching Trynbuy data:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
