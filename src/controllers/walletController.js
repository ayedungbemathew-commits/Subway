const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function getBalance(req, res) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId: req.user.id },
    select: { balance: true, updatedAt: true },
  });

  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  return res.status(200).json({ balance: wallet.balance, updatedAt: wallet.updatedAt });
}

async function getTransactions(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  const [entries, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        status: true,
        amount: true,
        balanceBefore: true,
        balanceAfter: true,
        description: true,
        reference: true,
        createdAt: true,
      },
    }),
    prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
  ]);

  return res.status(200).json({
    entries,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

module.exports = { getBalance, getTransactions };