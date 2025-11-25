const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../../authMiddleware');
const router = express.Router();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

router.use(authenticateToken);

// Reusable query fragment for order details with joins
const ORDER_DETAILS_QUERY = `
    SELECT 
        dpe.*,
        dp.id   as delivery_partner_id,
        cl.id   as client_id,
        a.id    as address_id,
        t.*,
        json_build_object(
            'street', a.street,
            'locality', a.locality,
            'landmark', a.landmark,
            'city', a.city,
            'state', a.state,
            'pincode', a.pincode,
            'houseDetails', a.house_details,
            'formattedAddress', a.formatted_address,
            'lat', a.lat,
            'lng', a.lng
        ) as delivery_To,
(
    SELECT json_agg(
        json_build_object(
            'name', c.name,
            'phone', c.phone,
            'logo', c.logo,
            'storeUniqueName', c.store_unique_name,
            'street', ca.street,
            'locality', ca.locality,
            'landmark', ca.landmark,
            'city', ca.city,
            'state', ca.state,
            'pincode', ca.pincode,
            'lat', ca.lat,
            'lng', ca.lng,
            'formattedAddress', ca.formatted_address
        )
    )
    FROM _try_n_buy_company tbc
    LEFT JOIN companies c ON tbc."A" = c.id
    LEFT JOIN _try_n_buy_company_locations tbl ON tbl."B" = t.id
    LEFT JOIN addresses ca ON tbl."A" = ca.id
    WHERE tbc."B" = t.id
) as delivery_From,

        (
            SELECT json_agg(dpe2)
            FROM delivery_partner_earnings dpe2
            WHERE dpe2.trynbuy_id = t.id
        ) AS earnings_details,
         
        json_build_object(
            'name', dp.name,
            'phone', dp.phone,
            'profilePic', dp.profile_pic,
            'bloodGroup', dp.blood_group
        ) as delivery_Partner_Details,
        json_build_object(
            'name', cl.name,
            'phone', cl.phone
        ) as client_Details,
        (
            SELECT json_agg(
                json_build_object(
                    'id', tci.id,
                    'quantity', tci.quantity,
                    'variant', json_build_object(
                        'id', v.id,
                        'name', v.name,
                        'code', v.code,
                        'sprice', v.s_price,
                        'images', v.images
                    ),
                    'item', json_build_object(
                        'id', i.id,
                        'size', i.size,
                        'barcode', i.barcode
                    )
                )
            )
            FROM trynbuy_cart_items tci
            LEFT JOIN variants v ON tci.variant_id = v.id
            LEFT JOIN items i ON tci.item_id = i.id
            WHERE tci.trynbuy_id = t.id
        ) as cart_items,
        (
            SELECT json_agg(
                json_build_object(
                    'id', tri.id,
                    'quantity', tri.quantity,
                    'variant', json_build_object(
                        'id', v.id,
                        'name', v.name,
                        'code', v.code,
                        'sprice', v.s_price,
                        'images', v.images
                    ),
                    'item', json_build_object(
                        'id', i.id,
                        'size', i.size,
                        'barcode', i.barcode
                    )
                )
            )
            FROM trynbuy_returned_items tri
            LEFT JOIN variants v ON tri.variant_id = v.id
            LEFT JOIN items i ON tri.item_id = i.id
            WHERE tri.trynbuy_id = t.id
        ) as returned_items
    FROM trynbuys t
    LEFT JOIN delivery_partner_earnings dpe ON t.id = dpe.trynbuy_id
    LEFT JOIN addresses a ON t.location_id = a.id
    LEFT JOIN delivery_partners dp ON t.delivery_partner_id = dp.id
    LEFT JOIN clients cl ON t.client_id = cl.id
`;


/**
 * GET /api/delivery/orders
 * Get all trynbuy orders by delivery partner token Id
 */
router.get('/', async (req, res) => {
    const partnerId = req.user.deliveryPartnerId;
    try {
        const query = ORDER_DETAILS_QUERY + `
            WHERE t.delivery_partner_id = $1
            ORDER BY t.created_at DESC;
        `;
        const { rows } = await pool.query(query, [partnerId]);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching partner orders:', err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

/**
 * GET /api/delivery/orders/all
 * Get all trynbuy orders with delivery details
 */
router.get('/all', async (req, res) => {
    try {
        const query = ORDER_DETAILS_QUERY + `
            ORDER BY t.created_at DESC;
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching trynbuy orders:', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});


/**
 * GET /api/delivery/orders/filter
 * Filters orders by partner ID and/or delivery day
 */
router.get('/filter', async (req, res) => {
    const { partnerId, day } = req.query;

    try {
        let conditions = [];
        const params = [];
        let paramCount = 1;

        if (partnerId) {
            conditions.push(`t.delivery_partner_id = $${paramCount}`);
            params.push(partnerId);
            paramCount++;
        }

        if (day) {
            if (day.includes(':')) {
                conditions.push(`t.delivery_time::timestamp = $${paramCount}::timestamp`);
                params.push(day);
                paramCount++;
            } else {
                const startOfDay = `${day} 00:00:00`;
                const endOfDay = `${day} 23:59:59.999`;
                conditions.push(`t.delivery_time BETWEEN $${paramCount}::timestamp AND $${paramCount + 1}::timestamp`);
                params.push(startOfDay, endOfDay);
                paramCount += 2;
            }
        }

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

        const query = ORDER_DETAILS_QUERY + `
            ${whereClause}
            ORDER BY t.delivery_time DESC;
        `;

        const { rows } = await pool.query(query, params);

        res.json(rows);
    } catch (err) {
        console.error('Error fetching filtered orders:', err?.stack || err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

/**
 * GET /api/delivery/orders/latest
 * Get the most recent (latest) order
 */
router.get('/last-order', async (req, res) => {
    const partnerId = req.user.deliveryPartnerId;
    try {
        const query = ORDER_DETAILS_QUERY + `
        WHERE t.delivery_partner_id = $1
      ORDER BY t.delivery_time DESC
      LIMIT 1;
    `;

        const { rows } = await pool.query(query, [partnerId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No orders found' });
        }


        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching latest order:', err?.stack || err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

/**
 * GET /api/delivery/orders/:orderId
 * Get detailed information about a specific order
 */
router.get('/:orderId', async (req, res) => {
    const { orderId } = req.params;
    try {
        const query = ORDER_DETAILS_QUERY + `
            WHERE t.id = $1;
        `;
        const { rows } = await pool.query(query, [orderId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching order details:', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});


module.exports = router;