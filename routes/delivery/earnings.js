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
    switch (period) {
        case 'today':
            return `DATE(t.delivery_time) = CURRENT_DATE`;
        case 'week':
            return `DATE_TRUNC('week', t.delivery_time) = DATE_TRUNC('week', CURRENT_DATE)`;
        case 'lastWeek':
            return `DATE_TRUNC('week', t.delivery_time) = DATE_TRUNC('week', CURRENT_DATE - INTERVAL '1 week')`;
        case 'month':
            return `DATE_TRUNC('month', t.delivery_time) = DATE_TRUNC('month', CURRENT_DATE)`;
        case 'year':
            return `DATE_TRUNC('year', t.delivery_time) = DATE_TRUNC('year', CURRENT_DATE)`;
        default:
            return null;
    }
};

/**
 * GET /api/delivery/earnings/:period
 * Summary earnings for day/week/lastweek/month/year
 */
router.get('/:period', async (req, res) => {
    const { period } = req.params;
    const partnerId = req.user.deliveryPartnerId;

    const dateFilter = getDateFilter(period);
    if (!dateFilter) {
        return res.status(400).json({ error: 'Invalid period. Use day, week, lastWeek, month, or year' });
    }

    try {
        const query = `
            SELECT 
                COUNT(t.id) as total_deliveries,
                COALESCE(SUM(CAST(dpe."deliverFees" AS FLOAT)), 0) AS total_delivery_fees,
                COALESCE(SUM(CAST(dpe."waitingFees" AS FLOAT)), 0) AS total_waiting_fees,
                COALESCE(SUM(CAST(dpe.tips AS FLOAT)), 0) AS total_tips,
                COALESCE(SUM(CAST(dpe.surge AS FLOAT)), 0) AS total_surge,
                COALESCE(SUM(dpe.distance), 0) AS total_distance,
                COALESCE(SUM(dpe.waiting_time), 0) AS total_waiting_time,

                -- FIXED total earnings
                COALESCE(SUM(
                    COALESCE(CAST(dpe."deliverFees" AS FLOAT), 0) +
                    COALESCE(CAST(dpe."waitingFees" AS FLOAT), 0) +
                    COALESCE(CAST(dpe.tips AS FLOAT), 0) +
                    COALESCE(CAST(dpe.surge AS FLOAT), 0)
                ), 0) AS total_earnings

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
        console.error('Error fetching earnings:', err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

/**
 * GET /api/delivery/earnings/:period/details
 * Detailed list of all orders + summary totals
 */
router.get('/:period/details', async (req, res) => {
    const { period } = req.params;
    const partnerId = req.user.deliveryPartnerId;

    const dateFilter = getDateFilter(period);
    if (!dateFilter) {
        return res.status(400).json({ error: 'Invalid period. Use day, week, lastweek, month, or year' });
    }

    try {
        // ---------- SUMMARY QUERY ----------
        const summaryQuery = `
            SELECT 
                COUNT(t.id) AS total_deliveries,
                COALESCE(SUM(CAST(dpe."deliverFees" AS FLOAT)), 0) AS total_delivery_fees,
                COALESCE(SUM(CAST(dpe."waitingFees" AS FLOAT)), 0) AS total_waiting_fees,
                COALESCE(SUM(CAST(dpe.tips AS FLOAT)), 0) AS total_tips,
                COALESCE(SUM(CAST(dpe.surge AS FLOAT)), 0) AS total_surge,
                COALESCE(SUM(dpe.distance), 0) AS total_distance,
                COALESCE(SUM(dpe.waiting_time), 0) AS total_waiting_time,
                COALESCE(SUM(
                    COALESCE(CAST(dpe."deliverFees" AS FLOAT), 0) +
                    COALESCE(CAST(dpe."waitingFees" AS FLOAT), 0) +
                    COALESCE(CAST(dpe.tips AS FLOAT), 0) +
                    COALESCE(CAST(dpe.surge AS FLOAT), 0)
                ), 0) AS total_earnings
            FROM trynbuys t
            LEFT JOIN delivery_partner_earnings dpe ON t.id = dpe.trynbuy_id
            WHERE t.delivery_partner_id = $1
            AND ${dateFilter}
        `;

        const summaryResult = await pool.query(summaryQuery, [partnerId]);
        const summary = summaryResult.rows[0];

        // ---------- DETAILS QUERY ----------
        const detailsQuery = `
            SELECT 
                t.id,
                t.delivery_time,
                t.order_status,
                t.order_number,
                COALESCE(CAST(dpe."deliverFees" AS FLOAT), 0) AS delivery_fees,
                COALESCE(CAST(dpe."waitingFees" AS FLOAT), 0) AS waiting_fees,
                COALESCE(CAST(dpe.tips AS FLOAT), 0) AS tips,
                COALESCE(CAST(dpe.surge AS FLOAT), 0) AS surge,
                dpe.distance,
                dpe.waiting_time,
                (
                    COALESCE(CAST(dpe."deliverFees" AS FLOAT), 0) +
                    COALESCE(CAST(dpe."waitingFees" AS FLOAT), 0) +
                    COALESCE(CAST(dpe.tips AS FLOAT), 0) +
                    COALESCE(CAST(dpe.surge AS FLOAT), 0)
                ) AS total_earnings
            FROM trynbuys t
            LEFT JOIN delivery_partner_earnings dpe ON t.id = dpe.trynbuy_id
            WHERE t.delivery_partner_id = $1
            AND ${dateFilter}
            ORDER BY t.delivery_time DESC
        `;

        const detailsResult = await pool.query(detailsQuery, [partnerId]);

        res.json({
            period,
            ...summary,   // spread summary totals here
            orders: detailsResult.rows
        });

    } catch (err) {
        console.error('Error fetching earnings details:', err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

module.exports = router;
