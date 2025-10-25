const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function getTokens(companyId) {
  const client = await pool.connect();
  try {
    if (!companyId) {
      return { success: false, message: 'Missing companyId' };
    }

    // 1. Get all admin userIds for the company
    const companyUsersResult = await client.query(
      `
      SELECT user_id 
      FROM company_users
      WHERE company_id = $1
        AND role = 'admin'
        AND deleted = false
      `,
      [companyId]
    );

    const userIds = companyUsersResult.rows.map((row) => row.user_id);

    if (!userIds.length) {
      return { success: false, message: 'No users in company' };
    }

    // 2. Get all tokens for those users
    const tokensResult = await client.query(
      `
      SELECT token
      FROM cap_push_token
      WHERE user_id = ANY($1::text[])
      `,
      [userIds]
    );

    const registrationTokens = tokensResult.rows.map((row) => row.token).filter(Boolean);

    if (!registrationTokens.length) {
      return { success: false, message: 'No devices to notify' };
    }

    return { success: true, tokens: registrationTokens };
  } catch (err) {
    console.error('Error fetching tokens:', err);
    return { success: false, message: 'Internal server error' };
  } finally {
    client.release();
  }
}

module.exports = { getTokens };
