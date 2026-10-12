const { PrismaClient, Prisma } = require("@prisma/client");

const prisma = new PrismaClient({ transactionOptions: { maxWait: 10000, timeout: 30000 } });

function money(amount) {
  try {
    return new Prisma.Decimal(amount);
  } catch (error) {
    throw new Error("Invalid monetary amount.");
  }
}

function validateAmount(amount) {
  const value = money(amount);

  if (!value.isFinite() || value.lte(0)) {
    throw new Error("Amount must be greater than zero.");
  }

  return value;
}

function validateUserId(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid user ID.");
  }
}

/**
 * Internal transaction-aware wallet debit.
 *
 * IMPORTANT:
 * This function does NOT create its own Prisma transaction.
 * It receives an existing Prisma transaction client (`tx`).
 *
 * This allows VTU transactions and wallet debits to succeed/fail
 * atomically inside the same database transaction.
 */
async function debitWalletInTransaction(
  tx,
  {
    userId,
    amount,
    reference,
    description = "Wallet debit",
    type = "DEBIT",
    transactionId = null,
  }
) {
  validateUserId(userId);

  if (!reference || typeof reference !== "string") {
    throw new Error("A valid transaction reference is required.");
  }

  const debitAmount = validateAmount(amount);

  const wallet = await tx.wallet.findUnique({
    where: {
      userId,
    },
  });

  if (!wallet) {
    throw new Error("Wallet not found.");
  }

  const existing = await tx.walletTransaction.findUnique({
    where: {
      reference,
    },
  });

  if (existing) {
    return existing;
  }

  const balanceBefore = wallet.balance;

  if (balanceBefore.lt(debitAmount)) {
    throw new Error("Insufficient wallet balance.");
  }

  const balanceAfter = balanceBefore.minus(debitAmount);

  await tx.wallet.update({
    where: {
      id: wallet.id,
    },
    data: {
      balance: balanceAfter,
    },
  });

  return tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      reference,
      type,
      amount: debitAmount,
      balanceBefore,
      balanceAfter,
      description,
      transactionId,
      status: "SUCCESS",
    },
  });
}
async function creditWalletInTransaction(
  tx,
  {
    userId,
    amount,
    reference,
    description = "Wallet funding",
    type = "CREDIT",
    paymentId = null,
  }
) {
  validateUserId(userId);

  if (!reference || typeof reference !== "string") {
    throw new Error("A valid transaction reference is required.");
  }

  const creditAmount = validateAmount(amount);

  const wallet = await tx.wallet.findUnique({
    where: {
      userId,
    },
  });

  if (!wallet) {
    throw new Error("Wallet not found.");
  }

  const existing = await tx.walletTransaction.findUnique({
    where: {
      reference,
    },
  });

  if (existing) {
    return existing;
  }

  const balanceBefore = wallet.balance;
  const balanceAfter = balanceBefore.plus(creditAmount);

  await tx.wallet.update({
    where: {
      id: wallet.id,
    },
    data: {
      balance: balanceAfter,
    },
  });

  return tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      reference,
      type,
      amount: creditAmount,
      balanceBefore,
      balanceAfter,
      description,
      paymentId,
      status: "SUCCESS",
    },
  });
}
async function createWallet(userId) {
  validateUserId(userId);

  return prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      balance: money("0.00"),
    },
  });
}

async function getWallet(userId) {
  validateUserId(userId);

  const wallet = await prisma.wallet.findUnique({
    where: { userId },
  });

  if (!wallet) {
    throw new Error("Wallet not found.");
  }

  return wallet;
}

async function getWalletBalance(userId) {
  const wallet = await getWallet(userId);
  return wallet.balance;
}

async function creditWallet({
  userId,
  amount,
  reference,
  description = "Wallet funding",
  type = "CREDIT",
}) {
  validateUserId(userId);

  if (!reference || typeof reference !== "string") {
    throw new Error("A valid transaction reference is required.");
  }

  const creditAmount = validateAmount(amount);

  return prisma.$transaction(
    async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new Error("Wallet not found.");
      }

      const existing = await tx.walletTransaction.findUnique({
        where: { reference },
      });

      if (existing) {
        return existing;
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore.plus(creditAmount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: balanceAfter,
        },
      });

      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          reference,
          type,
          amount: creditAmount,
          balanceBefore,
          balanceAfter,
          description,
          status: "SUCCESS",
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }
  );
}

async function debitWallet({
  userId,
  amount,
  reference,
  description = "Wallet debit",
  type = "DEBIT",
}) {
  validateUserId(userId);

  return prisma.$transaction(
    async (tx) => {
      return debitWalletInTransaction(tx, {
        userId,
        amount,
        reference,
        description,
        type,
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }
  );
}

async function refundWallet({
  userId,
  amount,
  reference,
  description = "Wallet refund",
}) {
  return creditWallet({
    userId,
    amount,
    reference,
    description,
    type: "REFUND",
  });
}

async function reverseWalletTransaction({
  userId,
  amount,
  reference,
  description = "Wallet transaction reversal",
}) {
  return creditWallet({
    userId,
    amount,
    reference,
    description,
    type: "REVERSAL",
  });
}

async function disconnectWalletEngine() {
  await prisma.$disconnect();
}

module.exports = {
  createWallet,
  getWallet,
  getWalletBalance,
  creditWallet,
  debitWallet,
  refundWallet,
  reverseWalletTransaction,
  debitWalletInTransaction,
  disconnectWalletEngine,
};

module.exports = {
  createWallet,
  getWallet,
  getWalletBalance,
  creditWallet,
  creditWalletInTransaction,
  debitWallet,
  refundWallet,
  reverseWalletTransaction,
  debitWalletInTransaction,
  disconnectWalletEngine,
};