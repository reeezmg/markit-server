const express = require('express');
const prisma = require('../prisma/prisma'); // Adjust path as needed
const router = express.Router();
const authenticateToken = require('../authMiddleware');


// ✅ Protect all routes with authenticateToken
router.use(authenticateToken);

// GET all addresses for logged-in client
router.get("/", async (req, res) => {
  try {
    const clientId = req.user.clientId; // from JWT payload
    const addresses = await prisma.address.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      select:{
        id:true,
        name:true,
        formattedAddress:true,
        houseDetails:true,
        landmark:true,
        type:true,
        lat:true,
        lng:true,
        active:true,
        clientId:true,
      }
    });
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch addresses", details: error });
  }
});

// CREATE new address
router.post("/", async (req, res) => {
  console.log("Creating address with data:", req.body);
  try {
    const clientId = req.user.clientId; // from JWT payload
    const { name, formattedAddress, houseDetails, landmark, type, lat, lng, active } = req.body;

    const address = await prisma.address.create({
      data: {
        clientId,
        name,
        formattedAddress,
        houseDetails,
        landmark,
        type,
        lat,
        lng,
        active: active ?? true,
      },
    });
    console.log(address);
    res.status(201).json(address);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Failed to create address", details: error });
  }
});

// UPDATE address (client can only update their own)
router.put("/:id", async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const id = req.params.id;
    const { name, formattedAddress, houseDetails, landmark, type, lat, lng } = req.body;

    const address = await prisma.address.updateMany({
      where: { clientId, id },
      data: {
         clientId,
        name,
        formattedAddress,
        houseDetails,
        landmark,
        type,
        lat,
        lng,
       },
    });

    if (address.count === 0) {
      return res.status(404).json({ error: "Address not found or client mismatch" });
    }

    res.json({ message: "Address updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update address", details: error });
  }
});

// DELETE address (client can only delete their own)
router.delete("/:id", async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const id = req.params.id;

    const address = await prisma.address.deleteMany({
      where: { clientId, id },
    });

    if (address.count === 0) {
      return res.status(404).json({ error: "Address not found or client mismatch" });
    }

    res.json({ message: "Address deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete address", details: error });
  }
});

module.exports = router;
