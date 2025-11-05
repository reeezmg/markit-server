const express = require('express');
const { Pool } = require('pg');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const authenticateToken = require('../authMiddleware');

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

    const billId = uuidv4();

    await client.query('BEGIN');

    // 🧩 Step 0️⃣ Fetch company's billCounter
    const companyQuery = `SELECT bill_counter FROM companies WHERE id = $1 FOR UPDATE`;
    const companyRes = await client.query(companyQuery, [companyId]);

    if (companyRes.rows.length === 0) {
      throw new Error('Company not found');
    }

    const currentBillCounter = companyRes.rows[0].bill_counter || 1;

    // 🧩 Step 1️⃣ Create Bill using billCounter as invoice_number
    const billInsert = `
      INSERT INTO bills (
        id, created_at, updated_at, invoice_number, subtotal, grand_total, discount,
        delivery_fee, payment_method, payment_status,
        transaction_id, company_id, client_id, trynbuy_id, waiting_fee, is_markit
      )
      VALUES (
        $1, NOW(), NOW(), $2, $3, $4, $5,
        $6, $7, 'PAID',
        $8, $9, $10, $11, $12, true
      )
      RETURNING id
    `;

    const billResult = await client.query(billInsert, [
      billId,              // $1
      currentBillCounter,  // $2 - invoice_number
      subtotal,            // $3
      grandTotal,          // $4
      0,            // $5
      deliveryFees,        // $6
      paymentMethod,       // $7
      transactionId,       // $8
      companyId,           // $9
      clientId,            // $10
      trynbuyId,           // $11
      waitingFee,        // $12
    ]);

    // 🧩 Step 2️⃣ Create Entries for Kept Items
    for (const item of keptItems) {
        console.log('Kept item:', item);
      const entryInsert = `
        INSERT INTO entries (
          id, name, qty, rate, discount, tax, value,
          size, variant_id, item_id, company_id, bill_id, return,barcode,category_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false,$13,$14)
      `;
      await client.query(entryInsert, [
        uuidv4(),
        item.name,
        item.quantity,
        item.s_price,
        -((item.s_price - item.d_price) * item.quantity),
        item.tax,
        item.d_price * item.quantity,
        item.size,
        item.id,         // variant_id
        item.itemId,     // item_id
        companyId,
        billId,
        item.barcode,
        item.categoryId
      ]);
    }

    // 🧩 Step 3️⃣ Returned Items → Add entries + trynbuy_returned_items + stock update
    for (const item of returnedItems) {
      // (a) entry with return=true
      const entryInsert = `
        INSERT INTO entries (
          id, name, qty, rate, discount, tax, value,
          size, variant_id, item_id, company_id, bill_id, return
        )
        VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7, $8, $9, $10, true)
      `;
      await client.query(entryInsert, [
        uuidv4(),
        item.name,
        item.quantity,
        item.d_price,
        item.d_price * item.quantity,
        item.size,
        item.id,         // variant_id
        item.itemId,     // item_id
        companyId,
        billId,
      ]);

      // (b) Add record to trynbuy_returned_items
      const returnedInsert = `
        INSERT INTO trynbuy_returned_items (id, trynbuy_id, variant_id, item_id, quantity)
        VALUES ($1, $2, $3, $4, $5)
      `;
      await client.query(returnedInsert, [
        uuidv4(),
        trynbuyId,
        item.id,
        item.itemId,
        item.quantity,
      ]);

      // (c) Increase qty in items table
      const updateQty = `UPDATE items SET qty = qty + $1 WHERE id = $2`;
      await client.query(updateQty, [item.quantity, item.itemId]);
    }

    // 🧩 Step 4️⃣ Update Trynbuy → PAID + link to bill
    await client.query(
      `UPDATE trynbuys SET order_status = 'PAID' WHERE id = $1`,
      [trynbuyId]
    );

    // 🧩 Step 5️⃣ Increment company's billCounter
    await client.query(
      `UPDATE companies SET bill_counter = bill_counter + 1 WHERE id = $1`,
      [companyId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
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

module.exports = router;
