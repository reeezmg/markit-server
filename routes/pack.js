const express = require('express');
const { Pool } = require('pg');

module.exports = (io) => {
  const router = express.Router();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });


  // ---------------- GET specific Try & Buy ----------------
  router.get("/:id/:clientid", async (req, res) => {
    const clientId = req.params.clientid;
    const trynbuyId = req.params.id;
    console.log(`Fetching Try & Buy ID: ${trynbuyId} for Client ID: ${clientId}`);
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
            'quantity', tci.quantity,
            'itemId', i.id,
            'barcode', i.barcode,
            'tax', v.tax,
            'categoryId', p.category_id
          )
        )
        FROM trynbuy_cart_items tci
        JOIN variants v ON tci.variant_id = v.id
        JOIN items i ON tci.item_id = i.id
        JOIN products p ON v.product_id = p.id
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
            'quantity', tri.quantity,
            'itemId', i.id,
            'barcode', i.barcode,
            'tax', v.tax,
            'categoryId', p.category_id
          )
        )
        FROM trynbuy_returned_items tri
        JOIN variants v ON tri.variant_id = v.id
        JOIN items i ON tri.item_id = i.id
        JOIN products p ON v.product_id = p.id
        WHERE tri.trynbuy_id = t.id
      ), '[]'::json
    ) AS returnedItems
  FROM trynbuys t
  JOIN companies c ON t.company_id = c.id
  WHERE t.client_id = $1 AND t.id = $2
  LIMIT 1;
`;

      const result = await pool.query(query, [clientId, trynbuyId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Try & Buy not found" });
      }

      const trynbuyData = result.rows[0];

      // ✅ Emit data to the client socket room
      io.to(`client:${clientId}`).emit('trynbuyUpdate', trynbuyData);

      res.json(trynbuyData);
    } catch (err) {
      console.error("Error fetching Trynbuy data:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  return router;
};
