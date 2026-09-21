// ledger-check.js — READ-ONLY. Uses findUnique/findMany only.
require("dotenv").config();
const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const userIdArg = process.argv[2];
  const limit = Number(process.argv[3] || 40);

  const wallet = userIdArg
    ? await prisma.wallet.findUnique({ where: { userId: Number(userIdArg) } })
    : await prisma.wallet.findFirst({ orderBy: { updatedAt: "desc" } });

  if (!wallet) {
    console.log("No wallet found.");
    return;
  }

  const rows = (
    await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { id: "desc" },
      take: limit,
      include: {
        transaction: {
          select: { id: true, reference: true, type: true, status: true, amount: true },
        },
      },
    })
  ).reverse();

  let linkedDebits = new Prisma.Decimal(0);
  let orphanDebits = new Prisma.Decimal(0);

  const table = rows.map((row, i) => {
    const prev = rows[i - 1];
    const chain =
      i === 0 ? "-" : prev.balanceAfter.eq(row.balanceBefore) ? "OK" : "BREAK";

    if (row.type === "DEBIT") {
      if (row.transactionId && row.transaction) {
        linkedDebits = linkedDebits.plus(row.amount);
      } else {
        orphanDebits = orphanDebits.plus(row.amount);
      }
    }

    return {
      id: row.id,
      at: row.createdAt.toISOString().slice(11, 23),
      type: row.type,
      status: row.status,
      amount: row.amount.toString(),
      before: row.balanceBefore.toString(),
      after: row.balanceAfter.toString(),
      chain,
      txId: row.transactionId,
      txStatus: row.transaction ? row.transaction.status : "NO-TX",
      ref: row.reference,
    };
  });

  console.table(table);

  const last = rows[rows.length - 1];
  console.log("Wallet id:              ", wallet.id, "(userId " + wallet.userId + ")");
  console.log("Current wallet balance: ", wallet.balance.toString());
  console.log("Last ledger balanceAfter:", last ? last.balanceAfter.toString() : "n/a");
  console.log("Linked DEBIT total:     ", linkedDebits.toString());
  console.log("Orphan DEBIT total:     ", orphanDebits.toString());
}

main()
  .catch((error) => console.error(error))
  .finally(() => prisma.$disconnect());