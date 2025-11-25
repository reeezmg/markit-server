const express = require('express');
const { Pool } = require('pg');

module.exports = (io) => {
  const router = express.Router();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // ---------------- GET specific Try & Buy ----------------
  router.get('/:id/:clientid', async (req, res) => {
    const clientId = req.params.clientid;
    const trynbuyId = req.params.id;
    console.log(`📦 Fetching Try & Buy ID: ${trynbuyId} for Client ID: ${clientId}`);

    try {
      // 🔹 Fetch main Trynbuy info
      const mainQuery = `
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
          COALESCE(t.waiting_fee, 0) AS waiting_fee,
          COALESCE(t.waiting_time, 0) AS waiting_time
        FROM trynbuys t
        WHERE t.client_id = $1 AND t.id = $2
        LIMIT 1;
      `;

      const trynbuyResult = await pool.query(mainQuery, [clientId, trynbuyId]);
      if (trynbuyResult.rows.length === 0) {
        return res.status(404).json({ error: 'Try & Buy not found' });
      }
      const trynbuy = trynbuyResult.rows[0];

      // 🔹 Fetch companies and group their items
      const companyQuery = `
        SELECT
          c.id AS company_id,
          c.name AS company_name,
          c.logo AS company_logo,
          v.id AS variant_id,
          v.name AS variant_name,
          v.s_price,
          v.d_price,
          v.discount,
          v.images,
          p.name AS product_name,
          i.size,
          i.id AS item_id,
          i.barcode,
          tci.quantity,
          COALESCE(tci.status, 'PENDING') AS status  -- ✅ status column in trynbuy_cart_items
        FROM trynbuy_cart_items tci
        JOIN variants v ON v.id = tci.variant_id
        JOIN items i ON i.id = tci.item_id
        JOIN products p ON p.id = v.product_id
        JOIN companies c ON c.id = p.company_id
        WHERE tci.trynbuy_id = $1
        ORDER BY c.name;
      `;
      const companyResult = await pool.query(companyQuery, [trynbuyId]);

      // 🔹 Group items by company
      const companiesMap = {};
      for (const row of companyResult.rows) {
        if (!companiesMap[row.company_id]) {
          companiesMap[row.company_id] = {
            id: row.company_id,
            name: row.company_name,
            logo: row.company_logo,
            cartitems: [],
          };
        }
        companiesMap[row.company_id].cartitems.push({
          id: row.variant_id,
          name: row.variant_name,
          product_name: row.product_name,
          s_price: row.s_price,
          d_price: row.d_price,
          discount: row.discount,
          images: row.images,
          size: row.size,
          quantity: row.quantity,
          itemId: row.item_id,
          barcode: row.barcode,
          status: row.status,
        });
      }

      const companies = Object.values(companiesMap);

      // 🔹 Fetch returned items
      const returnedQuery = `
        SELECT
          v.id AS variant_id,
          v.name AS variant_name,
          p.name AS product_name,
          v.s_price,
          v.d_price,
          v.discount,
          v.images,
          i.size,
          i.barcode,
          tri.quantity
        FROM trynbuy_returned_items tri
        JOIN variants v ON v.id = tri.variant_id
        JOIN items i ON i.id = tri.item_id
        JOIN products p ON p.id = v.product_id
        WHERE tri.trynbuy_id = $1;
      `;
      const returnedResult = await pool.query(returnedQuery, [trynbuyId]);

      // ✅ Build final response
      const trynbuyData = {
        ...trynbuy,
        companies,
        returneditems: returnedResult.rows,
      };

      // 🔔 Emit to socket
      io.to(`client:${clientId}`).emit('trynbuyUpdate', trynbuyData);

      res.json(trynbuyData);
    } catch (err) {
      console.error('❌ Error fetching Trynbuy data:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  router.put('/trynbuy/:id/packing-status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // Validate request
  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  try {
    console.log(`🟢 Updating Trynbuy ${id} packing_status → ${status}`);

    // ✅ Run update query
  const query = `
  UPDATE trynbuys
  SET order_status = $1
  WHERE id = $2
  RETURNING id, order_status;
`;


    const result = await pool.query(query, [status, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Trynbuy not found' });
    }

    const updated = result.rows[0];

    console.log(`✅ Trynbuy ${id} packing_status updated to ${updated.packing_status}`);

    // ✅ Return response
    res.json({
      message: 'Packing status updated successfully',
      data: updated,
    });
  } catch (err) {
    console.error('❌ Error updating Trynbuy packing status:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

  return router;
};
