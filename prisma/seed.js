const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Starting database seed...");

  // ============================================
  // NETWORKS
  // ============================================

  const networks = [
    {
      name: "MTN",
      code: "MTN",
    },
    {
      name: "Airtel",
      code: "AIRTEL",
    },
    {
      name: "Glo",
      code: "GLO",
    },
    {
      name: "9mobile",
      code: "9MOBILE",
    },
  ];

  for (const network of networks) {
    await prisma.network.upsert({
      where: {
        code: network.code,
      },
      update: {
        name: network.name,
        status: "ACTIVE",
      },
      create: {
        name: network.name,
        code: network.code,
        status: "ACTIVE",
      },
    });
  }

  // ============================================
  // DEFAULT VTU PROVIDER
  // ============================================

  await prisma.provider.upsert({
    where: {
      code: "DEFAULT",
    },
    update: {
      name: "Default VTU Provider",
      status: "ACTIVE",
      priority: 1,
    },
    create: {
      name: "Default VTU Provider",
      code: "DEFAULT",
      status: "ACTIVE",
      priority: 1,
    },
  });
  // ============================================
  // DEVELOPMENT TEST USER
  // ============================================

  const testUser = await prisma.user.upsert({
    where: {
      email: "test@example.com",
    },
    update: {
      name: "Test User",
      role: "USER",
      status: "ACTIVE",
    },
    create: {
      email: "test@example.com",
      name: "Test User",
      role: "USER",
      status: "ACTIVE",
    },
  });

  // ============================================
  // TEST USER WALLET
  // ============================================

  await prisma.wallet.upsert({
    where: {
      userId: testUser.id,
    },
    update: {},
    create: {
      userId: testUser.id,
      balance: "0.00",
    },
  });

  console.log("Test user created:", testUser.email);
  console.log("Database seed completed successfully.");
}

main()
  .catch((error) => {
    console.error("Seed failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });