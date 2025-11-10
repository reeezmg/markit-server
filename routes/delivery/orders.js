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
        ca.id   as company_address_id,
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
        ) as delivery_From,
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
    LEFT JOIN companies c ON t.company_id = c.id
    LEFT JOIN addresses ca ON c.id = ca.company_id
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
        console.error('Error fetching partner orders:', err && err.stack ? err.stack : err);
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

/**
 * POST /api/delivery/orders/filter
 * Filter orders by partner ID and/or date with all delivery details
 */
router.post('/filter', async (req, res) => {
    const { partnerId, day } = req.body;

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
            conditions.push(`DATE(t.created_at) = $${paramCount}`);
            params.push(day);
            paramCount++;
        }

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

        const query = ORDER_DETAILS_QUERY + `
            ${whereClause}
            ORDER BY t.created_at DESC;
        `;

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching filtered orders:', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

module.exports = router;