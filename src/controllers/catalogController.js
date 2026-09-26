const { z } = require("zod");
const { PrismaClient, Prisma } = require("@prisma/client");
const { parseId } = require("../utils/parseId");
const prisma = new PrismaClient();

async function logAdminAction(actorId, action, entity, entityId, oldValue, newValue) {
  await prisma.adminAuditLog.create({
    data: { actorId, action, entity, entityId: String(entityId), oldValue, newValue },
  });
}

// ---------- Networks ----------

async function listNetworks(req, res) {
  const networks = await prisma.network.findMany({ orderBy: { id: "asc" } });
  return res.status(200).json({ networks });
}

const networkSchema = z.object({
  name: z.string().min(1).max(191),
  code: z.string().min(1).max(191),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

async function createNetwork(req, res) {
  const parsed = networkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const network = await prisma.network.create({ data: parsed.data });
  await logAdminAction(req.user.id, "CREATE_NETWORK", "Network", network.id, null, network);
  return res.status(201).json({ network });
}

const networkUpdateSchema = networkSchema.partial();

async function updateNetwork(req, res) {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "Invalid network ID." });
  }

  const parsed = networkUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existing = await prisma.network.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "Network not found." });
  }

  const updated = await prisma.network.update({ where: { id }, data: parsed.data });
  await logAdminAction(req.user.id, "UPDATE_NETWORK", "Network", id, existing, updated);
  return res.status(200).json({ network: updated });
}

// ---------- Providers ----------

async function listProviders(req, res) {
  const providers = await prisma.provider.findMany({ orderBy: { priority: "asc" } });
  return res.status(200).json({ providers });
}

const providerSchema = z.object({
  name: z.string().min(1).max(191),
  code: z.string().min(1).max(191),
  baseUrl: z.string().url().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "MAINTENANCE"]).optional(),
  priority: z.number().int().min(1).optional(),
});

async function createProvider(req, res) {
  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const provider = await prisma.provider.create({ data: parsed.data });
  await logAdminAction(req.user.id, "CREATE_PROVIDER", "Provider", provider.id, null, provider);
  return res.status(201).json({ provider });
}

const providerUpdateSchema = providerSchema.partial();

async function updateProvider(req, res) {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "Invalid provider ID." });
  }

  const parsed = providerUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existing = await prisma.provider.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "Provider not found." });
  }

  const updated = await prisma.provider.update({ where: { id }, data: parsed.data });
  await logAdminAction(req.user.id, "UPDATE_PROVIDER", "Provider", id, existing, updated);
  return res.status(200).json({ provider: updated });
}

// ---------- Data Plans ----------

async function listDataPlans(req, res) {
  const networkId = req.query.networkId ? parseInt(req.query.networkId, 10) : undefined;
  const status = req.query.status;

  const where = {};
  if (networkId) where.networkId = networkId;
  if (status) where.status = status;

  const dataPlans = await prisma.dataPlan.findMany({
    where,
    orderBy: { id: "asc" },
    include: { network: true, provider: true },
  });
  return res.status(200).json({ dataPlans });
}

const dataPlanSchema = z.object({
  networkId: z.number().int().positive(),
  providerId: z.number().int().positive().optional(),
  providerPlanId: z.string().max(191).optional(),
  name: z.string().min(1).max(191),
  dataAmount: z.string().min(1).max(191),
  validity: z.string().max(191).optional(),
  providerCost: z.number().nonnegative(),
  sellingPrice: z.number().positive(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

async function createDataPlan(req, res) {
  const parsed = dataPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.sellingPrice < parsed.data.providerCost) {
    return res.status(400).json({ error: "Selling price is below provider cost." });
  }

  try {
    const dataPlan = await prisma.dataPlan.create({ data: parsed.data });
    await logAdminAction(req.user.id, "CREATE_DATA_PLAN", "DataPlan", dataPlan.id, null, dataPlan);
    return res.status(201).json({ dataPlan });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "A data plan with this network/provider/providerPlanId combination already exists." });
    }
    throw error;
  }
}

const dataPlanUpdateSchema = dataPlanSchema.partial();

async function updateDataPlan(req, res) {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "Invalid data plan ID." });
  }

  const parsed = dataPlanUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existing = await prisma.dataPlan.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "Data plan not found." });
  }

  const updated = await prisma.dataPlan.update({ where: { id }, data: parsed.data });
  await logAdminAction(req.user.id, "UPDATE_DATA_PLAN", "DataPlan", id, existing, updated);
  return res.status(200).json({ dataPlan: updated });
}

module.exports = {
  listNetworks,
  createNetwork,
  updateNetwork,
  listProviders,
  createProvider,
  updateProvider,
  listDataPlans,
  createDataPlan,
  updateDataPlan,
};