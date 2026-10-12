const { PrismaClient } = require("@prisma/client");
const { creditWalletInTransaction } = require("./wallet");
const {
  initializeTransaction,
  verifyTransaction,
} = require("./paystack");

const prisma = new PrismaClient({ transactionOptions: { maxWait: 10000, timeout: 30000 } });

async function createPayment({
  userId,
  reference,
  amount,
  provider = "PAYSTACK",
}) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("A valid user ID is required.");
  }

  if (!reference || typeof reference !== "string") {
    throw new Error("A valid payment reference is required.");
  }

  const paymentAmount = Number(amount);

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("A valid payment amount is required.");
  }

  return prisma.payment.create({
    data: {
      userId,
      reference,
      amount: paymentAmount,
      provider,
      status: "PENDING",
    },
  });
}

async function initializePayment({
  userId,
  reference,
  amount,
  callbackUrl = null,
}) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("A valid user ID is required.");
  }

  if (!reference || typeof reference !== "string") {
    throw new Error("A valid payment reference is required.");
  }

  const paymentAmount = Number(amount);

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("A valid payment amount is required.");
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
    },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  if (!user.email || typeof user.email !== "string") {
    throw new Error("Customer email is required for Paystack payment.");
  }

  const payment = await createPayment({
    userId,
    reference,
    amount: paymentAmount,
    provider: "PAYSTACK",
  });

  try {
    const paystackTransaction = await initializeTransaction({
      email: user.email,
      amount: payment.amount,
      reference: payment.reference,
      callbackUrl,
    });

    return {
      payment,
      paystack: paystackTransaction,
    };
  } catch (error) {
    await prisma.payment.update({
      where: {
        id: payment.id,
      },
      data: {
        status: "FAILED",
      },
    });

    throw error;
  }
}

async function confirmPayment({
  reference,
  providerReference = null,
  channel = null,
  providerResponse = null,
}) {
  if (!reference || typeof reference !== "string") {
    throw new Error("A valid payment reference is required.");
  }

  return prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findUnique({
        where: {
          reference,
        },
      });

      if (!payment) {
        throw new Error("Payment not found.");
      }

      if (payment.status === "SUCCESS") {
        return payment;
      }

      if (payment.status !== "PENDING") {
        throw new Error(
          `Payment cannot be confirmed from status: ${payment.status}`
        );
      }

      const walletReference = `WALLET-FUND-${payment.reference}`;

      await creditWalletInTransaction(tx, {
        userId: payment.userId,
        amount: payment.amount,
        reference: walletReference,
        description: `Wallet funding for payment ${payment.reference}`,
        type: "CREDIT",
        paymentId: payment.id,
      });

      return tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: "SUCCESS",
          providerReference,
          channel,
          providerResponse,
          paidAt: new Date(),
        },
      });
    }
  );
}

async function verifyAndConfirmPayment(reference) {
  if (!reference || typeof reference !== "string") {
    throw new Error("A valid payment reference is required.");
  }

  const payment = await prisma.payment.findUnique({
    where: {
      reference,
    },
  });

  if (!payment) {
    throw new Error("Payment not found.");
  }

  if (payment.status === "SUCCESS") {
    return payment;
  }

  if (payment.status !== "PENDING") {
    throw new Error(
      `Payment cannot be verified from status: ${payment.status}`
    );
  }

  const verified = await verifyTransaction(reference);

  if (verified.reference !== payment.reference) {
    throw new Error("Paystack reference does not match the payment.");
  }

  if (verified.status !== "success") {
    throw new Error(
      `Paystack payment is not successful. Status: ${verified.status}`
    );
  }

  if (verified.currency !== "NGN") {
    throw new Error(
      `Unexpected payment currency: ${verified.currency}`
    );
  }

  const verifiedAmount = Number(verified.amount) / 100;
  const localAmount = Number(payment.amount);

  if (verifiedAmount !== localAmount) {
    throw new Error(
      `Payment amount mismatch. Expected ${localAmount}, received ${verifiedAmount}.`
    );
  }

  return confirmPayment({
    reference: payment.reference,
    providerReference: verified.id
      ? String(verified.id)
      : verified.reference,
    channel: verified.channel || null,
    providerResponse: verified,
  });
}

module.exports = {
  createPayment,
  initializePayment,
  confirmPayment,
  verifyAndConfirmPayment,
};