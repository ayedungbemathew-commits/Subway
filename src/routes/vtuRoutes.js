const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { buyAirtime, buyData, getTransactionByReference } = require("../controllers/vtuController");

const router = express.Router();

router.post("/airtime", requireAuth, buyAirtime);
router.post("/data", requireAuth, buyData);
router.get("/transactions/:reference", requireAuth, getTransactionByReference);

module.exports = router;