const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const { creditWallet } = require("../src/services/wallet");
const { reconcileTransaction } = require("../src/services/vtu");
const prisma = new PrismaClient();
const stamp = Date.now();
const password = "password123";
const originalMode = process.env.MOCK_PROVIDER_MODE;
let counter = 0;
let rich, poor;
function nextRef() {
  counter += 1;
  return `JEST-CF-${stamp}-${counter}`;
}
async function makeUser(label, funding) {
  const res = await request(app)
    .post("/auth/register")
    .send({ email: `jest-cf-${label}-${stamp}@example.com`, password, name: `Jest CF ${label}` });
  const user = { id: res.body.user.id, token: res.body.token };
  await creditWallet({
    userId: user.id,
    amount: funding,
    reference: `JEST-CF-FUND-${label}-${stamp}`,
    description: "Jest test funding",
    type: "CREDIT",
  });
  return user;
}
function buy(user, reference, amount = 100) {
  return request(app)
    .post("/vtu/airtime")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ networkCode: "MTN", phoneNumber: "08012345678", amount, reference });
}
async function balanceOf(user) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  return Number(wallet.balance);
}
async function entriesFor(user) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  return prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { id: "asc" } });
}
async function expectHeld(mode) {
  process.env.MOCK_PROVIDER_MODE = mode;
  const before = await balanceOf(rich);
  const res = await buy(rich, nextRef());
  expect(res.status).toBe(201);
  expect(res.body.transaction.status).toBe("PROCESSING");
  expect(await balanceOf(rich)).toBe(before - 100);
  const linked = (await entriesFor(rich)).filter((e) => e.transactionId === res.body.transaction.id);
  expect(linked).toHaveLength(1);
  expect(linked[0].type).toBe("DEBIT");
}
beforeAll(async () => {
  rich = await makeUser("rich", 5000);
  poor = await makeUser("poor", 50);
});
afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.MOCK_PROVIDER_MODE;
  } else {
    process.env.MOCK_PROVIDER_MODE = originalMode;
  }
});
afterAll(async () => {
  for (const u of [rich, poor]) {
    const wallet = await prisma.wallet.findUnique({ where: { userId: u.id } });
    if (wallet) {
      await prisma.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
    }
    await prisma.transaction.deleteMany({ where: { userId: u.id } });
    await prisma.wallet.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
  await prisma.$disconnect();
});
describe("VTU purchases charge the wallet first", () => {
  test("not enough balance: the purchase fails and the provider is never called", async () => {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const res = await buy(poor, nextRef());
    expect(res.status).toBe(201);
    expect(res.body.transaction.status).toBe("FAILED");
    expect(res.body.transaction.failureReason).toContain("Insufficient wallet balance");
    const row = await prisma.transaction.findUnique({ where: { id: res.body.transaction.id } });
    expect(row.providerResponse).toBeNull();
    expect(await balanceOf(poor)).toBe(50);
  });
  test("success: the wallet is charged exactly once", async () => {
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const before = await balanceOf(rich);
    const res = await buy(rich, nextRef());
    expect(res.body.transaction.status).toBe("SUCCESS");
    expect(before - (await balanceOf(rich))).toBe(100);
    const linked = (await entriesFor(rich)).filter((e) => e.transactionId === res.body.transaction.id);
    expect(linked).toHaveLength(1);
    expect(linked[0].type).toBe("DEBIT");
  });
  test("provider still working: the money is held and the transaction is PROCESSING", async () => {
    await expectHeld("PENDING");
  });
  test("provider error or timeout: the money is held and the transaction is PROCESSING", async () => {
    await expectHeld("ERROR");
  });
  test("provider fails: the wallet is charged, then refunded once", async () => {
    process.env.MOCK_PROVIDER_MODE = "FAILED";
    const before = await balanceOf(rich);
    const res = await buy(rich, nextRef());
    const id = res.body.transaction.id;
    expect(res.body.transaction.status).toBe("FAILED");
    expect(await balanceOf(rich)).toBe(before);
    const row = await prisma.transaction.findUnique({ where: { id } });
    expect(row.refunded).toBe(true);
    expect(row.refundedAt).not.toBeNull();
    const entries = await entriesFor(rich);
    const debit = entries.find((e) => e.reference === `VTU-DEBIT-${id}`);
    const refund = entries.find((e) => e.reference === `VTU-REFUND-${id}`);
    expect(debit.type).toBe("DEBIT");
    expect(refund.type).toBe("REFUND");
    expect(Number(refund.amount)).toBe(100);
  });
  test("reconcile: a held purchase the provider reports as failed is refunded exactly once", async () => {
    process.env.MOCK_PROVIDER_MODE = "PENDING";
    const before = await balanceOf(rich);
    const reference = nextRef();
    const res = await buy(rich, reference);
    const id = res.body.transaction.id;
    expect(res.body.transaction.status).toBe("PROCESSING");
    expect(await balanceOf(rich)).toBe(before - 100);
    process.env.MOCK_PROVIDER_MODE = "FAILED";
    const first = await reconcileTransaction(reference);
    expect(first.status).toBe("FAILED");
    expect(await balanceOf(rich)).toBe(before);
    await reconcileTransaction(reference);
    expect(await balanceOf(rich)).toBe(before);
    const refunds = (await entriesFor(rich)).filter((e) => e.reference === `VTU-REFUND-${id}`);
    expect(refunds).toHaveLength(1);
  });
  test("reconcile: a held purchase the provider reports as successful is not charged twice", async () => {
    process.env.MOCK_PROVIDER_MODE = "PENDING";
    const before = await balanceOf(rich);
    const reference = nextRef();
    const res = await buy(rich, reference);
    expect(res.body.transaction.status).toBe("PROCESSING");
    expect(await balanceOf(rich)).toBe(before - 100);
    process.env.MOCK_PROVIDER_MODE = "SUCCESS";
    const done = await reconcileTransaction(reference);
    expect(done.status).toBe("SUCCESS");
    expect(await balanceOf(rich)).toBe(before - 100);
  });
});