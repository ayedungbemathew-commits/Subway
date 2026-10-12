const { PrismaClient, Prisma } = require("@prisma/client");
const MockProvider = require("../providers/mockProvider");
const { debitWalletInTransaction } = require("./wallet");

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

function validatePhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== "string") {
    throw new Error("A valid phone number is required.");
  }

  const normalized = phoneNumber.replace(/\s+/g, "");

  if (!/^0\d{10}$/.test(normalized)) {
    throw new Error(
      "Phone number must be a valid Nigerian 11-digit number."
    );
  }

  return normalized;
}

function validateReference(reference) {
  if (!reference || typeof reference !== "string") {
    throw new Error("A valid transaction reference is required.");
  }

  const normalized = reference.trim();

  if (!normalized) {
    throw new Error("A valid transaction reference is required.");
  }

  return normalized;
}

async function validateUser(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid user ID.");
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  if (user.status !== "ACTIVE") {
    throw new Error("User account is not active.");
  }

  return user;
}

async function getActiveNetwork(networkCode) {
  if (!networkCode || typeof networkCode !== "string") {
    throw new Error("Network code is required.");
  }

  const network = await prisma.network.findFirst({
    where: {
      code: networkCode.trim().toUpperCase(),
      status: "ACTIVE",
    },
  });

  if (!network) {
    throw new Error("Network not found or inactive.");
  }

  return network;
}

async function getActiveProvider() {
  const provider = await prisma.provider.findFirst({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      priority: "asc",
    },
  });

  if (!provider) {
    throw new Error("No active VTU provider is available.");
  }

  return provider;
}

function createProviderAdapter(provider) {
  const mode = (process.env.MOCK_PROVIDER_MODE || "SUCCESS").toUpperCase();

  return new MockProvider({
    mode,
    providerId: provider.id,
  });
}
async function createPendingTransaction({
  userId,
  networkId,
  providerId,
  reference,
  phoneNumber,
  amount,
  type,
  dataPlanId = null,
  providerCost = "0.00",
}) {
  return prisma.transaction.create({
    data: {
      userId,
      networkId,
      providerId,
      dataPlanId,
      reference,
      type,
      status: "PENDING",
      phoneNumber,
      amount,
      providerCost: money(providerCost),
      profit: money("0.00"),
    },
  });
}

async function createPendingTransactionSafely(data) {
  try {
    const transaction = await createPendingTransaction(data);
    return {
      transaction,
      created: true,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existingTransaction = await findExistingTransaction(data.reference);
      if (existingTransaction) {
        return {
          transaction: existingTransaction,
          created: false,
        };
      }
    }
    throw error;
  }
}
async function markTransactionFailed(transactionId, providerResult) {
  return prisma.transaction.update({
    where: {
      id: transactionId,
    },
    data: {
      status: "FAILED",
      providerReference: providerResult.providerReference || null,
      providerResponse: providerResult.providerResponse || null,
      failureReason:
        providerResult.failureReason ||
        "Provider failed to process the transaction.",
    },
  });
}

async function markTransactionPending(transactionId, providerResult) {
  return prisma.transaction.update({
    where: {
      id: transactionId,
    },
    data: {
      status: "PROCESSING",
      providerReference: providerResult.providerReference || null,
      providerResponse: providerResult.providerResponse || null,
    },
  });
}
async function completeSuccessfulTransaction(
  transactionId,
  providerResult
) {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const transaction = await tx.transaction.findUnique({
            where: {
              id: transactionId,
            },
          });

          if (!transaction) {
            throw new Error("VTU transaction not found.");
          }

          if (transaction.status === "SUCCESS") {
            return transaction;
          }

          if (
            transaction.status === "FAILED" ||
            transaction.status === "REVERSED"
          ) {
            throw new Error(
              "Transaction cannot be completed because its current status is " +
                transaction.status +
                "."
            );
          }

          await debitWalletInTransaction(tx, {
            userId: transaction.userId,
            amount: transaction.amount,
            reference: "VTU-DEBIT-" + transaction.id,
            transactionId: transaction.id,
            description:
              transaction.type === "AIRTIME"
                ? "Airtime purchase for " + transaction.phoneNumber
                : "Data purchase for " + transaction.phoneNumber,
          });

          const providerCost =
  transaction.providerCost && transaction.providerCost.gt(0)
    ? transaction.providerCost
    : providerResult.providerCost
      ? money(providerResult.providerCost)
      : money(transaction.providerCost);

          const profit = transaction.amount.minus(providerCost);

          return tx.transaction.update({
            where: {
              id: transaction.id,
            },
            data: {
              status: "SUCCESS",
              providerReference:
                providerResult.providerReference || null,
              providerResponse:
                providerResult.providerResponse || null,
              providerCost,
              profit,
              failureReason: null,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < MAX_RETRIES
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * attempt)
        );

        continue;
      }

      /*
       * The provider has already reported SUCCESS, but the local wallet
       * could not be debited. Do not retry the provider purchase.
       * Persist the local transaction as FAILED outside the rolled-back
       * Serializable transaction.
       */
      if (
        error instanceof Error &&
        error.message === "Insufficient wallet balance."
      ) {
        return markTransactionFailed(transactionId, {
          failureReason: "Insufficient wallet balance.",
          providerResponse: {
            ...(providerResult.providerResponse || {}),
            completionError: "Insufficient wallet balance.",
          },
        });
      }

      throw error;
    }
  }

    throw new Error(
    "Transaction could not be completed after multiple concurrency retries."
  );
}
async function reconcileTransaction(reference) {
  const transactionReference = validateReference(reference);

  const transaction = await prisma.transaction.findUnique({
    where: {
      reference: transactionReference,
    },
  });

  if (!transaction) {
    throw new Error("VTU transaction not found.");
  }

  if (transaction.status !== "PROCESSING") {
    return transaction;
  }

  if (!transaction.providerId) {
    throw new Error("Transaction has no provider assigned.");
  }

  const provider = await prisma.provider.findUnique({
    where: {
      id: transaction.providerId,
    },
  });

  if (!provider) {
    throw new Error("Transaction provider not found.");
  }

  const providerAdapter = createProviderAdapter(provider);

  let providerResult;

  try {
    providerResult = await providerAdapter.checkTransaction({
      reference: transaction.reference,
      transaction,
    });
  } catch (error) {
    return transaction;
  }

  if (providerResult.status === "SUCCESS") {
    return completeSuccessfulTransaction(
      transaction.id,
      providerResult
    );
  }

  if (providerResult.status === "FAILED") {
    return markTransactionFailed(
      transaction.id,
      providerResult
    );
  }

  if (providerResult.status === "PENDING") {
    return markTransactionPending(
      transaction.id,
      providerResult
    );
  }

  return markTransactionPending(transaction.id, {
    ...providerResult,
    providerResponse: {
      ...(providerResult.providerResponse || {}),
      message:
        "Unknown provider reconciliation response. Transaction remains in processing state.",
    },
  });
}

async function findExistingTransaction(reference) {
  return prisma.transaction.findUnique({
    where: {
      reference,
    },
  });
}


async function purchaseAirtime({
  userId,
  networkCode,
  phoneNumber,
  amount,
  reference,
}) {
  const validatedUser = await validateUser(userId);
  const network = await getActiveNetwork(networkCode);
  const provider = await getActiveProvider();

  const normalizedPhone = validatePhoneNumber(phoneNumber);
  const purchaseAmount = validateAmount(amount);
  const transactionReference = validateReference(reference);

  const existingTransaction = await findExistingTransaction(
    transactionReference
  );

  if (existingTransaction) {
    return existingTransaction;
  }

  const pendingResult = await createPendingTransactionSafely({
    userId: validatedUser.id,
    networkId: network.id,
    providerId: provider.id,
    reference: transactionReference,
    phoneNumber: normalizedPhone,
    amount: purchaseAmount,
    type: "AIRTIME",
  });

  const transaction = pendingResult.transaction;

  if (!pendingResult.created) {
    return transaction;
  }

  const providerAdapter = createProviderAdapter(provider);

  let providerResult;

  try {
    providerResult = await providerAdapter.purchaseAirtime({
      reference: transaction.reference,
      networkCode: network.code,
      phoneNumber: transaction.phoneNumber,
      amount: transaction.amount.toString(),
    });
  } catch (error) {
  return markTransactionPending(transaction.id, {
    providerResponse: {
      provider: "MOCK",
      error: error.message || "Provider request failed.",
      message:
        "Provider request failed or timed out. Transaction remains in processing state for reconciliation.",
    },
  });
}

  if (providerResult.status === "FAILED") {
  return markTransactionFailed(
    transaction.id,
    providerResult
  );
}

if (providerResult.status === "PENDING") {
  return markTransactionPending(
    transaction.id,
    providerResult
  );
}

  if (providerResult.status === "SUCCESS") {
  try {
    return await completeSuccessfulTransaction(
      transaction.id,
      providerResult
    );
  } catch (error) {
    return markTransactionFailed(transaction.id, {
      failureReason:
        error.message || "Transaction could not be completed.",
      providerResponse: {
        ...(providerResult.providerResponse || {}),
        completionError: error.message,
      },
    });
  }
}

  return markTransactionPending(transaction.id, {
    ...providerResult,
    providerResponse: {
      ...(providerResult.providerResponse || {}),
      message:
        "Unknown provider response. Transaction left pending for reconciliation.",
    },
  });
}

async function purchaseData({
  userId,
  networkCode,
  phoneNumber,
  dataPlanId,
  reference,
}) {
  const validatedUser = await validateUser(userId);
  const network = await getActiveNetwork(networkCode);
  const provider = await getActiveProvider();

  const normalizedPhone = validatePhoneNumber(phoneNumber);
  const transactionReference = validateReference(reference);

  if (!Number.isInteger(dataPlanId) || dataPlanId <= 0) {
    throw new Error("Invalid data plan ID.");
  }

  const dataPlan = await prisma.dataPlan.findFirst({
    where: {
      id: dataPlanId,
      networkId: network.id,
      status: "ACTIVE",
    },
  });

  if (!dataPlan) {
    throw new Error("Data plan not found or inactive.");
  }

  const existingTransaction = await findExistingTransaction(
    transactionReference
  );

  if (existingTransaction) {
    return existingTransaction;
  }

  const pendingResult = await createPendingTransactionSafely({
    userId: validatedUser.id,
    networkId: network.id,
    providerId: provider.id,
    dataPlanId: dataPlan.id,
    reference: transactionReference,
    phoneNumber: normalizedPhone,
    amount: dataPlan.sellingPrice,
    type: "DATA",
    providerCost: dataPlan.providerCost,
  });

  const transaction = pendingResult.transaction;

  if (!pendingResult.created) {
    return transaction;
  }

  const providerAdapter = createProviderAdapter(provider);

  let providerResult;

  try {
    providerResult = await providerAdapter.purchaseData({
      reference: transaction.reference,
      networkCode: network.code,
      phoneNumber: transaction.phoneNumber,
      providerPlanId: dataPlan.providerPlanId,
      amount: transaction.amount.toString(),
    });
  } catch (error) {
  return markTransactionPending(transaction.id, {
    providerResponse: {
      provider: "MOCK",
      error: error.message || "Provider request failed.",
      message:
        "Provider request failed or timed out. Transaction remains in processing state for reconciliation.",
    },
  });
}

  if (providerResult.status === "FAILED") {
  return markTransactionFailed(
    transaction.id,
    providerResult
  );
}

  if (providerResult.status === "PENDING") {
    return markTransactionPending(
      transaction.id,
      providerResult
    );
  }

  if (providerResult.status === "SUCCESS") {
    return completeSuccessfulTransaction(
      transaction.id,
      providerResult
    );
  }

  return markTransactionPending(transaction.id, {
    ...providerResult,
    providerResponse: {
      ...(providerResult.providerResponse || {}),
      message:
        "Unknown provider response. Transaction left pending for reconciliation.",
    },
  });
}

async function disconnectVtuService() {
  await prisma.$disconnect();
}

module.exports = {
  purchaseAirtime,
  purchaseData,
  reconcileTransaction,
  disconnectVtuService,
};


