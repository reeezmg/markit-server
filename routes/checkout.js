const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../authMiddleware');
const admin = require('../firebase');

module.exports = (io) => {
  const router = express.Router();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  router.use(authenticateToken);

  router.post('/trynbuy', async (req, res) => {
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
        locationId,
        cartItems,
        companyId,
      } = req.body;

      await client.query('BEGIN');

      // ✅ Insert Trynbuy order
      const trynbuyResult = await client.query(
        `
        INSERT INTO trynbuys (
          id, created_at, checkout_method, subtotal, product_discount, 
          total_discount, shipping, delivery_type, delivery_time, order_status, 
          location_id, client_id, company_id, packing_status
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
        ]
      );

      const trynbuy = trynbuyResult.rows[0];

      // ✅ Insert Cart Items & reduce stock
      if (Array.isArray(cartItems) && cartItems.length > 0) {
        const insertCartItemQuery = `
          INSERT INTO trynbuy_cart_items (id, trynbuy_id, variant_id, item_id, quantity)
          VALUES (gen_random_uuid(), $1, $2, $3, $4)
        `;

        for (const item of cartItems) {
          const matchedItem = item.items.find((i) => i.size === item.selectedSize);
          if (!matchedItem) {
            console.warn(`No matching item for variant ${item.id} with size ${item.selectedSize}`);
            continue;
          }

          await client.query(insertCartItemQuery, [
            trynbuy.id,
            item.id,
            matchedItem.id,
            item.quantity,
          ]);

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
      }

      await client.query('COMMIT');
      console.log('✅ Trynbuy created with ID:', trynbuy.id);

      // 🔔 Socket event
      io.to(`company:${trynbuy.company_id}`).emit('checkout:success', {
        trynbuyId: trynbuy.id,
        companyId: trynbuy.company_id,
        clientId: trynbuy.client_id,
        orderStatus: trynbuy.order_status,
      });

      // ✅ Push Notifications: send to all users of this company
      const { rows: tokens } = await pool.query(
        `
        SELECT pt.token
        FROM cap_push_token pt
        JOIN users u ON pt.user_id = u.id
        WHERE u.company_id = $1
        `,
        [trynbuy.company_id]
      );

      if (tokens.length > 0) {
        const message = {
          notification: {
            title: 'New Checkout',
            body: `Order ${trynbuy.id} placed`,
          },
          android: {
            notification: { sound: 'alert.wav' },
          },
          apns: {
            payload: {
              aps: {
                sound: 'alert.caf',
              },
            },
          },
          tokens: tokens.map((t) => t.token),
        };

        admin.messaging().sendMulticast(message)
          .then((response) => {
            console.log('📲 Push sent:', response.successCount, '/', tokens.length);
          })
          .catch((err) => {
            console.error('❌ Error sending push:', err);
          });
      } else {
        console.log('⚠️ No device tokens found for company:', trynbuy.company_id);
      }

      res.status(201).json({
        message: 'Trynbuy created successfully',
        trynbuy,
      });
    } catch (error) {
      await client.query('ROLLBACK');

      if (error.type === 'INSUFFICIENT_STOCK') {
        return res.status(400).json({
          error:
            error.qty === 0
              ? `No stock is available for ${error.itemName} of size ${error.size}. Please remove it.`
              : `Only ${error.qty} stock is available for ${error.itemName} of size ${error.size}.`,
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
