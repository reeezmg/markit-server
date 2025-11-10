const express = require('express');
const { Pool } = require('pg');
const authenticateToken = require('../../authMiddleware');
const router = express.Router();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

router.use(authenticateToken);

// Helper function to generate date filters
const getDateFilter = (period) => {
    const now = new Date();
    switch (period) {
        case 'day':
            return `DATE(t.created_at) = CURRENT_DATE`;
        case 'week':
            return `DATE_TRUNC('week', t.created_at) = DATE_TRUNC('week', CURRENT_DATE)`;
        case 'month':
            return `DATE_TRUNC('month', t.created_at) = DATE_TRUNC('month', CURRENT_DATE)`;
        case 'year':
            return `DATE_TRUNC('year', t.created_at) = DATE_TRUNC('year', CURRENT_DATE)`;
        default:
            return null;
    }
};

/**
 * GET /api/delivery/earnings/:period
 * Get earnings for specified period (day/week/month/year)
 */
router.get('/:period', async (req, res) => {
    const { period } = req.params;
    const partnerId = req.user.deliveryPartnerId;

    const dateFilter = getDateFilter(period);
    if (!dateFilter) {
        return res.status(400).json({ error: 'Invalid period. Use day, week, month, or year' });
    }

    try {
        const query = `
            SELECT 
                COUNT(t.id) as total_deliveries,
                COALESCE(SUM(CAST(dpe."deliverFees" AS FLOAT)), 0) as total_delivery_fees,
                COALESCE(SUM(CAST(dpe."waitingFees" AS FLOAT)), 0) as total_waiting_fees,
                COALESCE(SUM(CAST(dpe.tips AS FLOAT)), 0) as total_tips,
                COALESCE(SUM(CAST(dpe.surge AS FLOAT)), 0) as total_surge,
                COALESCE(SUM(dpe.distance), 0) as total_distance,
                COALESCE(SUM(dpe.waiting_time), 0) as total_waiting_time,
                COALESCE(SUM(
                    CAST(dpe."deliverFees" AS FLOAT) + 
                    CAST(dpe."waitingFees" AS FLOAT) + 
                    CAST(dpe.tips AS FLOAT) + 
                    CAST(dpe.surge AS FLOAT)
                ), 0) as total_earnings
            FROM trynbuys t
            LEFT JOIN delivery_partner_earnings dpe ON t.id = dpe.trynbuy_id
            WHERE t.delivery_partner_id = $1
            AND ${dateFilter}
        `;

        const { rows } = await pool.query(query, [partnerId]);

        const stats = rows[0];
        stats.period = period;

        res.json(stats);
    } catch (err) {
        console.error('Error fetching earnings:', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

/**
 * GET /api/delivery/earnings/:period/details
 * Get detailed earnings breakdown with individual orders
 */
router.get('/:period/details', async (req, res) => {
    const { period } = req.params;
    const partnerId = req.user.deliveryPartnerId;

    const dateFilter = getDateFilter(period);
    if (!dateFilter) {
        return res.status(400).json({ error: 'Invalid period. Use day, week, month, or year' });
    }

    try {
        const query = `
            SELECT 
                t.id,
                t.created_at,
                t.order_status,
                CAST(dpe."deliverFees" AS FLOAT) as delivery_fees,
                CAST(dpe."waitingFees" AS FLOAT) as waiting_fees,
                CAST(dpe.tips AS FLOAT) as tips,
                CAST(dpe.surge AS FLOAT) as surge,
                dpe.distance,
                dpe.waiting_time
            FROM trynbuys t
            LEFT JOIN delivery_partner_earnings dpe ON t.id = dpe.trynbuy_id
            WHERE t.delivery_partner_id = $1
            AND ${dateFilter}
            ORDER BY t.created_at DESC
        `;

        const { rows } = await pool.query(query, [partnerId]);
        res.json({
            period,
            orders: rows
        });
    } catch (err) {
        console.error('Error fetching earnings details:', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

module.exports = router;
