const express = require('express');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Base URL of your OSRM container
const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';

router.get('/', async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing lat or lng' });
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
    return res.status(400).json({ error: 'Invalid lat or lng' });
  }

  // --- Step 1: get all shops within 5 km (straight-line) ---
  const sql = `
    SELECT
      c.id, c.name, c.logo, c.category, c.description,
      c.storecode, c."store_unique_name" AS "storeUniqueName",
      c.currency, c.plan, c.gstin, c."upi_id" AS "upiId",
      a.id AS "addressId", a.name AS "addressName",
      a.street, a.locality, a.city, a.state, a.pincode,
      ST_X(a.coord::geometry) AS lng,
      ST_Y(a.coord::geometry) AS lat,
      ST_Distance(
        a.coord,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) AS air_distance
    FROM companies c
    JOIN addresses a ON a.company_id = c.id
    WHERE c.status = true
      AND a.coord IS NOT NULL
      AND ST_DWithin(
        a.coord,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        5000
      )
  `;

  try {
    const { rows } = await pool.query(sql, [lngNum, latNum]);
    if (!rows.length) return res.json([]);

    // --- Step 2: Check each with OSRM driving distance ---
    const roadChecked = await Promise.all(
      rows.map(async shop => {
        try {
          const osrmRes = await fetch(
            `${OSRM_URL}/route/v1/driving/${lngNum},${latNum};${shop.lng},${shop.lat}?overview=false`
          );
          const data = await osrmRes.json();

          if (data.code !== 'Ok' || !data.routes?.length) return null;

          const route = data.routes[0];
          const distance = route.distance; // meters
          const duration = route.duration; // seconds

          // Only keep shops within 5 km by road
          if (distance <= 5000) {
            return { ...shop, road_distance: distance, duration };
          }
          return null;
        } catch (e) {
          console.error(`OSRM fetch failed for shop ${shop.id}`, e.message);
          return null;
        }
      })
    );

    // --- Step 3: Filter valid ones ---
    const nearby = roadChecked.filter(Boolean);

    // --- Step 4: Sort by road distance ---
    nearby.sort((a, b) => a.road_distance - b.road_distance);
    console.log(nearby)
    res.json(nearby);
  } catch (err) {
    console.error('Error fetching nearby companies:', err);
    res.status(500).json({ error: 'Failed to fetch nearby shops' });
  }
});


/**
 * POST /nearby-route-shops
 * body: {
 *   home: { lat, lng },
 *   shops: [{ lat, lng }]
 * }
 */
router.post('/nearby-route-shops', async (req, res) => {
  const { home, shops } = req.body;
  console.log("Received /nearby-route-shops request:", { home, shops });

  if (!home?.lat || !home?.lng || !Array.isArray(shops) || shops.length === 0) {
    return res.status(400).json({ error: 'Missing home or shops array' });
  }

  try {
    const homeLat = parseFloat(home.lat);
    const homeLng = parseFloat(home.lng);

    // Combine cart shops + home as route points
    const routeCoords = [
      ...shops.map(s => `${s.lng},${s.lat}`),
      `${homeLng},${homeLat}`
    ].join(';');

    // Step 1: Get full OSRM route
    const osrmRes = await fetch(
      `${OSRM_URL}/route/v1/driving/${routeCoords}?overview=full&geometries=geojson`
    );
    const osrmData = await osrmRes.json();

    if (osrmData.code !== 'Ok') {
      console.error('OSRM route error:', osrmData.message);
      return res.status(500).json({ error: 'Failed to get route from OSRM' });
    }

    const coords = osrmData.routes[0].geometry.coordinates;

    // Step 2: Downsample coordinates every 500m
    const reducedCoords = [];
    let lastKept = coords[0];
    reducedCoords.push(lastKept);

    const haversine = (a, b) => {
      const R = 6371000;
      const toRad = deg => (deg * Math.PI) / 180;
      const dLat = toRad(b[1] - a[1]);
      const dLon = toRad(b[0] - a[0]);
      const lat1 = toRad(a[1]);
      const lat2 = toRad(b[1]);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
      return 2 * R * Math.asin(Math.sqrt(h));
    };

    for (let i = 1; i < coords.length; i++) {
      const dist = haversine(lastKept, coords[i]);
      if (dist >= 200) {
        reducedCoords.push(coords[i]);
        lastKept = coords[i];
      }
    }

    // Add final home coordinate
    const lastCoord = coords[coords.length - 1];
    if (JSON.stringify(reducedCoords[reducedCoords.length - 1]) !== JSON.stringify(lastCoord)) {
      reducedCoords.push(lastCoord);
    }

    const reducedRoute = {
      type: 'LineString',
      coordinates: reducedCoords,
    };

    // Step 3: Query nearby shops with full info like first API
      const sql = `
  SELECT
    c.id,
    c.name,
    c.logo,
    c.category,
    c.description,
    c.storecode,
    c."store_unique_name" AS "storeUniqueName",
    c.currency,
    c.plan,
    c.gstin,
    c."upi_id" AS "upiId",
    a.id AS "addressId",
    a.name AS "addressName",
    a.street,
    a.locality,
    a.city,
    a.state,
    a.pincode,
    ST_X(a.coord::geometry) AS lng,
    ST_Y(a.coord::geometry) AS lat,
    ST_Distance(a.coord::geography, route.geom::geography) AS air_distance
  FROM companies c
  JOIN addresses a ON a.company_id = c.id,
       (SELECT ST_GeomFromGeoJSON($1)::geometry AS geom) AS route
  WHERE c.status = true
    AND a.coord IS NOT NULL
    AND (
      ST_DWithin(a.coord::geography, route.geom::geography, 1000)
      OR EXISTS (
        SELECT 1
        FROM unnest($2::text[]) AS t(wkt)
        WHERE ST_DWithin(a.coord::geography, ST_GeomFromText(t, 4326)::geography, 1000)
      )
    )
  ORDER BY air_distance ASC;
`;


   const shopGeoms = shops.map(s => `POINT(${s.lng} ${s.lat})`);
const { rows } = await pool.query(sql, [JSON.stringify(reducedRoute), shopGeoms]);

    if (!rows.length) return res.json([]);

    // Step 4: Enrich with OSRM road distance + duration (like first API)
    const homeCoord = { lat: homeLat, lng: homeLng };
    const enriched = await Promise.all(
      rows.map(async shop => {
        try {
          const osrmRes = await fetch(
            `${OSRM_URL}/route/v1/driving/${homeCoord.lng},${homeCoord.lat};${shop.lng},${shop.lat}?overview=false`
          );
          const data = await osrmRes.json();

          if (data.code !== 'Ok' || !data.routes?.length)
            return { ...shop, road_distance: 0, duration: 0 };

          const route = data.routes[0];
          return {
            ...shop,
            road_distance: route.distance,
            duration: route.duration,
          };
        } catch (e) {
          console.error(`OSRM fetch failed for shop ${shop.id}`, e.message);
          return { ...shop, road_distance: 0, duration: 0 };
        }
      })
    );

    // Step 5: Sort by road distance
    enriched.sort((a, b) => a.road_distance - b.road_distance);

    res.json(enriched);
  } catch (err) {
    console.error('Error in /nearby-route-shops:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/by-category', async (req, res) => {
  const { lat, lng, category } = req.query;

  if (!lat || !lng || !category) {
    return res.status(400).json({
      error: 'lat, lng and category are required'
    });
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
    return res.status(400).json({ error: 'Invalid lat or lng' });
  }

  // 🔥 Extract parent category
  // casual_shirt → shirt
  // sports_shoes → shoes
  const normalized = category
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim();

  const parentCategory = normalized.split(' ').pop();

  const params = [lngNum, latNum, parentCategory];

  const sql = `
    SELECT
      c.id, c.name, c.logo, c.description,
      a.id AS "addressId",
      ST_X(a.coord::geometry) AS lng,
      ST_Y(a.coord::geometry) AS lat,
      ST_Distance(
        a.coord,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) AS air_distance
    FROM companies c
    JOIN addresses a ON a.company_id = c.id
    WHERE c.status = true
      AND a.coord IS NOT NULL
      AND ST_DWithin(
        a.coord,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        5000
      )
      AND EXISTS (
        SELECT 1
        FROM categories cat
        WHERE cat.company_id = c.id
          AND cat.name ILIKE '%' || $3 || '%'
      )
  `;

  try {
    const { rows } = await pool.query(sql, params);
    if (!rows.length) return res.json([]);

    // --- OSRM distance check ---
    const roadChecked = await Promise.all(
      rows.map(async shop => {
        try {
          const osrmRes = await fetch(
            `${OSRM_URL}/route/v1/driving/${lngNum},${latNum};${shop.lng},${shop.lat}?overview=false`
          );
          const data = await osrmRes.json();

          if (data.code !== 'Ok' || !data.routes?.length) return null;

          const route = data.routes[0];
          if (route.distance <= 5000) {
            return {
              ...shop,
              road_distance: route.distance,
              duration: route.duration
            };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    res.json(
      roadChecked
        .filter(Boolean)
        .sort((a, b) => a.road_distance - b.road_distance)
    );
  } catch (err) {
    console.error('Error fetching shops by category:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



router.get('/search', async (req, res) => {
  const { lat, lng, query } = req.query

  if (!lat || !lng || !query) {
    return res.status(400).json({ error: 'lat, lng and query are required' })
  }

  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)

  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
    return res.status(400).json({ error: 'Invalid lat or lng' })
  }

  const tokens = query
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)

  const params = [lngNum, latNum]

  const tokenConditions = tokens.map(token => {
    const idx = params.length + 1
    params.push(token)

    return `
      (
        GREATEST(
          similarity(c.name, $${idx}),
          similarity(cat.name, $${idx})
        ) > 0.2
        OR c.name ILIKE '%' || $${idx} || '%'
        OR cat.name ILIKE '%' || $${idx} || '%'
      )
    `
  })

  const sql = `
    SELECT DISTINCT
      c.id, c.name, c.logo, c.description,
      a.id AS "addressId",
      ST_X(a.coord::geometry) AS lng,
      ST_Y(a.coord::geometry) AS lat,
      ST_Distance(
        a.coord,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) AS air_distance,
      MAX(
        GREATEST(
          similarity(c.name, ${tokens.map((_, i) => `$${i + 3}`).join(', ')}),
          similarity(cat.name, ${tokens.map((_, i) => `$${i + 3}`).join(', ')} )
        )
      ) AS relevance
    FROM companies c
    JOIN addresses a ON a.company_id = c.id
    LEFT JOIN categories cat ON cat.company_id = c.id
    WHERE c.status = true
      AND ST_DWithin(
        a.coord,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        5000
      )
      AND (${tokenConditions.join(' AND ')})
    GROUP BY c.id, a.id
    ORDER BY relevance DESC, air_distance ASC
    LIMIT 30
  `

  try {
    const { rows } = await pool.query(sql, params)
    res.json(rows)
  } catch (err) {
    console.error('Search failed:', err)
    res.status(500).json({ error: 'Search failed' })
  }
})



module.exports = router;
