// backend/routes/maps.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

router.get("/distance", async (req, res) => {
    console.log("here")
  try {
    const { origin, destination } = req.query;

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/distancematrix/json",
      {
        params: {
          origins: origin,
          destinations: destination,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch distance" });
  }
});

module.exports = router;
