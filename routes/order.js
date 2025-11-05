const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../authMiddleware');
const { sendNotification } = require('../sendNotification');
const { getTokens } = require('../getTokens');


module.exports = (io) => {
  const router = express.Router();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

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

    await client.query('BEGIN');

    const createdOrders = [];

    for (const group of groups) {
      for (const company of group.companies) {
        const companyId = company.companyId;
        const cartItems = company.items;

        // ✅ Insert Trynbuy order for each company
        const trynbuyResult = await client.query(
          `
          INSERT INTO trynbuys (
            id, created_at, checkout_method, subtotal, product_discount, 
            total_discount, shipping, delivery_type, delivery_time, order_status, 
            location_id, client_id, company_id, packing_status,waiting_fee, waiting_time
          )
          VALUES (
            gen_random_uuid(), NOW(), $1, $2, $3, 
            $4, $5, $6, $7, $8, 
            $9, $10, $11, 'pending'
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
            companyId,
            waitingFee,
            waitingTime
          ]
        );

        const trynbuy = trynbuyResult.rows[0];
        createdOrders.push(trynbuy);

        // ✅ Insert Cart Items
        const insertCartItemQuery = `
          INSERT INTO trynbuy_cart_items (id, trynbuy_id, variant_id, item_id, quantity)
          VALUES (gen_random_uuid(), $1, $2, $3, $4)
        `;

        for (const item of cartItems) {
          const matchedItem = item.items.find((i) => i.size === item.selectedSize);
          if (!matchedItem) continue;

          await client.query(insertCartItemQuery, [
            trynbuy.id,
            item.id,
            matchedItem.id,
            item.quantity,
          ]);

          // ✅ Decrement stock
          const updateResult = await client.query(
            `
            UPDATE items
            SET qty = qty - $1
            WHERE id = $2 AND qty >= $1
            RETURNING id, qty
            `,
            [item.quantity, matchedItem.id]
          );

          if (updateResult.rowCount === 0) {
            throw {
              type: 'INSUFFICIENT_STOCK',
              itemName: `${item.productName}-${item.name}`,
              size: item.selectedSize,
              qty: matchedItem.qty,
            };
          }
        }

        // 🔔 Notify company via socket + push
  

          io.to(`company:${companyId}`).emit('checkout:success', {
        trynbuyId: trynbuy.id,
        companyId: companyId,
        clientId: trynbuy.clientId,
        orderStatus: trynbuy.orderStatus,
      });

        const resTokens = await getTokens(companyId);
      console.log(resTokens);
     sendNotification(resTokens.tokens, 'New Trynbuy Order', `Order No ${trynbuy.order_number}`, '/order/trynbuy');
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Trynbuy orders created successfully',
      orders: createdOrders,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.type === 'INSUFFICIENT_STOCK') {
      return res.status(400).json({
        error:
          error.qty === 0
            ? `No stock available for ${error.itemName} (size ${error.size}).`
            : `Only ${error.qty} left for ${error.itemName} (size ${error.size}).`,
      });
    }

    console.error('❌ Error creating trynbuy:', error);
    res.status(500).json({ error: 'Failed to create trynbuy' });
  } finally {
    client.release();
  }
});


  return router;
};
