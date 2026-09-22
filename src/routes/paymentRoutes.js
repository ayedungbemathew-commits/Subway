const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { initialize, getStatus, verify } = require("../controllers/paymentController");

const router = express.Router();

router.post("/initialize", requireAuth, initialize);
router.get("/:reference", requireAuth, getStatus);
router.post("/:reference/verify", requireAuth, verify);

module.exports = router;