const { PrismaClient, Prisma } = require("@prisma/client");
const {
  createPayment,
  confirmPayment,
} = require("./src/services/payment");
const {
  getWallet,
  debitWallet,
} = require("./src/services/wallet");
const prisma = new PrismaClient();
const USER_ID = 1;
const PREFIX = "DEEP-PAYMENT-AUDIT-";
const RUN_ID = Date.now();
const results = [];

function pass(name, detail = "") {
  results.push({
    name,
    status: "PASS",
    detail,
  });
}
function fail(name, error) {
  results.push({
    name,
    status: "FAIL",
    detail: error instanceof Error ? error.message : String(error),
  });
}
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
async function walletBalance() {
  const wallet = await getWallet(USER_ID);
  assert(wallet, "Wallet not found.");
  return new Prisma.Decimal(wallet.balance);
}
async function walletEntriesForPayment(paymentId) {
  return prisma.walletTransaction.findMany({
    where: {
      paymentId,
    },
    orderBy: {
      id: "asc",
    },
  });
}
async function cleanup() {
  /*
   * Cleanup is deliberately scoped to transaction IDs created
   * during THIS invocation of the audit.
   *
   * Historical DEEP-VTU-AUDIT-* records must never be touched.
   */

  const transactionIds = [...currentRunTransactionIds];

  if (transactionIds.length) {
    const transactions = await prisma.transaction.findMany({
      where: {
        id: {
          in: transactionIds,
        },
      },
      select: {
        id: true,
        userId: true,
        amount: true,
        status: true,
        reference: true,
      },
    });

    /*
     * Reverse successful VTU debits BEFORE deleting the original
     * transaction/wallet records.
     */
    for (const transaction of transactions) {
      if (transaction.status !== "SUCCESS") {
        continue;
      }

      const walletTransaction =
        await prisma.walletTransaction.findFirst({
          where: {
            transactionId: transaction.id,
            type: "DEBIT",
          },
          select: {
            id: true,
            amount: true,
          },
        });

      if (!walletTransaction) {
        continue;
      }

      const reversalReference =
        `${PREFIX}REVERSAL-${RUN_ID}-${transaction.id}`;

      await creditWallet({
        userId: transaction.userId,
        amount: walletTransaction.amount,
        reference: reversalReference,
        description:
          `Audit cleanup reversal for VTU transaction ${transaction.reference}`,
        type: "REVERSAL",
      });
    }

    /*
     * Only after the financial reversal has succeeded do we
     * remove the original wallet ledger entries.
     */
    await prisma.walletTransaction.deleteMany({
      where: {
        transactionId: {
          in: transactionIds,
        },
      },
    });

    /*
     * Remove only transactions created during THIS audit run.
     */
    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: transactionIds,
        },
      },
    });
  }

  /*
   * Remove only temporary/reversal wallet entries containing
   * THIS RUN_ID.
   *
   * Never use startsWith(PREFIX), because that would affect
   * historical audit records.
   */
  await prisma.walletTransaction.deleteMany({
    where: {
      reference: {
        contains: String(RUN_ID),
      },
    },
  });

  /*
   * Clear the in-memory tracker so repeated cleanup calls
   * during error handling are harmless.
   */
  currentRunTransactionIds.clear();
}
async function run() {
  console.log("\n========================================");
  console.log("     PAYMENT DEEP FINANCIAL AUDIT");
  console.log("========================================\n");
  await cleanup();
  const initialBalance = await walletBalance();
  console.log(
    `Starting wallet balance: ?${initialBalance.toFixed(2)}\n`
  );
  /*
   * 1. SUCCESSFUL PAYMENT ? EXACTLY ONE CREDIT
   */
  try {
    const reference =
      `${PREFIX}SUCCESS-${RUN_ID}`;
    const payment = await createPayment({
      userId: USER_ID,
      reference,
      amount: 500,
    });
    
    const before = await walletBalance();
    const confirmed = await confirmPayment({
      reference,
      providerReference: "DEEP-PAYSTACK-SUCCESS",
      channel: "card",
      providerResponse: {
        status: "success",
        reference,
        amount: 50000,
        currency: "NGN",
      },
    });
    const after = await walletBalance();
    const entries = await walletEntriesForPayment(payment.id);
    assert(
      confirmed.status === "SUCCESS",
      `Expected SUCCESS, received ${confirmed.status}.`
    );
    assert(
      after.eq(before.plus(500)),
      `Expected wallet increase of ?500. Balance: ${before} ? ${after}.`
    );
    assert(
      entries.length === 1,
      `Expected one wallet credit, found ${entries.length}.`
    );
    assert(
      entries[0].type === "CREDIT",
      `Expected CREDIT entry, found ${entries[0].type}.`
    );
    assert(
      new Prisma.Decimal(entries[0].amount).eq(500),
      `Expected ?500 credit, found ?${entries[0].amount}.`
    );
    assert(
      entries[0].paymentId === payment.id,
      "Wallet credit is not linked to the payment."
    );
    pass(
      "Successful payment ? one wallet credit",
      "Successful payment created exactly one ?500 wallet credit linked to the payment."
    );
  } catch (error) {
    fail("Successful payment ? one wallet credit", error);
  }
  /*
   * 2. REPEATED CONFIRMATION
   */
  try {
    const reference =
      `${PREFIX}REPEAT-${RUN_ID}`;
    const payment = await createPayment({
      userId: USER_ID,
      reference,
      amount: 250,
    });
    const first = await confirmPayment({
      reference,
      providerReference: "DEEP-PAYSTACK-REPEAT",
      channel: "card",
      providerResponse: {
        status: "success",
        reference,
        amount: 25000,
        currency: "NGN",
      },
    });
    const beforeRepeat = await walletBalance();
    const second = await confirmPayment({
      reference,
      providerReference: "DEEP-PAYSTACK-REPEAT",
      channel: "card",
      providerResponse: {
        status: "success",
        reference,
        amount: 25000,
        currency: "NGN",
      },
    });
    const afterRepeat = await walletBalance();
    const entries = await walletEntriesForPayment(payment.id);
    assert(first.status === "SUCCESS", "First confirmation failed.");
    assert(second.status === "SUCCESS", "Repeated confirmation failed.");
    assert(
      afterRepeat.eq(beforeRepeat),
      "Repeated confirmation changed the wallet."
    );
    assert(
      entries.length === 1,
      `Expected one wallet credit, found ${entries.length}.`
    );
    pass(
      "Repeated confirmation",
      "Repeated confirmation returned SUCCESS without creating another wallet credit."
    );
  } catch (error) {
    fail("Repeated confirmation", error);
  }
  /*
   * 3. CONCURRENT CONFIRMATIONS
   */
  try {
    const reference =
      `${PREFIX}CONCURRENT-${RUN_ID}`;
    const payment = await createPayment({
      userId: USER_ID,
      reference,
      amount: 300,
    });
    const before = await walletBalance();
    const attempts = await Promise.allSettled([
      confirmPayment({
        reference,
        providerReference: "DEEP-PAYSTACK-CONCURRENT-A",
        channel: "card",
        providerResponse: {
          status: "success",
          reference,
          amount: 30000,
          currency: "NGN",
        },
      }),
      confirmPayment({
        reference,
        providerReference: "DEEP-PAYSTACK-CONCURRENT-B",
        channel: "card",
        providerResponse: {
          status: "success",
          reference,
          amount: 30000,
          currency: "NGN",
        },
      }),
    ]);
    const successfulAttempts = attempts.filter(
      (result) =>
        result.status === "fulfilled" &&
        result.value.status === "SUCCESS"
    );
    const entries = await walletEntriesForPayment(payment.id);
    const after = await walletBalance();
    assert(
      successfulAttempts.length >= 1,
      "No concurrent confirmation succeeded."
    );
    assert(
      entries.length === 1,
      `Expected exactly one wallet credit, found ${entries.length}.`
    );
    assert(
      after.eq(before.plus(300)),
      `Expected exactly one ?300 credit. Balance: ${before} ? ${after}.`
    );
    const finalPayment = await prisma.payment.findUnique({
      where: {
        reference,
      },
    });
    assert(
      finalPayment.status === "SUCCESS",
      `Final payment status is ${finalPayment.status}.`
    );
    pass(
      "Concurrent confirmations",
      `Concurrent confirmations produced one wallet credit and final payment status SUCCESS.`
    );
  } catch (error) {
    fail("Concurrent confirmations", error);
  }
  /*
   * 4. DUPLICATE PAYMENT REFERENCE
   */
  try {
    const reference =
      `${PREFIX}DUPLICATE-${RUN_ID}`;
    const first = await createPayment({
      userId: USER_ID,
      reference,
      amount: 100,
    });
    let rejected = false;
    try {
      await createPayment({
        userId: USER_ID,
        reference,
        amount: 999,
      });
    } catch (error) {
      rejected = true;
    }
    const payments = await prisma.payment.findMany({
      where: {
        reference,
      },
    });
    assert(
      rejected,
      "Duplicate payment reference was accepted."
    );
    assert(
      payments.length === 1,
      `Expected one payment, found ${payments.length}.`
    );
    assert(
      new Prisma.Decimal(payments[0].amount).eq(100),
      `Original payment amount changed to ${payments[0].amount}.`
    );
    assert(
      payments[0].id === first.id,
      "Duplicate reference did not preserve original payment."
    );
    pass(
      "Duplicate payment reference",
      "Database uniqueness prevents creation of a second payment with the same reference."
    );
  } catch (error) {
    fail("Duplicate payment reference", error);
  }
  /*
   * 5. ALREADY SUCCESSFUL PAYMENT
   */
  try {
    const reference =
      `${PREFIX}ALREADY-SUCCESS-${RUN_ID}`;
    const payment = await createPayment({
      userId: USER_ID,
      reference,
      amount: 150,
    });
    const first = await confirmPayment({
      reference,
      providerReference: "DEEP-PAYSTACK-ALREADY",
      channel: "card",
      providerResponse: {
        status: "success",
        reference,
        amount: 15000,
        currency: "NGN",
      },
    });
    const before = await walletBalance();
    const second = await confirmPayment({
      reference,
      providerReference: "DIFFERENT-PROVIDER-REFERENCE",
      channel: "bank",
      providerResponse: {
        status: "success",
        reference,
        amount: 15000,
        currency: "NGN",
      },
    });
    const after = await walletBalance();
    const entries = await walletEntriesForPayment(payment.id);
    assert(first.status === "SUCCESS", "Initial confirmation failed.");
    assert(second.status === "SUCCESS", "Already-successful payment was not returned.");
    assert(
      after.eq(before),
      "Already-successful payment caused another wallet credit."
    );
    assert(
      entries.length === 1,
      `Expected one wallet credit, found ${entries.length}.`
    );
    pass(
      "Already successful payment",
      "A SUCCESS payment cannot be credited again."
    );
  } catch (error) {
    fail("Already successful payment", error);
  }
  /*
   * 6. FAILED PAYMENT CANNOT BE CONFIRMED
   */
  try {
    const reference =
      `${PREFIX}FAILED-CONFIRM-${RUN_ID}`;
    const payment = await createPayment({
      userId: USER_ID,
      reference,
      amount: 200,
    });
    await prisma.payment.update({
      where: {
        id: payment.id,
      },
      data: {
        status: "FAILED",
      },
    });
    const before = await walletBalance();
    let rejected = false;
    try {
      await confirmPayment({
        reference,
        providerReference: "SHOULD-NOT-CREDIT",
      });
    } catch (error) {
      rejected = true;
      assert(
        error.message ===
          "Payment cannot be confirmed from status: FAILED",
        `Unexpected error: ${error.message}`
      );
    }
    const after = await walletBalance();
    const entries = await walletEntriesForPayment(payment.id);
    assert(rejected, "FAILED payment was confirmed.");
    assert(after.eq(before), "FAILED payment changed the wallet.");
    assert(entries.length === 0, "FAILED payment created a wallet entry.");
    pass(
      "Failed payment protection",
      "A FAILED payment cannot create a wallet credit."
    );
  } catch (error) {
    fail("Failed payment protection", error);
  }
  /*
   * 7. NONEXISTENT PAYMENT
   */
  try {
    const before = await walletBalance();
    let rejected = false;
    try {
      await confirmPayment({
        reference: `${PREFIX}DOES-NOT-EXIST-${RUN_ID}`,
      });
    } catch (error) {
      rejected = true;
      assert(
        error.message === "Payment not found.",
        `Unexpected error: ${error.message}`
      );
    }
    const after = await walletBalance();
    assert(rejected, "Nonexistent payment was accepted.");
    assert(
      after.eq(before),
      "Nonexistent payment changed the wallet."
    );
    pass(
      "Nonexistent payment",
      "Unknown payment references cannot create wallet credits."
    );
  } catch (error) {
    fail("Nonexistent payment", error);
  }
  /*
   * 8. PAYMENT ? WALLET TRANSACTION LINK
   */
  try {
    const reference =
      `${PREFIX}RELATION-${RUN_ID}`;
    const payment = await createPayment({
      userId: USER_ID,
      reference,
      amount: 400,
    });
    await confirmPayment({
      reference,
      providerReference: "DEEP-PAYSTACK-RELATION",
      channel: "card",
      providerResponse: {
        status: "success",
        reference,
        amount: 40000,
        currency: "NGN",
      },
    });
    const entries = await walletEntriesForPayment(payment.id);
    assert(
      entries.length === 1,
      `Expected one linked wallet transaction, found ${entries.length}.`
    );
    assert(
      entries[0].paymentId === payment.id,
      "Wallet transaction paymentId does not match payment."
    );
    assert(
      entries[0].walletId > 0,
      "Wallet transaction has no wallet ID."
    );
    pass(
      "Payment ? wallet relationship",
      "Successful payment has exactly one wallet transaction linked through paymentId."
    );
  } catch (error) {
    fail("Payment ? wallet relationship", error);
  }
  /*
   * 9. PAYMENT AMOUNT = WALLET CREDIT
   */
  try {
    const reference =
      `${PREFIX}AMOUNT-${RUN_ID}`;
    const amount = new Prisma.Decimal("375.50");
    const payment = await createPayment({
      userId: USER_ID,
      reference,
      amount,
    });
    await confirmPayment({
      reference,
      providerReference: "DEEP-PAYSTACK-AMOUNT",
      channel: "card",
      providerResponse: {
        status: "success",
        reference,
        amount: 37550,
        currency: "NGN",
      },
    });
    const entries = await walletEntriesForPayment(payment.id);
    assert(entries.length === 1, "Expected one wallet transaction.");
    assert(
      new Prisma.Decimal(payment.amount).eq(
        new Prisma.Decimal(entries[0].amount)
      ),
      `Payment amount ${payment.amount} does not equal wallet credit ${entries[0].amount}.`
    );
    pass(
      "Payment amount = wallet credit",
      "The wallet credit exactly matches the payment amount."
    );
  } catch (error) {
    fail("Payment amount = wallet credit", error);
  }
  /*
   * 10. FINANCIAL CONSERVATION
   */
  try {
    const current = await walletBalance();
    const successfulPayments =
      await prisma.payment.findMany({
        where: {
          reference: {
            startsWith: PREFIX,
          },
          status: "SUCCESS",
        },
        select: {
          amount: true,
        },
      });
    let expectedCredits = new Prisma.Decimal("0.00");
    for (const payment of successfulPayments) {
      expectedCredits = expectedCredits.plus(payment.amount);
    }
    const expectedBalance =
      initialBalance.plus(expectedCredits);
    assert(
      current.eq(expectedBalance),
      `Financial conservation failed. Expected ?${expectedBalance.toFixed(
        2
      )}, found ?${current.toFixed(2)}.`
    );
    pass(
      "Financial conservation",
      `Starting ?${initialBalance.toFixed(
        2
      )} + payment credits ?${expectedCredits.toFixed(
        2
      )} = current ?${current.toFixed(2)}.`
    );
  } catch (error) {
    fail("Financial conservation", error);
  }
  console.log("\nPAYMENT DEEP AUDIT RESULTS\n");
  for (const result of results) {
    console.log(
      `${result.status === "PASS" ? "PASS" : "FAIL"} ${result.name}`
    );
    console.log(`     ${result.detail}`);
  }
  const passCount = results.filter(
    (result) => result.status === "PASS"
  ).length;
  const failCount = results.filter(
    (result) => result.status === "FAIL"
  ).length;
  console.log(
    `TOTAL ${results.length} PASS ${passCount} FAIL ${failCount}`
  );
  await cleanupCurrentRunFinancials();

  await cleanup();

  const endingBalance = await walletBalance();

  console.log(
    `Wallet balance after cleanup: ?${endingBalance.toFixed(2)}`
  );
assert(
  endingBalance.eq(initialBalance),
  `Wallet balance was not restored. Starting ?${initialBalance.toFixed(
    2
  )}, ending ?${endingBalance.toFixed(2)}.`
);
  console.log(
    "Wallet balance restored exactly to starting balance."
  );
  console.log("");
  if (failCount > 0) {
    process.exitCode = 1;
  }
}
run()
  .catch((error) => {
    console.error("\nPAYMENT AUDIT RUNNER ERROR:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });









