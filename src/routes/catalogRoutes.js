const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const {
  listNetworks,
  createNetwork,
  updateNetwork,
  listProviders,
  createProvider,
  updateProvider,
  listDataPlans,
  createDataPlan,
  updateDataPlan,
} = require("../controllers/catalogController");

const router = express.Router();

// Reading the catalog is public (a customer app needs to browse plans),
// but creating/editing requires admin auth.
router.get("/networks", listNetworks);
router.get("/providers", listProviders);
router.get("/data-plans", listDataPlans);

router.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

router.post("/networks", createNetwork);
router.patch("/networks/:id", updateNetwork);

router.post("/providers", createProvider);
router.patch("/providers/:id", updateProvider);

router.post("/data-plans", createDataPlan);
router.patch("/data-plans/:id", updateDataPlan);

module.exports = router;