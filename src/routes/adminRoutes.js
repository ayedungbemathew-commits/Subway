const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const {
  listUsers,
  getUser,
  updateUserStatus,
  updateUserRole,
  listTransactions,
  listPayments,
  adjustWallet,
  getAuditLog,
} = require("../controllers/adminController");

const router = express.Router();

// Every admin route requires auth + ADMIN or SUPER_ADMIN role.
router.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/users", listUsers);
router.get("/users/:id", getUser);
router.patch("/users/:id/status", updateUserStatus);
router.patch("/users/:id/role", updateUserRole);

router.get("/transactions", listTransactions);
router.get("/payments", listPayments);

router.post("/users/:id/wallet/adjust", adjustWallet);

router.get("/audit-log", getAuditLog);

module.exports = router;