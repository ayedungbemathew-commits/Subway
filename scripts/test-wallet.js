const { PrismaClient } = require("@prisma/client");

const {
  createWallet,
  getWallet,
  creditWallet,
  debitWallet,
  getWalletBalance,
} = require("../src/services/wallet");

const prisma = new PrismaClient();

async function main() {
  console.log("=== WALLET SYSTEM TEST ===");

  // Create or find a local test user
  const user = await prisma.user.upsert({
    where: {
      email: "wallet-test@localhost.test",
    },
    update: {},
    create: {
      name: "Wallet Test User",
      email: "wallet-test@localhost.test",
      phone: "08000000000",
      passwordHash: "TEST_ONLY",
    },
  });

  console.log("\nUser:");
  console.log({
    id: user.id,
    name: user.name,
    email: user.email,
  });

  // Create wallet if it does not exist
  const wallet = await createWallet(user.id);

  console.log("\nWallet:");
  console.log({
    id: wallet.id,
    balance: wallet.balance.toString(),
    currency: wallet.currency,
  });

  // Credit ₦10,000
  const credit = await creditWallet({
    userId: user.id,
    amount: "10000.00",
    reference: `TEST-FUND-${Date.now()}`,
    description: "Wallet system test funding",
  });

  console.log("\nCredit transaction:");
  console.log({
    reference: credit.reference,
    type: credit.type,
    direction: credit.direction,
    amount: credit.amount.toString(),
    balanceBefore: credit.balanceBefore.toString(),
    balanceAfter: credit.balanceAfter.toString(),
    status: credit.status,
  });

  // Check balance
  const balanceAfterCredit = await getWalletBalance(user.id);

  console.log("\nBalance after credit:");
  console.log(`₦${balanceAfterCredit.toString()}`);

  // Debit ₦2,500
  const debit = await debitWallet({
    userId: user.id,
    amount: "2500.00",
    reference: `TEST-DEBIT-${Date.now()}`,
    description: "Wallet system test debit",
  });

  console.log("\nDebit transaction:");
  console.log({
    reference: debit.reference,
    type: debit.type,
    direction: debit.direction,
    amount: debit.amount.toString(),
    balanceBefore: debit.balanceBefore.toString(),
    balanceAfter: debit.balanceAfter.toString(),
    status: debit.status,
  });

  // Final balance
  const finalBalance = await getWalletBalance(user.id);

  console.log("\nFinal wallet balance:");
  console.log(`₦${finalBalance.toString()}`);

  console.log("\n=== WALLET TEST COMPLETED SUCCESSFULLY ===");
}

main()
  .catch((error) => {
    console.error("\n=== WALLET TEST FAILED ===");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });