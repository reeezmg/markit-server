const express = require('express');
const { Pool } = require('pg');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const authenticateToken = require('../authMiddleware');

module.exports = (io) => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  router.use(authenticateToken);

  router.post('/trynbuy/bill', async (req, res) => {
    const client = await pool.connect();
    const clientId = req.user.clientId;

    try {
      const {
        trynbuyId,
        companyId,
        paymentMethod,
        transactionId,
        subtotal,
        grandTotal,
        discount,
        deliveryFees,
        waitingFee,
        keptItems,
        returnedItems,
      } = req.body;

      await client.query('BEGIN');

      // 🟦 ALWAYS UPDATE kept items → status = KEPT
      for (const item of keptItems) {
        await client.query(
          `UPDATE trynbuy_cart_items
           SET status = 'KEPT'
           WHERE trynbuy_id = $1 AND item_id = $2`,
          [trynbuyId, item.itemId]
        );
      }

      // 🟥 ALWAYS UPDATE returned items → status = RETURNED
      for (const item of returnedItems) {

        // insert returned record
        await client.query(
          `INSERT INTO trynbuy_returned_items
           (id, trynbuy_id, variant_id, item_id, quantity, status)
           VALUES ($1, $2, $3, $4, $5, 'RETURNED')`,
          [uuidv4(), trynbuyId, item.id, item.itemId, item.quantity]
        );

        // restore stock
        await client.query(
          `UPDATE items SET qty = qty + $1 WHERE id = $2`,
          [item.quantity, item.itemId]
        );
      }

      // 🟨 CASE: NO BILL SHOULD BE CREATED
      if (!keptItems || keptItems.length === 0) {
        await client.query(
          `UPDATE trynbuys 
           SET order_status = 'COMPLETED', updated_at = NOW()
           WHERE id = $1`,
          [trynbuyId]
        );

        await client.query('COMMIT');

        return res.status(200).json({
          success: true,
          billCreated: false,
          message: 'All items returned. No bill generated.',
        });
      }

      // 🟩 CASE: CREATE BILL
      const billId = uuidv4();

      // lock company counter
      const companyRes = await client.query(
        `SELECT bill_counter FROM companies WHERE id = $1 FOR UPDATE`,
        [companyId]
      );

      if (companyRes.rows.length === 0) throw new Error('Company not found');

      const currentBillCounter = companyRes.rows[0].bill_counter || 1;

      // bill insert
      await client.query(
        `INSERT INTO bills (
          id, created_at, updated_at, invoice_number, subtotal, grand_total, discount,
          delivery_fee, payment_method, payment_status,
          transaction_id, company_id, client_id, trynbuy_id, waiting_fee, is_markit
        )
        VALUES (
          $1, NOW(), NOW(), $2, $3, $4, 0,
          $5, $6, 'PAID',
          $7, $8, $9, $10, $11, true
        )`,
        [
          billId,
          currentBillCounter,
          subtotal,
          grandTotal,
          deliveryFees,
          paymentMethod,
          transactionId,
          companyId,
          clientId,
          trynbuyId,
          waitingFee,
        ]
      );

      // entries for kept items
      for (const item of keptItems) {
        await client.query(
          `INSERT INTO entries (
            id, name, qty, rate, discount, tax, value,
            size, variant_id, item_id, company_id, bill_id, return, barcode, category_id
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14)`,
          [
            uuidv4(),
            item.name,
            item.quantity,
            item.s_price,
            -((item.s_price - item.d_price) * item.quantity),
            item.tax,
            item.d_price * item.quantity,
            item.size,
            item.id,
            item.itemId,
            companyId,
            billId,
            item.barcode,
            item.categoryId,
          ]
        );
      }

      // update trynbuy status
      await client.query(
        `UPDATE trynbuys
         SET order_status = 'PAID', updated_at = NOW()
         WHERE id = $1`,
        [trynbuyId]
      );

      // increment bill counter
      await client.query(
        `UPDATE companies SET bill_counter = bill_counter + 1 WHERE id = $1`,
        [companyId]
      );

      await client.query('COMMIT');

      // async notify
      io.to(`company:${companyId}`).emit('bill:success');

      res.json({
        success: true,
        billCreated: true,
        billId,
        invoiceNumber: currentBillCounter,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating bill:', error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      client.release();
    }
  });

  return router;
};
