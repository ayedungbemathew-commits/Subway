const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getBalance, getTransactions } = require("../controllers/walletController");

const router = express.Router();

router.get("/balance", requireAuth, getBalance);
router.get("/transactions", requireAuth, getTransactions);

module.exports = router;