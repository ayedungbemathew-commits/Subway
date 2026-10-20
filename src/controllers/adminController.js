const { z } = require("zod");
const { PrismaClient, Prisma } = require("@prisma/client");
const { parseId } = require("../utils/parseId");
const prisma = new PrismaClient();

async function logAdminAction(actorId, action, entity, entityId, oldValue, newValue) {
  await prisma.adminAuditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId: String(entityId),
      oldValue,
      newValue,
    },
  });
}

async function listUsers(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

  // Admin: search and status filter.
  const q = (req.query.q || "").toString().trim();
  const status = req.query.status;

  const where = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [{ email: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        wallet: { select: { balance: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return res.status(200).json({
    users,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

async function getUser(req, res) {
  const userId = parseId(req.params.id);
  if (userId === null) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phone: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      wallet: true,
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  return res.status(200).json({ user });
}

const updateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]),
});

async function updateUserStatus(req, res) {
  const userId = parseId(req.params.id);
  if (userId === null) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    return res.status(404).json({ error: "User not found." });
  }

  if (existing.id === req.user.id) {
    return res.status(403).json({ error: "You cannot change your own account status." });
  }
  if (existing.role !== "USER" && req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Only a super admin can change an admin account." });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: parsed.data.status },
  });

  await logAdminAction(
    req.user.id,
    "UPDATE_USER_STATUS",
    "User",
    userId,
    { status: existing.status },
    { status: updated.status }
  );

  return res.status(200).json({ user: { id: updated.id, status: updated.status } });
}

const updateRoleSchema = z.object({
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]),
});

async function updateUserRole(req, res) {
  const userId = parseId(req.params.id);
  if (userId === null) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Only a super admin can change roles." });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    return res.status(404).json({ error: "User not found." });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role: parsed.data.role },
  });

  await logAdminAction(
    req.user.id,
    "UPDATE_USER_ROLE",
    "User",
    userId,
    { role: existing.role },
    { role: updated.role }
  );

  return res.status(200).json({ user: { id: updated.id, role: updated.role } });
}

async function listTransactions(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const status = req.query.status;
  const type = req.query.type;
  const q = (req.query.q || "").toString().trim();

  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (q) {
    where.OR = [
      { reference: { contains: q } },
      { phoneNumber: { contains: q } },
      { user: { email: { contains: q } } },
    ];
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { walletTransaction: true, user: { select: { id: true, email: true } } },
    }),
    prisma.transaction.count({ where }),
  ]);

  return res.status(200).json({
    transactions,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

async function listPayments(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const status = req.query.status;

  const where = status ? { status } : {};

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { id: true, email: true } } },
    }),
    prisma.payment.count({ where }),
  ]);

  return res.status(200).json({
    payments,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

const manualAdjustmentSchema = z.object({
  amount: z.number().positive(),
  type: z.enum(["CREDIT", "DEBIT"]),
  reason: z.string().min(3).max(191),
});

async function adjustWallet(req, res) {
  const userId = parseId(req.params.id);
  if (userId === null) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  const parsed = manualAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { amount, type, reason } = parsed.data;

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  if (type === "DEBIT" && new Prisma.Decimal(wallet.balance).lt(amount)) {
    return res.status(422).json({ error: "Insufficient balance for this debit." });
  }

  const { creditWallet, debitWallet } = require("../services/wallet");
  const fn = type === "CREDIT" ? creditWallet : debitWallet;
  const reference = `ADMIN-ADJUST-${Date.now()}-${userId}-${require("crypto").randomBytes(3).toString("hex")}`;

  const result = await fn({
    userId,
    amount,
    reference,
    description: `Admin adjustment by ${req.user.email || req.user.id}: ${reason}`,
    type: type === "CREDIT" ? "CREDIT" : undefined,
  });

  await logAdminAction(
    req.user.id,
    "MANUAL_WALLET_ADJUSTMENT",
    "Wallet",
    wallet.id,
    { balance: wallet.balance.toString() },
    { type, amount, reason, balanceAfter: result.balanceAfter }
  );

  return res.status(200).json({ walletTransaction: result });
}

const markFailedSchema = z.object({ reason: z.string().trim().min(3).max(150) });

async function markTransactionFailedByAdmin(req, res) {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "Invalid transaction ID." });
  }

  const parsed = markFailedSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { reason } = parsed.data;

  const tx = await prisma.transaction.findUnique({ where: { id }, include: { walletTransaction: true } });
  if (!tx) {
    return res.status(404).json({ error: "Transaction not found." });
  }
  if (tx.status !== "PENDING") {
    return res.status(409).json({ error: "Only PENDING transactions can be marked as failed." });
  }
  if (Date.now() - new Date(tx.createdAt).getTime() < 10 * 60 * 1000) {
    return res.status(409).json({ error: "This transaction is less than 10 minutes old and may still be processing." });
  }
  if (tx.providerReference || tx.refunded || tx.walletTransaction) {
    return res.status(409).json({ error: "This transaction has a provider reference or wallet entry. Resolve it manually." });
  }

  const failureReason = ("Marked failed by admin: " + reason).slice(0, 190);
  const updated = await prisma.transaction.updateMany({
    where: { id, status: "PENDING", refunded: false, providerReference: null, walletTransaction: { is: null } },
    data: { status: "FAILED", failureReason },
  });
  if (updated.count !== 1) {
    return res.status(409).json({ error: "This transaction changed while you were working. Refresh and check it." });
  }

  await logAdminAction(req.user.id, "MARK_TRANSACTION_FAILED", "Transaction", id, { status: "PENDING" }, { status: "FAILED", reason });

  return res.status(200).json({ ok: true });
}

async function getAuditLog(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, email: true } } },
    }),
    prisma.adminAuditLog.count(),
  ]);

  return res.status(200).json({
    logs,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

module.exports = {
  listUsers,
  getUser,
  updateUserStatus,
  updateUserRole,
  listTransactions,
  listPayments,
  adjustWallet,
  getAuditLog,
  markTransactionFailedByAdmin,
};