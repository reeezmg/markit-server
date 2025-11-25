const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../authMiddleware');
const { sendNotification } = require('../sendNotification');
const { getTokens } = require('../getTokens');

module.exports = (io) => {
  const router = express.Router();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  router.use(authenticateToken);

  router.post('/trynbuy', async (req, res) => {
    console.log('🚀 Received Trynbuy creation request:', JSON.stringify(req.body));
    const client = await pool.connect();
    const authClientId = req.user.clientId;

    try {
      const {
        checkoutMethod,
        subtotal,
        productDiscount,
        totalDiscount,
        shipping,
        deliveryType,
        deliveryTime,
        waitingTime,
        waitingFee,
        locationId,
        groups,
      } = req.body;

      if (!groups?.length) {
        return res.status(400).json({ error: 'Missing groups in request' });
      }

      console.log(deliveryTime)

      await client.query('BEGIN');
      let createdTrynbuyId = null;
      const notifyJobs = [];

      for (const group of groups) {
        // Create Trynbuy
        const trynbuyResult = await client.query(
          `
          INSERT INTO trynbuys (
            id, created_at, checkout_method, subtotal, product_discount,
            total_discount, shipping, delivery_type, delivery_time, order_status,
            location_id, client_id, packing_status, waiting_fee, waiting_time
          )
          VALUES (
            gen_random_uuid(), NOW(), $1, $2, $3,
            $4, $5, $6, $7, $8,
            $9, $10, 'ordered', $11, $12
          )
          RETURNING *;
          `,
          [
            checkoutMethod,
            subtotal,
            productDiscount,
            totalDiscount,
            shipping,
            deliveryType,
            deliveryTime,
            deliveryType === 'instant' ? 'ORDER_RECEIVED' : 'ORDER_SCHEDULED',
            locationId || null,
            authClientId,
            waitingFee,
            waitingTime,
          ]
        );

        const trynbuy = trynbuyResult.rows[0];
        createdTrynbuyId = trynbuy.id;

        for (const company of group.companies) {
          // Link company
          await client.query(
            `INSERT INTO _try_n_buy_company ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [company.companyId, trynbuy.id]
          );

          // Link company location if exists
          if (company.companyLocationId) {
            await client.query(
              `INSERT INTO _try_n_buy_company_locations ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [company.companyLocationId, trynbuy.id]
            );
          }

          // Add cart items
          for (const item of company.items) {
            const matchedItem = item.items.find((i) => i.size === item.selectedSize);
            if (!matchedItem) continue;

            await client.query(
              `
              INSERT INTO trynbuy_cart_items (
                id, trynbuy_id, variant_id, item_id, quantity, status
              )
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ORDER_RECEIVED')
              `,
              [trynbuy.id, item.id, matchedItem.id, item.quantity]
            );

            await client.query(
              `
              UPDATE items
              SET qty = qty - $1
              WHERE id = $2 AND qty >= $1
              RETURNING id;
              `,
              [item.quantity, matchedItem.id]
            );
          }

          notifyJobs.push({ companyId: company.companyId, trynbuy });
        }
      }

      await client.query('COMMIT');

      // ✅ Refetch enriched Trynbuy
      const trynbuyId = createdTrynbuyId;
      const clientId = authClientId;

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
      const trynbuy = trynbuyResult.rows[0];

      // ✅ Fetch cart + returned items by company
      const companyItemsQuery = `
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
          COALESCE(tci.status, 'PENDING') AS status
        FROM trynbuy_cart_items tci
        JOIN variants v ON v.id = tci.variant_id
        JOIN items i ON i.id = tci.item_id
        JOIN products p ON p.id = v.product_id
        JOIN companies c ON c.id = p.company_id
        WHERE tci.trynbuy_id = $1
        ORDER BY c.name;
      `;
      const cartResults = await pool.query(companyItemsQuery, [trynbuyId]);

      const returnItemsQuery = `
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
          tri.quantity
        FROM trynbuy_returned_items tri
        JOIN variants v ON v.id = tri.variant_id
        JOIN items i ON i.id = tri.item_id
        JOIN products p ON p.id = v.product_id
        JOIN companies c ON c.id = p.company_id
        WHERE tri.trynbuy_id = $1
        ORDER BY c.name;
      `;
      const returnedResults = await pool.query(returnItemsQuery, [trynbuyId]);

      // ✅ Group both cart and return items by company
      const companiesMap = {};

      // group cart items
      for (const row of cartResults.rows) {
        if (!companiesMap[row.company_id]) {
          companiesMap[row.company_id] = {
            id: row.company_id,
            name: row.company_name,
            logo: row.company_logo,
            cartitems: [],
            returneditems: [],
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

      // group returned items
      for (const row of returnedResults.rows) {
        if (!companiesMap[row.company_id]) {
          companiesMap[row.company_id] = {
            id: row.company_id,
            name: row.company_name,
            logo: row.company_logo,
            cartitems: [],
            returneditems: [],
          };
        }
        companiesMap[row.company_id].returneditems.push({
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
        });
      }

      const companies = Object.values(companiesMap);

      // ✅ Final structured response
      const trynbuyData = {
        ...trynbuy,
        companies,
      };

      // 🔔 Emit + notify asynchronously
      await Promise.allSettled(
        notifyJobs.map(async (job) => {
          io.to(`company:${job.companyId}`).emit('checkout:success', {
            trynbuyId,
            companyId: job.companyId,
            clientId,
            orderStatus: trynbuy.order_status,
          });

          const resTokens = await getTokens(job.companyId);
          if (resTokens?.tokens?.length) {
            await sendNotification(
              resTokens.tokens,
              'New Trynbuy Order',
              `Order No ${trynbuy.order_number}`,
              '/order/trynbuy'
            );
          }
        })
      );

      res.status(201).json({
        message: 'Trynbuy created successfully',
        trynbuy: trynbuyData,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating Trynbuy:', error);
      res.status(500).json({ error: 'Failed to create Trynbuy' });
    } finally {
      client.release();
    }
  });

  return router;
};
