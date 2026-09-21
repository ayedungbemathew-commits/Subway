const fs = require("fs");
const { PrismaClient, Prisma } = require("@prisma/client");
const {
  purchaseAirtime,
  purchaseData,
  reconcileTransaction,
  disconnectVtuService,
} = require("./src/services/vtu");
const {
  getWallet,
  debitWallet,
  creditWallet,
  disconnectWalletEngine,
} = require("./src/services/wallet");
const MockProvider = require("./src/providers/mockProvider");
const prisma = new PrismaClient();
const USER_ID = 1;
const NETWORK = "MTN";
const PHONE = "08012345678";
const PREFIX = "DEEP-VTU-AUDIT-";
const RUN_ID = Date.now();
const results = [];
const currentRunTransactionIds = new Set();

function trackTransaction(transaction) {
  if (transaction?.id) {
    currentRunTransactionIds.add(transaction.id);
  }

  return transaction;
}
function pass(name, detail = "") {
  results.push({ name, status: "PASS", detail });
}
function fail(name, error) {
  results.push({
    name,
    status: "FAIL",
    detail: error instanceof Error ? error.message : String(error),
  });
}
async function maxLedgerId() {
  const max = await prisma.walletTransaction.aggregate({
    _max: { id: true },
  });
  return max._max.id || 0;
}

async function warnIfLedgerDrift() {
  const wallet = await prisma.wallet.findUnique({
    where: { userId: USER_ID },
  });
  const last = await prisma.walletTransaction.findFirst({
    where: { walletId: wallet.id },
    orderBy: { id: "desc" },
  });
  if (last && !last.balanceAfter.eq(wallet.balance)) {
    console.log(
      `WARNING: wallet balance ${wallet.balance} differs from last ledger balanceAfter ${last.balanceAfter}. A previous run may have left residue.\n`
    );
  }
}

async function snapshotLedger(sinceId) {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: USER_ID },
    });
    const ledger = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, id: { gt: sinceId } },
      orderBy: { id: "asc" },
    });
    const transactions = await prisma.transaction.findMany({
      where: { id: { in: [...currentRunTransactionIds] } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        amount: true,
        refunded: true,
        createdAt: true,
      },
    });
    const file = `audit-failure-${RUN_ID}.json`;
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          runId: RUN_ID,
          walletBalance: wallet.balance,
          trackedTransactionIds: [...currentRunTransactionIds],
          transactions,
          ledger,
        },
        null,
        2
      )
    );
    console.log(`Ledger snapshot saved to ${file}`);
  } catch (error) {
    console.log("Could not save ledger snapshot:", error.message);
  }
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
async function countTransactions(reference) {
  return prisma.transaction.count({
    where: { reference },
  });
}
async function countWalletEntries(transactionId) {
  return prisma.walletTransaction.count({
    where: { transactionId },
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
  console.log("       VTU DEEP FINANCIAL AUDIT");
  console.log("========================================\n");
  await cleanup();
  const initialBalance = await walletBalance();
  console.log(
    `Starting wallet balance: ?${initialBalance.toFixed(2)}\n`
  );const ledgerBaseline = await maxLedgerId();
await warnIfLedgerDrift();
  /*
   * 1. INSUFFICIENT WALLET BALANCE
   *
   * Temporarily reduce the wallet to a balance below the
   * purchase amount using the normal wallet service.
   */
  let setupDebit = null;
const setupReference =
  `${PREFIX}SETUP-LOW-BALANCE-${RUN_ID}`;
const restoreReference =
  `${PREFIX}SETUP-LOW-BALANCE-RESTORE-${RUN_ID}`;

try {
    const current = await walletBalance();
    const targetBalance = new Prisma.Decimal("10.00");
    const reduction = current.minus(targetBalance);
    assert(reduction.gt(0), "Wallet balance is already too low for setup.");
    setupDebit = await debitWallet({
      userId: USER_ID,
      amount: reduction,
     reference: setupReference,
      description: "Temporary balance reduction for deep audit",
    });
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const before = await walletBalance();
    const ref = PREFIX + "INSUFFICIENT-BALANCE-001";
    const tx = trackTransaction(await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    }))
    const after = await walletBalance();
    assert(
      tx.status === "FAILED",
      `Expected FAILED, received ${tx.status}.`
    );
    assert(
      after.eq(before),
      `Wallet changed from ${before} to ${after}.`
    );
    assert(
      tx.failureReason === "Insufficient wallet balance.",
      `Unexpected failure reason: ${tx.failureReason}`
    );
    const entries = await countWalletEntries(tx.id);
    assert(
      entries === 0,
      `Expected zero wallet entries, found ${entries}.`
    );
    pass(
      "Insufficient wallet balance",
      "Provider success cannot create a wallet debit when funds are insufficient."
    );
  } catch (error) {
    fail("Insufficient wallet balance", error);
  } finally {
  if (setupDebit) {
    await creditWallet({
      userId: USER_ID,
      amount: setupDebit.amount,
      reference: restoreReference,
      description: "Restore temporary deep audit balance reduction",
      type: "REVERSAL",
    }).catch(() => {});

    await prisma.walletTransaction.deleteMany({
      where: {
        reference: {
          in: [setupReference, restoreReference],
        },
      },
    });
  }
}
  /*
   * 2. SAME REFERENCE WITH DIFFERENT PARAMETERS
   */
  try {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const ref = PREFIX + "REFERENCE-CONFLICT-001";
    const first = trackTransaction(await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    }))
    const second = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: "08098765432",
      amount: 200,
      reference: ref,
    });
    assert(
      first.id === second.id,
      "Same reference created or returned different transaction."
    );
    assert(
      new Prisma.Decimal(second.amount).eq(100),
      `Existing transaction amount changed unexpectedly: ${second.amount}`
    );
    assert(
      second.phoneNumber === PHONE,
      "Existing transaction parameters were replaced."
    );
    const count = await countTransactions(ref);
    assert(
      count === 1,
      `Expected one transaction, found ${count}.`
    );
    pass(
      "Same reference with different parameters",
      "Existing transaction was returned without creating or mutating a second transaction."
    );
  } catch (error) {
    fail("Same reference with different parameters", error);
  }
  /*
 * 3. CONCURRENT DUPLICATE REQUESTS
 */
try {
  process.env.MOCK_PROVIDER_MODE = "SUCCESS";

  const ref = PREFIX + "CONCURRENT-001";

  const before = await walletBalance();

  const [a, b] = await Promise.all([
    purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    }),
    purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    }),
  ]);
  trackTransaction(a);
  trackTransaction(b);


  const transactions = await prisma.transaction.findMany({
    where: { reference: ref },
    include: { walletTransaction: true },
  });

  assert(
    a.id === b.id,
    `Concurrent requests returned different IDs: ${a.id} and ${b.id}`
  );

  assert(
    transactions.length === 1,
    `Expected exactly one transaction, found ${transactions.length}.`
  );

  const transaction = transactions[0];

  assert(
    transaction.status === "SUCCESS",
    `Final transaction status is ${transaction.status}.`
  );

  const entries = await countWalletEntries(transaction.id);

  assert(
    entries === 1,
    `Expected exactly one wallet debit, found ${entries}.`
  );

  const after = await walletBalance();

  assert(
    after.eq(before.minus(100)),
    `Expected exactly one ?100 debit. Balance changed ${before} ? ${after}.`
  );

  pass(
    "Concurrent duplicate requests",
    `One transaction (${transaction.id}), one wallet debit, final status SUCCESS.`
  );
} catch (error) {
  fail("Concurrent duplicate requests", error);
}
  /*
   * 4. UNKNOWN PROVIDER STATUS
   *
   * Temporarily override the mock adapter's response without
   * changing production code.
   */
  /*
 * 4. UNKNOWN PROVIDER STATUS
 *
 * Temporarily override the mock adapter's response without
 * changing production code. Always restore the original method,
 * including when an assertion or purchase throws.
 */
let originalPurchase = null;

try {
  originalPurchase = MockProvider.prototype.purchaseAirtime;

  MockProvider.prototype.purchaseAirtime = async function () {
    return {
      success: false,
      status: "UNKNOWN",
      providerReference: "MOCK-UNKNOWN",
      providerResponse: {
        provider: "MOCK",
        message: "Simulated unknown provider state.",
      },
    };
  };

  const before = await walletBalance();
  const ref = PREFIX + "UNKNOWN-STATUS-001";

  const tx = trackTransaction(await purchaseAirtime({
    userId: USER_ID,
    networkCode: NETWORK,
    phoneNumber: PHONE,
    amount: 100,
    reference: ref,
  }))

  const after = await walletBalance();

  assert(
    tx.status === "PROCESSING",
    `Expected PROCESSING, received ${tx.status}.`
  );

  assert(
    after.eq(before),
    "Unknown provider status caused a wallet movement."
  );

  pass(
    "Unknown provider status",
    "Unknown provider state remains PROCESSING with no wallet debit."
  );
} catch (error) {
  fail("Unknown provider status", error);
} finally {
  if (originalPurchase) {
    MockProvider.prototype.purchaseAirtime = originalPurchase;
  }
}
  /*
   * 5. PROVIDER ERROR FOLLOWED BY RECONCILIATION
   */
  try {
    process.env.MOCK_PROVIDER_MODE = "ERROR";
    const ref = PREFIX + "ERROR-RECONCILE-001";
    const initial = await walletBalance();
    const tx = trackTransaction(await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    }))
    assert(
      tx.status === "PROCESSING",
      `Expected PROCESSING after provider error, got ${tx.status}.`
    );
    const afterError = await walletBalance();
    assert(
      afterError.eq(initial),
      "Provider error caused a wallet debit."
    );
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const reconciled = trackTransaction(await reconcileTransaction(ref));
    const afterReconcile = await walletBalance();
    assert(
      reconciled.status === "SUCCESS",
      `Expected SUCCESS after reconciliation, got ${reconciled.status}.`
    );
    assert(
      afterReconcile.eq(initial.minus(100)),
      `Expected one ?100 debit. Balance: ${afterReconcile}`
    );
    const entries = await countWalletEntries(reconciled.id);
    assert(
      entries === 1,
      `Expected one wallet entry, found ${entries}.`
    );
    pass(
      "Provider error followed by reconciliation",
      "Processing transaction later completed with exactly one debit."
    );
  } catch (error) {
    fail("Provider error followed by reconciliation", error);
  }
  /*
   * 6. REPEATED RECONCILIATION
   */
  try {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const ref = PREFIX + "REPEATED-RECONCILE-001";
    const tx = trackTransaction(await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    }))
    const before = await walletBalance();
    const first = await reconcileTransaction(ref);
    const second = await reconcileTransaction(ref);
    const third = await reconcileTransaction(ref);
    const after = await walletBalance();
    assert(first.status === "SUCCESS", "First reconciliation failed.");
    assert(second.status === "SUCCESS", "Second reconciliation failed.");
    assert(third.status === "SUCCESS", "Third reconciliation failed.");
    assert(
      after.eq(before),
      "Repeated reconciliation changed the wallet."
    );
    const entries = await countWalletEntries(tx.id);
    assert(
      entries === 1,
      `Expected one wallet entry, found ${entries}.`
    );
    pass(
      "Repeated reconciliation",
      "Multiple reconciliation attempts produced no duplicate debit."
    );
  } catch (error) {
    fail("Repeated reconciliation", error);
  }
  /*
   * 7. INACTIVE DATA PLAN
   */
  let originalPlanStatus = null;
  try {
    const plan = await prisma.dataPlan.findUnique({
      where: { id: 1 },
    });
    assert(plan, "Data plan 1 not found.");
    originalPlanStatus = plan.status;
    await prisma.dataPlan.update({
      where: { id: 1 },
      data: { status: "INACTIVE" },
    });
    const before = await walletBalance();
    let rejected = false;
    try {
      await purchaseData({
        userId: USER_ID,
        networkCode: NETWORK,
        phoneNumber: PHONE,
        dataPlanId: 1,
        reference: PREFIX + "INACTIVE-PLAN-001",
      });
    } catch (error) {
      rejected = true;
      assert(
        error.message === "Data plan not found or inactive.",
        `Unexpected error: ${error.message}`
      );
    }
    const after = await walletBalance();
    assert(rejected, "Inactive data plan was accepted.");
    assert(after.eq(before), "Inactive plan changed wallet balance.");
    const count = await countTransactions(
      PREFIX + "INACTIVE-PLAN-001"
    );
    assert(
      count === 0,
      `Expected zero transaction records, found ${count}.`
    );
    pass(
      "Inactive data plan",
      "Inactive plan rejected without transaction or wallet movement."
    );
  } catch (error) {
    fail("Inactive data plan", error);
  } finally {
    if (originalPlanStatus) {
      await prisma.dataPlan.update({
        where: { id: 1 },
        data: { status: originalPlanStatus },
      });
    }
  }
  /*
   * 8. INACTIVE USER
   */
  let originalUserStatus = null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: USER_ID },
      select: { status: true },
    });
    assert(user, "Test user not found.");
    originalUserStatus = user.status;
    await prisma.user.update({
      where: { id: USER_ID },
      data: { status: "SUSPENDED" },
    });
    const before = await walletBalance();
    let rejected = false;
    try {
      await purchaseAirtime({
        userId: USER_ID,
        networkCode: NETWORK,
        phoneNumber: PHONE,
        amount: 100,
        reference: PREFIX + "INACTIVE-USER-001",
      });
    } catch (error) {
      rejected = true;
      assert(
        error.message === "User account is not active.",
        `Unexpected error: ${error.message}`
      );
    }
    const after = await walletBalance();
    assert(rejected, "Inactive user was accepted.");
    assert(after.eq(before), "Inactive user changed wallet balance.");
    pass(
      "Inactive user",
      "Suspended user rejected without wallet movement."
    );
  } catch (error) {
    fail("Inactive user", error);
  } finally {
    if (originalUserStatus) {
      await prisma.user.update({
        where: { id: USER_ID },
        data: { status: originalUserStatus },
      });
    }
  }
  /*
   * 9. NO ACTIVE PROVIDER
   */
  let providerStatuses = [];
  try {
    const providers = await prisma.provider.findMany({
      select: { id: true, status: true },
    });
    assert(
      providers.length > 0,
      "No providers exist."
    );
    providerStatuses = providers;
    await prisma.provider.updateMany({
      data: { status: "INACTIVE" },
    });
    const before = await walletBalance();
    let rejected = false;
    try {
      await purchaseAirtime({
        userId: USER_ID,
        networkCode: NETWORK,
        phoneNumber: PHONE,
        amount: 100,
        reference: PREFIX + "NO-PROVIDER-001",
      });
    } catch (error) {
      rejected = true;
      assert(
        error.message === "No active VTU provider is available.",
        `Unexpected error: ${error.message}`
      );
    }
    const after = await walletBalance();
    assert(rejected, "Purchase succeeded with no active provider.");
    assert(after.eq(before), "No-provider test changed wallet balance.");
    pass(
      "No active provider",
      "Purchase rejected before transaction creation or wallet debit."
    );
  } catch (error) {
    fail("No active provider", error);
  } finally {
    for (const provider of providerStatuses) {
      await prisma.provider.update({
        where: { id: provider.id },
        data: { status: provider.status },
      });
    }
  }/*
 * 10. FINAL FINANCIAL CONSERVATION
 */
try {
  const current = await walletBalance();

  const currentRunTransactionIdList = [
    ...currentRunTransactionIds,
  ];

  const successfulTestTransactions =
    currentRunTransactionIdList.length
      ? await prisma.transaction.findMany({
          where: {
            id: {
              in: currentRunTransactionIdList,
            },
            status: "SUCCESS",
          },
          include: {
            walletTransaction: true,
          },
        })
      : [];

  let expectedDebits = new Prisma.Decimal("0.00");

  for (const transaction of successfulTestTransactions) {
    if (
      transaction.walletTransaction &&
      transaction.walletTransaction.type === "DEBIT"
    ) {
      expectedDebits = expectedDebits.plus(
        transaction.walletTransaction.amount
      );
    }
  }

  const expectedBalance =
    initialBalance.minus(expectedDebits);

  assert(
    current.eq(expectedBalance),
    `Financial conservation failed. Expected ?${expectedBalance.toFixed(
      2
    )}, found ?${current.toFixed(2)}.`
  );

  pass(
    "Pre-cleanup financial conservation",
    `Starting ?${initialBalance.toFixed(
      2
    )} - test debits ?${expectedDebits.toFixed(
      2
    )} = current ?${current.toFixed(2)}.`
  );
} catch (error) {
  fail("Pre-cleanup financial conservation", error);
}

console.log("\nDEEP AUDIT RESULTS");

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
if (failCount > 0 || process.env.AUDIT_FORCE_SNAPSHOT) {
  await snapshotLedger(ledgerBaseline);
}
await cleanup();

const finalBalance = await walletBalance();

console.log(
  `Wallet balance after cleanup: ?${finalBalance.toFixed(2)}`
);

assert(
  finalBalance.eq(initialBalance),
  `Wallet balance was not restored. Starting ?${initialBalance.toFixed(
    2
  )}, ending ?${finalBalance.toFixed(2)}.`
);

console.log("Wallet balance restored exactly to starting balance.");
console.log("");

if (failCount > 0) {
  process.exitCode = 1;
}
}

run()
  .catch((error) => {
    console.error("\nDEEP AUDIT RUNNER ERROR:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectVtuService().catch(() => {});
  });







