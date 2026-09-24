const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const { creditWallet } = require("../src/services/wallet");
const prisma = new PrismaClient();

const testEmail = `jest-walletvtu-${Date.now()}@example.com`;
const testPassword = "password123";

let userId;
let token;

beforeAll(async () => {
  const res = await request(app)
    .post("/auth/register")
    .send({ email: testEmail, password: testPassword, name: "Jest Wallet VTU User" });
  userId = res.body.user.id;
  token = res.body.token;

  await creditWallet({
    userId,
    amount: 5000,
    reference: `JEST-FUND-${Date.now()}`,
    description: "Jest test funding",
    type: "CREDIT",
  });
});

afterAll(async () => {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (wallet) {
    await prisma.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
  }
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.wallet.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("Wallet endpoints", () => {
  test("GET /wallet/balance returns the funded balance", async () => {
    const res = await request(app)
      .get("/wallet/balance")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.balance)).toBe(5000);
  });

  test("GET /wallet/balance rejects unauthenticated requests", async () => {
    const res = await request(app).get("/wallet/balance");
    expect(res.status).toBe(401);
  });

  test("GET /wallet/transactions returns the funding entry", async () => {
    const res = await request(app)
      .get("/wallet/transactions")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
  });
});

describe("VTU purchase endpoints", () => {
  const originalMode = process.env.MOCK_PROVIDER_MODE;

  afterEach(() => {
    process.env.MOCK_PROVIDER_MODE = originalMode;
  });

  test("POST /vtu/airtime succeeds and debits the wallet by exactly the amount", async () => {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";

    const before = await request(app)
      .get("/wallet/balance")
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post("/vtu/airtime")
      .set("Authorization", `Bearer ${token}`)
      .send({
        networkCode: "MTN",
        phoneNumber: "08012345678",
        amount: 100,
        reference: `JEST-AIRTIME-${Date.now()}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.transaction.status).toBe("SUCCESS");

    const after = await request(app)
      .get("/wallet/balance")
      .set("Authorization", `Bearer ${token}`);

    expect(Number(before.body.balance) - Number(after.body.balance)).toBe(100);
  });

  test("POST /vtu/airtime with a failing provider does not debit the wallet", async () => {
    process.env.MOCK_PROVIDER_MODE = "FAILED";

    const before = await request(app)
      .get("/wallet/balance")
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post("/vtu/airtime")
      .set("Authorization", `Bearer ${token}`)
      .send({
        networkCode: "MTN",
        phoneNumber: "08012345678",
        amount: 100,
        reference: `JEST-AIRTIME-FAIL-${Date.now()}`,
      });

    const after = await request(app)
      .get("/wallet/balance")
      .set("Authorization", `Bearer ${token}`);

    expect(Number(before.body.balance)).toBe(Number(after.body.balance));
  });

  test("POST /vtu/airtime rejects invalid input (missing fields)", async () => {
    const res = await request(app)
      .post("/vtu/airtime")
      .set("Authorization", `Bearer ${token}`)
      .send({ phoneNumber: "08012345678" });

    expect(res.status).toBe(400);
  });

  test("GET /vtu/transactions/:reference returns the purchased transaction", async () => {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const reference = `JEST-LOOKUP-${Date.now()}`;

    await request(app)
      .post("/vtu/airtime")
      .set("Authorization", `Bearer ${token}`)
      .send({ networkCode: "MTN", phoneNumber: "08012345678", amount: 100, reference });

    const res = await request(app)
      .get(`/vtu/transactions/${reference}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.transaction.reference).toBe(reference);
  });

  test("GET /vtu/transactions/:reference returns 404 for another user's transaction reference", async () => {
    const res = await request(app)
      .get("/vtu/transactions/nonexistent-reference-12345")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});