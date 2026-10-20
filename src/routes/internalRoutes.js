const express = require("express");
const crypto = require("crypto");
const { reconcileStuckTransactions } = require("../services/vtu");
const router = express.Router();
function secretMatches(provided, expected) {
  const a = crypto.createHash("sha256").update(String(provided)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}
// Called by an outside scheduler. Shut (503) unless RECONCILE_SECRET is set.
router.post("/reconcile", async (req, res) => {
  const expected = process.env.RECONCILE_SECRET;
  if (!expected) {
    return res.status(503).json({ error: "Not configured." });
  }
  const provided = req.get("x-reconcile-secret");
  if (!provided || !secretMatches(provided, expected)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  try {
    const summary = await reconcileStuckTransactions({ limit: 20 });
    return res.status(200).json(summary);
  } catch (error) {
    console.error("Scheduled reconcile failed:", error.message);
    return res.status(500).json({ error: "Reconcile failed." });
  }
});
module.exports = router;