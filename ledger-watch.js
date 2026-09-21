// ledger-watch.js — READ-ONLY. Records wallet ledger rows while the audit runs.
require("dotenv").config();
const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();

const userId = Number(process.argv[2] || 1);
const POLL_MS = 40;

const seen = new Map();
let startBalance;
let startMaxId = 0;
let stopping = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().slice(11, 23);

async function poll(walletId) {
  const rows = await prisma.walletTransaction.findMany({
    where: { walletId, id: { gt: startMaxId } },
    orderBy: { id: "asc" },
  });
  for (const row of rows) {
    if (!seen.has(row.id)) seen.set(row.id, { ...row, seenAt: stamp() });
  }
}

async function summarize(walletId) {
  const rows = [...seen.values()].sort((a, b) => a.id - b.id);
  let ledgerNet = new Prisma.Decimal(0);
  let prevAfter = startBalance;
  let prevId = startMaxId;

  const table = rows.map((row) => {
    const delta = row.balanceAfter.minus(row.balanceBefore);
    ledgerNet = ledgerNet.plus(delta);
    const line = {
      id: row.id,
      seenAt: row.seenAt,
      type: row.type,
      delta: delta.toString(),
      before: row.balanceBefore.toString(),
      after: row.balanceAfter.toString(),
      chain: prevAfter.eq(row.balanceBefore) ? "OK" : "BREAK",
      idGap: row.id - prevId - 1,
      txId: row.transactionId,
      ref: row.reference,
    };
    prevAfter = row.balanceAfter;
    prevId = row.id;
    return line;
  });

  console.table(table);

  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  const moved = wallet.balance.minus(startBalance);
  console.log("Start balance:             ", startBalance.toString());
  console.log("End balance:               ", wallet.balance.toString());
  console.log("Balance moved:             ", moved.toString());
  console.log("Net of ledger rows seen:   ", ledgerNet.toString());
  console.log("Unexplained (moved - net): ", moved.minus(ledgerNet).toString());
  console.log("Last row balanceAfter:     ", prevAfter.toString());
}

async function main() {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    console.log("No wallet for userId", userId);
    return;
  }

  const max = await prisma.walletTransaction.aggregate({ _max: { id: true } });
  startMaxId = max._max.id || 0;
  startBalance = wallet.balance;

  const counts = await prisma.walletTransaction.groupBy({
    by: ["walletId"],
    _count: { _all: true },
  });
  console.log(
    "Ledger rows per wallet:",
    counts.map((c) => `wallet ${c.walletId}: ${c._count._all}`).join(", ")
  );
  console.log(`Watching wallet ${wallet.id}, start balance ${startBalance}.`);
  console.log("Run the audit in another window, then press Ctrl+C here when it finishes.");

  process.on("SIGINT", () => {
    stopping = true;
  });

  while (!stopping) {
    await poll(wallet.id);
    await sleep(POLL_MS);
  }
  await poll(wallet.id);
  await summarize(wallet.id);
}

main()
  .catch((error) => console.error(error))
  .finally(() => prisma.$disconnect());