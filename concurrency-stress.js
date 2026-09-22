// concurrency-stress.js — hammers purchaseAirtime() with the same
// reference from N concurrent callers, repeated for many rounds.
// Verifies: exactly one transaction, exactly one debit, wallet moves
// by exactly the purchase amount, every round. Cleans up after itself.

require("dotenv").config();
const { PrismaClient, Prisma } = require("@prisma/client");
const { purchaseAirtime } = require("./src/services/vtu");
const { creditWallet } = require("./src/services/wallet");

const prisma = new PrismaClient();

const USER_ID = Number(process.argv[2] || 1);
const ROUNDS = Number(process.argv[3] || 50);
const CONCURRENCY = Number(process.argv[4] || 5);
const NETWORK = "MTN";
const PHONE = "08012345678";
const AMOUNT = 100;
const PREFIX = "STRESS-";
const RUN_ID = Date.now();

async function walletBalance() {
  const wallet = await prisma.wallet.findUnique({ where: { userId: USER_ID } });
  return { wallet, balance: new Prisma.Decimal(wallet.balance) };
}

async function runRound(roundNum) {
  const ref = `${PREFIX}${RUN_ID}-${roundNum}`;
  const before = (await walletBalance()).balance;

  const callers = Array.from({ length: CONCURRENCY }, () =>
    purchaseAirtime({
      userId: USER_ID,
      networkCode: NETWORK,
      phoneNumber: PHONE,
      amount: AMOUNT,
      reference: ref,
    }).then(
      (result) => ({ ok: true, result, at: Date.now() }),
      (error) => ({ ok: false, error: error.message, at: Date.now() })
    )
  );

  const settled = await Promise.all(callers);
  const after = (await walletBalance()).balance;

  const ids = new Set(settled.filter((s) => s.ok).map((s) => s.result.id));
  const statuses = settled.map((s) => (s.ok ? s.result.status : "ERROR:" + s.error));

  const transactions = await prisma.transaction.findMany({
    where: { reference: ref },
    include: { walletTransaction: true },
  });

  const problems = [];

  if (ids.size > 1) {
    problems.push(`Multiple transaction IDs returned: ${[...ids].join(", ")}`);
  }
  if (transactions.length !== 1) {
    problems.push(`Expected 1 transaction row, found ${transactions.length}`);
  }
  const debitCount = transactions.filter(
    (t) => t.walletTransaction && t.walletTransaction.type === "DEBIT"
  ).length;
  if (transactions.length && transactions[0].status === "SUCCESS" && debitCount !== 1) {
    problems.push(`SUCCESS transaction has ${debitCount} debit ledger rows, expected 1`);
  }

  const finalTx = transactions[0];
  const expectedDelta =
    finalTx && finalTx.status === "SUCCESS" ? new Prisma.Decimal(0).minus(AMOUNT) : new Prisma.Decimal(0);
  const actualDelta = after.minus(before);
  if (!actualDelta.eq(expectedDelta)) {
    problems.push(
      `Wallet moved ${actualDelta.toString()}, expected ${expectedDelta.toString()} (tx status: ${
        finalTx ? finalTx.status : "none"
      })`
    );
  }

  // Cleanup: reverse if a debit exists, then delete this round's rows.
  if (finalTx && finalTx.status === "SUCCESS" && debitCount === 1) {
    await creditWallet({
      userId: USER_ID,
      amount: AMOUNT,
      reference: `${PREFIX}REVERSAL-${RUN_ID}-${roundNum}`,
      description: "Stress test cleanup reversal",
      type: "REVERSAL",
    });
  }
  await prisma.walletTransaction.deleteMany({
    where: {
      OR: [
        { transactionId: { in: transactions.map((t) => t.id) } },
        { reference: `${PREFIX}REVERSAL-${RUN_ID}-${roundNum}` },
      ],
    },
  });
  await prisma.transaction.deleteMany({ where: { reference: ref } });

  return { roundNum, statuses, problems, before: before.toString(), after: after.toString() };
}

async function main() {
  console.log(
    `Stress-testing purchaseAirtime(): ${ROUNDS} rounds x ${CONCURRENCY} concurrent callers, userId ${USER_ID}\n`
  );

  let failures = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    const result = await runRound(i);
    if (result.problems.length) {
      failures++;
      console.log(`Round ${i}: FAIL`);
      console.log(`  statuses: ${result.statuses.join(", ")}`);
      console.log(`  before=${result.before} after=${result.after}`);
      result.problems.forEach((p) => console.log(`  - ${p}`));
    } else if (i % 10 === 0 || i === 1) {
      console.log(`Round ${i}: OK`);
    }
  }

  console.log(`\nDone. ${ROUNDS - failures}/${ROUNDS} rounds clean, ${failures} with problems.`);

  const { balance } = await walletBalance();
  console.log(`Final wallet balance: ${balance.toString()}`);
}

main()
  .catch((error) => console.error("STRESS TEST RUNNER ERROR:", error))
  .finally(() => prisma.$disconnect());