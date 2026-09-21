const { PrismaClient, Prisma } = require("@prisma/client");
const {
  purchaseAirtime,
  purchaseData,
  reconcileTransaction,
  disconnectVtuService,
} = require("./src/services/vtu");
const prisma = new PrismaClient();
const USER_ID = 1;
const NETWORK = "MTN";
const PHONE = "08012345678";
const PREFIX = "HOLISTIC-VTU-";
const results = [];
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
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function expectError(name, fn, expectedText) {
  try {
    await fn();
    fail(name, `Expected error containing "${expectedText}"`);
  } catch (error) {
    if (error.message.includes(expectedText)) {
      pass(name, error.message);
    } else {
      fail(name, `Expected "${expectedText}", received "${error.message}"`);
    }
  }
}
async function getWallet() {
  return prisma.wallet.findUnique({
    where: { userId: USER_ID },
    select: { id: true, balance: true },
  });
}
async function getTransaction(reference) {
  return prisma.transaction.findUnique({
    where: { reference },
    include: { walletTransaction: true },
  });
}
async function countWalletEntries(transactionId) {
  return prisma.walletTransaction.count({
    where: { transactionId },
  });
}
async function cleanup() {
  const { reverseWalletTransaction } = require("./src/services/wallet");

  const transactions = await prisma.transaction.findMany({
    where: {
      reference: { startsWith: PREFIX },
    },
    include: {
      walletTransaction: true,
    },
  });

  // Reverse every successful test transaction that actually debited the wallet.
  for (const transaction of transactions) {
    if (
      transaction.status === "SUCCESS" &&
      transaction.walletTransaction &&
      transaction.walletTransaction.type === "DEBIT"
    ) {
      const reversalReference =
        `HOLISTIC-VTU-REVERSAL-${transaction.id}`;

      // Idempotent cleanup: don't create the same reversal twice.
      const existingReversal =
        await prisma.walletTransaction.findUnique({
          where: {
            reference: reversalReference,
          },
        });

      if (!existingReversal) {
        await reverseWalletTransaction({
          userId: transaction.userId,
          amount: transaction.walletTransaction.amount,
          reference: reversalReference,
          description:
            `Holistic VTU test cleanup reversal for transaction ${transaction.reference}`,
        });
      }
    }
  }

  // Now it is safe to remove the test ledger/transaction records.
  const ids = transactions.map((t) => t.id);

  if (ids.length) {
    await prisma.walletTransaction.deleteMany({
      where: {
        transactionId: { in: ids },
      },
    });

    await prisma.transaction.deleteMany({
      where: {
        id: { in: ids },
      },
    });
  }
}
async function run() {
  console.log("\n========================================");
  console.log("       VTU HOLISTIC SERVICE AUDIT");
  console.log("========================================\n");
  await cleanup();
  const initialWallet = await getWallet();
  assert(initialWallet, "Wallet not found.");
  const initialBalance = new Prisma.Decimal(initialWallet.balance);
  console.log(
    `Starting wallet balance: ?${initialBalance.toFixed(2)}\n`
  );
  // 1. AIRTIME SUCCESS
  try {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const ref = PREFIX + "AIRTIME-SUCCESS-001";
    const tx = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    const saved = await getTransaction(ref);
    const wallet = await getWallet();
    const entries = await countWalletEntries(tx.id);
    assert(saved.status === "SUCCESS", `Expected SUCCESS, got ${saved.status}`);
    assert(entries === 1, `Expected 1 wallet entry, got ${entries}`);
    assert(
      new Prisma.Decimal(wallet.balance).eq(initialBalance.minus(100)),
      "Wallet was not debited exactly ?100."
    );
    pass("Airtime SUCCESS", "Exactly one wallet debit.");
  } catch (error) {
    fail("Airtime SUCCESS", error);
  }
  // 2. AIRTIME DUPLICATE
  try {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const ref = PREFIX + "AIRTIME-SUCCESS-001";
    const before = await getWallet();
    const tx = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    const after = await getWallet();
    const entries = await countWalletEntries(tx.id);
    assert(tx.status === "SUCCESS", `Expected SUCCESS, got ${tx.status}`);
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Duplicate request changed wallet balance."
    );
    assert(entries === 1, `Expected 1 wallet entry, got ${entries}`);
    pass("Airtime duplicate/idempotency", "No second debit.");
  } catch (error) {
    fail("Airtime duplicate/idempotency", error);
  }
  // 3. AIRTIME FAILED
  try {
    process.env.MOCK_PROVIDER_MODE = "FAILED";
    const ref = PREFIX + "AIRTIME-FAILED-001";
    const before = await getWallet();
    const tx = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    const after = await getWallet();
    assert(tx.status === "FAILED", `Expected FAILED, got ${tx.status}`);
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Failed transaction changed wallet balance."
    );
    pass("Airtime FAILED", "No debit.");
  } catch (error) {
    fail("Airtime FAILED", error);
  }
  // 4. AIRTIME PENDING
  try {
    process.env.MOCK_PROVIDER_MODE = "PENDING";
    const ref = PREFIX + "AIRTIME-PENDING-001";
    const before = await getWallet();
    const tx = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    const after = await getWallet();
    assert(
      tx.status === "PROCESSING",
      `Expected PROCESSING, got ${tx.status}`
    );
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Pending transaction changed wallet balance."
    );
    pass("Airtime PENDING", "Remains PROCESSING; no debit.");
  } catch (error) {
    fail("Airtime PENDING", error);
  }
  // 5. PROVIDER ERROR
  try {
    process.env.MOCK_PROVIDER_MODE = "ERROR";
    const ref = PREFIX + "AIRTIME-ERROR-001";
    const before = await getWallet();
    const tx = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    const after = await getWallet();
    assert(
      tx.status === "PROCESSING",
      `Expected PROCESSING, got ${tx.status}`
    );
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Provider error changed wallet balance."
    );
    pass("Provider ERROR", "Remains PROCESSING; no debit.");
  } catch (error) {
    fail("Provider ERROR", error);
  }
  // 6. RECONCILIATION SUCCESS
  try {
    const ref = PREFIX + "RECON-SUCCESS-001";
    process.env.MOCK_PROVIDER_MODE = "PENDING";
    const before = await getWallet();
    const pending = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    assert(
      pending.status === "PROCESSING",
      `Expected initial PROCESSING, got ${pending.status}`
    );
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const tx = await reconcileTransaction(ref);
    const after = await getWallet();
    const saved = await getTransaction(ref);
    const entries = await countWalletEntries(saved.id);
    assert(tx.status === "SUCCESS", `Expected SUCCESS, got ${tx.status}`);
    assert(entries === 1, `Expected 1 wallet entry, got ${entries}`);
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance).minus(100)
      ),
      "Reconciliation did not debit exactly ?100."
    );
    pass(
      "Reconciliation ? SUCCESS",
      "PROCESSING completed and debited once."
    );
  } catch (error) {
    fail("Reconciliation ? SUCCESS", error);
  }
  // 7. RECONCILIATION FAILED
  try {
    const ref = PREFIX + "RECON-FAILED-001";
    process.env.MOCK_PROVIDER_MODE = "PENDING";
    const before = await getWallet();
    const pending = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    assert(
      pending.status === "PROCESSING",
      `Expected PROCESSING, got ${pending.status}`
    );
    process.env.MOCK_PROVIDER_MODE = "FAILED";
    const tx = await reconcileTransaction(ref);
    const after = await getWallet();
    assert(tx.status === "FAILED", `Expected FAILED, got ${tx.status}`);
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Reconciliation FAILED changed wallet."
    );
    pass("Reconciliation ? FAILED", "No debit.");
  } catch (error) {
    fail("Reconciliation ? FAILED", error);
  }
  // 8. RECONCILIATION PENDING
  try {
    const ref = PREFIX + "RECON-PENDING-001";
    process.env.MOCK_PROVIDER_MODE = "PENDING";
    const pending = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    const tx = await reconcileTransaction(ref);
    assert(
      pending.status === "PROCESSING",
      `Expected initial PROCESSING, got ${pending.status}`
    );
    assert(
      tx.status === "PROCESSING",
      `Expected PROCESSING, got ${tx.status}`
    );
    pass("Reconciliation ? PENDING", "Remains PROCESSING.");
  } catch (error) {
    fail("Reconciliation ? PENDING", error);
  }
  // 9. DATA SUCCESS + PROFIT
  try {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const ref = PREFIX + "DATA-SUCCESS-001";
    const before = await getWallet();
    const tx = await purchaseData({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      dataPlanId: 1,
      reference: ref,
    });
    const saved = await getTransaction(ref);
    const after = await getWallet();
    const entries = await countWalletEntries(tx.id);
    assert(saved.status === "SUCCESS", `Expected SUCCESS, got ${saved.status}`);
    assert(entries === 1, `Expected 1 wallet entry, got ${entries}`);
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance).minus(350)
      ),
      "Data purchase did not debit ?350."
    );
    assert(
      new Prisma.Decimal(saved.providerCost).eq(300),
      `Expected provider cost ?300, got ${saved.providerCost}`
    );
    assert(
      new Prisma.Decimal(saved.profit).eq(50),
      `Expected profit ?50, got ${saved.profit}`
    );
    pass("Data SUCCESS + profit", "?350 debit, ?300 cost, ?50 profit.");
  } catch (error) {
    fail("Data SUCCESS + profit", error);
  }
  // 10. DATA FAILED
  try {
    process.env.MOCK_PROVIDER_MODE = "FAILED";
    const ref = PREFIX + "DATA-FAILED-001";
    const before = await getWallet();
    const tx = await purchaseData({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      dataPlanId: 1,
      reference: ref,
    });
    const after = await getWallet();
    assert(tx.status === "FAILED", `Expected FAILED, got ${tx.status}`);
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Failed data purchase changed wallet."
    );
    pass("Data FAILED", "No debit.");
  } catch (error) {
    fail("Data FAILED", error);
  }
  // 11. DATA PENDING
  try {
    process.env.MOCK_PROVIDER_MODE = "PENDING";
    const ref = PREFIX + "DATA-PENDING-001";
    const before = await getWallet();
    const tx = await purchaseData({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      dataPlanId: 1,
      reference: ref,
    });
    const after = await getWallet();
    assert(
      tx.status === "PROCESSING",
      `Expected PROCESSING, got ${tx.status}`
    );
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Pending data purchase changed wallet."
    );
    pass("Data PENDING", "No debit.");
  } catch (error) {
    fail("Data PENDING", error);
  }
  // 12. DATA DUPLICATE
  try {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const ref = PREFIX + "DATA-DUPLICATE-001";
    const first = await purchaseData({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      dataPlanId: 1,
      reference: ref,
    });
    const beforeRetry = await getWallet();
    const second = await purchaseData({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      dataPlanId: 1,
      reference: ref,
    });
    const afterRetry = await getWallet();
    const entries = await countWalletEntries(first.id);
    assert(second.id === first.id, "Duplicate returned another transaction.");
    assert(
      new Prisma.Decimal(afterRetry.balance).eq(
        new Prisma.Decimal(beforeRetry.balance)
      ),
      "Duplicate caused another debit."
    );
    assert(entries === 1, `Expected 1 wallet entry, got ${entries}`);
    pass("Data duplicate/idempotency", "No second debit.");
  } catch (error) {
    fail("Data duplicate/idempotency", error);
  }
  // 13. INVALID DATA PLAN
  await expectError(
    "Invalid data plan",
    () =>
      purchaseData({
        userId: USER_ID,
        networkCode: NETWORK,
        phoneNumber: PHONE,
        dataPlanId: 999999,
        reference: PREFIX + "INVALID-PLAN-001",
      }),
    "Data plan not found"
  );
  // 14. INVALID PHONE
  await expectError(
    "Invalid phone validation",
    () =>
      purchaseAirtime({
        userId: USER_ID,
        networkCode: NETWORK,
        phoneNumber: "12345",
        amount: 100,
        reference: PREFIX + "INVALID-PHONE-001",
      }),
    "valid Nigerian 11-digit number"
  );
  // 15. INVALID AMOUNT
  await expectError(
    "Invalid amount validation",
    () =>
      purchaseAirtime({
        userId: USER_ID,
        networkCode: NETWORK,
        phoneNumber: PHONE,
        amount: 0,
        reference: PREFIX + "INVALID-AMOUNT-001",
      }),
    "greater than zero"
  );
  // 16. INVALID USER
  await expectError(
    "Invalid user validation",
    () =>
      purchaseAirtime({
        userId: 999999,
        networkCode: NETWORK,
        phoneNumber: PHONE,
        amount: 100,
        reference: PREFIX + "INVALID-USER-001",
      }),
    "User not found"
  );
  // 17. INVALID NETWORK
  await expectError(
    "Invalid network validation",
    () =>
      purchaseAirtime({
        userId: USER_ID,
        networkCode: "NOT-A-NETWORK",
        phoneNumber: PHONE,
        amount: 100,
        reference: PREFIX + "INVALID-NETWORK-001",
      }),
    "Network not found or inactive"
  );
  // 18. ALREADY SUCCESSFUL RECONCILIATION
  try {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const ref = PREFIX + "ALREADY-SUCCESS-001";
    const first = await purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: 100,
      reference: ref,
    });
    const before = await getWallet();
    const second = await reconcileTransaction(ref);
    const after = await getWallet();
    assert(first.status === "SUCCESS", "Initial transaction was not SUCCESS.");
    assert(second.status === "SUCCESS", "Status changed unexpectedly.");
    assert(
      new Prisma.Decimal(after.balance).eq(
        new Prisma.Decimal(before.balance)
      ),
      "Already-successful transaction was debited again."
    );
    pass("Already SUCCESS reconciliation", "No duplicate debit.");
  } catch (error) {
    fail("Already SUCCESS reconciliation", error);
  }
  // 19. FINANCIAL LEDGER INTEGRITY
  try {
    const transactions = await prisma.transaction.findMany({
      where: { reference: { startsWith: PREFIX } },
      include: { walletTransaction: true },
    });
    const successful = transactions.filter(
      (t) => t.status === "SUCCESS"
    );
    for (const tx of successful) {
      const entries = await countWalletEntries(tx.id);
      assert(
        entries === 1,
        `${tx.reference} has ${entries} wallet entries.`
      );
      assert(
        tx.walletTransaction !== null,
        `${tx.reference} has no linked wallet transaction.`
      );
      assert(
        tx.walletTransaction.type === "DEBIT",
        `${tx.reference} wallet transaction is not DEBIT.`
      );
    }
    pass(
      "Final wallet-ledger integrity",
      `${successful.length} successful transactions verified.`
    );
  } catch (error) {
    fail("Final wallet-ledger integrity", error);
  }
  console.log("\n========================================");
  console.log("RESULTS");
  console.log("========================================");
  for (const result of results) {
    console.log(
      `${result.status.padEnd(6)} ${result.name}`
    );
    if (result.detail) {
      console.log(`       ${result.detail}`);
    }
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log("\n========================================");
  console.log(`TOTAL : ${results.length}`);
  console.log(`PASS  : ${passed}`);
  console.log(`FAIL  : ${failed}`);
  console.log("========================================");
  await cleanup();
  const restoredWallet = await getWallet();
  console.log(
    `\nWallet balance after cleanup: ?${new Prisma.Decimal(
      restoredWallet.balance
    ).toFixed(2)}`
  );
  if (failed > 0) process.exitCode = 1;
}
run()
  .catch((error) => {
    console.error("\nHOLISTIC TEST RUNNER ERROR:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectVtuService().catch(() => {});
  });
