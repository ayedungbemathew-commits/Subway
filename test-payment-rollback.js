const { PrismaClient } = require("@prisma/client");
const { creditWalletInTransaction } = require("./src/services/wallet");
const prisma = new PrismaClient();
async function run() {
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: 3 }
      });
      await creditWalletInTransaction(tx, {
        userId: payment.userId,
        amount: payment.amount,
        reference: "WALLET-FUND-ROLLBACK-TEST-001",
        description: "Rollback test",
        type: "CREDIT",
        paymentId: 999999
      });
      throw new Error("INTENTIONAL ROLLBACK TEST");
    });
    console.log("UNEXPECTED SUCCESS");
  } catch (e) {
    console.log("EXPECTED ROLLBACK ERROR:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
