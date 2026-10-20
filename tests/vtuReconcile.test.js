const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const { creditWallet, debitWalletInTransaction } = require("../src/services/wallet");
const { reconcileStuckTransactions } = require("../src/services/vtu");
const prisma = new PrismaClient();
const stamp = Date.now();
const password = "password123";
const originalMode = process.env.MOCK_PROVIDER_MODE;
const originalSecret = process.env.RECONCILE_SECRET;
let counter = 0;
let main, batch, admin, network, provider;
function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
async function makeUser(label, funding) {
  const res = await request(app)
    .post("/auth/register")
    .send({ email: `jest-rs-${label}-${stamp}@example.com`, password, name: `Jest RS ${label}` });
  const user = { id: res.body.user.id, token: res.body.token };
  if (funding > 0) {
    await creditWallet({
      userId: user.id,
      amount: funding,
      reference: `JEST-RS-FUND-${label}-${stamp}`,
      description: "Jest test funding",
      type: "CREDIT",
    });
  }
  return user;
}
async function makeStuck(user, { status, ageMinutes, charged }) {
  counter += 1;
  const tx = await prisma.transaction.create({
    data: {
      userId: user.id,
      networkId: network.id,
      providerId: provider.id,
      reference: `JEST-RS-${stamp}-${counter}`,
      type: "AIRTIME",
      status,
      phoneNumber: "08000000000",
      amount: 100,
      createdAt: new Date(Date.now() - ageMinutes * 60 * 1000),
    },
  });
  if (charged) {
    await prisma.$transaction(async (t) => {
      await debitWalletInTransaction(t, {
        userId: user.id,
        amount: 100,
        reference: `VTU-DEBIT-${tx.id}`,
        transactionId: tx.id,
        description: "Jest stuck purchase",
      });
    });
  }
  return tx;
}
async function balanceOf(user) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  return Number(wallet.balance);
}
async function entriesOf(user) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  return prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { id: "asc" } });
}
function row(id) {
  return prisma.transaction.findUnique({ where: { id } });
}
function run(user, mode, extra = {}) {
  process.env.MOCK_PROVIDER_MODE = mode;
  return reconcileStuckTransactions({ onlyUserId: user.id, limit: 50, ...extra });
}
function callInternal(secret) {
  const req = request(app).post("/internal/reconcile");
  return secret === undefined ? req : req.set("x-reconcile-secret", secret);
}
beforeAll(async () => {
  main = await makeUser("main", 5000);
  batch = await makeUser("batch", 5000);
  admin = await makeUser("admin", 0);
  await prisma.user.update({ where: { id: admin.id }, data: { role: "SUPER_ADMIN" } });
  const login = await request(app)
    .post("/auth/login")
    .send({ email: `jest-rs-admin-${stamp}@example.com`, password });
  admin.token = login.body.token;
  network = await prisma.network.findFirst();
  provider = await prisma.provider.findFirst({ where: { status: "ACTIVE" }, orderBy: { priority: "asc" } });
});
afterEach(async () => {
  restoreEnv("MOCK_PROVIDER_MODE", originalMode);
  restoreEnv("RECONCILE_SECRET", originalSecret);
  // Remove leftovers so one test's stuck purchases are never re-checked by the next test.
  await prisma.transaction.deleteMany({ where: { userId: { in: [main.id, batch.id] } } });
});
afterAll(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { actorId: admin.id } });
  for (const u of [main, batch, admin]) {
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
describe("reconcileStuckTransactions", () => {
  test("PROCESSING and charged: provider success completes it without charging again", async () => {
    const tx = await makeStuck(main, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const before = await balanceOf(main);
    await run(main, "SUCCESS");
    expect((await row(tx.id)).status).toBe("SUCCESS");
    expect(await balanceOf(main)).toBe(before);
    const mine = (await entriesOf(main)).filter((e) => e.transactionId === tx.id);
    expect(mine).toHaveLength(1);
  });
  test("PROCESSING and charged: provider failure refunds exactly once", async () => {
    const tx = await makeStuck(main, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const before = await balanceOf(main);
    await run(main, "FAILED");
    const failed = await row(tx.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.refunded).toBe(true);
    expect(await balanceOf(main)).toBe(before + 100);
    await run(main, "FAILED");
    expect(await balanceOf(main)).toBe(before + 100);
    const refunds = (await entriesOf(main)).filter((e) => e.reference === `VTU-REFUND-${tx.id}`);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].type).toBe("REFUND");
  });
  test("PROCESSING: provider still pending leaves it alone", async () => {
    const tx = await makeStuck(main, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const before = await balanceOf(main);
    await run(main, "PENDING");
    const after = await row(tx.id);
    expect(after.status).toBe("PROCESSING");
    expect(after.refunded).toBe(false);
    expect(await balanceOf(main)).toBe(before);
  });
  test("PROCESSING: a provider error leaves it alone", async () => {
    const tx = await makeStuck(main, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const before = await balanceOf(main);
    await run(main, "ERROR");
    const after = await row(tx.id);
    expect(after.status).toBe("PROCESSING");
    expect(after.refunded).toBe(false);
    expect(await balanceOf(main)).toBe(before);
  });
  test("PROCESSING but under 5 minutes old: not touched", async () => {
    const tx = await makeStuck(main, { status: "PROCESSING", ageMinutes: 1, charged: true });
    const before = await balanceOf(main);
    await run(main, "FAILED");
    const after = await row(tx.id);
    expect(after.status).toBe("PROCESSING");
    expect(after.refunded).toBe(false);
    expect(await balanceOf(main)).toBe(before);
  });
  test("PENDING with a wallet charge, over 10 minutes old: provider failure refunds it", async () => {
    const tx = await makeStuck(main, { status: "PENDING", ageMinutes: 60, charged: true });
    const before = await balanceOf(main);
    await run(main, "FAILED");
    const after = await row(tx.id);
    expect(after.status).toBe("FAILED");
    expect(after.refunded).toBe(true);
    expect(await balanceOf(main)).toBe(before + 100);
    const refunds = (await entriesOf(main)).filter((e) => e.reference === `VTU-REFUND-${tx.id}`);
    expect(refunds).toHaveLength(1);
  });
  test("PENDING with a wallet charge, over 10 minutes old: provider success completes it, not charged twice", async () => {
    const tx = await makeStuck(main, { status: "PENDING", ageMinutes: 60, charged: true });
    const before = await balanceOf(main);
    await run(main, "SUCCESS");
    expect((await row(tx.id)).status).toBe("SUCCESS");
    expect(await balanceOf(main)).toBe(before);
    const mine = (await entriesOf(main)).filter((e) => e.transactionId === tx.id);
    expect(mine).toHaveLength(1);
  });
  test("PENDING with no wallet charge: not touched", async () => {
    const tx = await makeStuck(main, { status: "PENDING", ageMinutes: 60, charged: false });
    const before = await balanceOf(main);
    await run(main, "FAILED");
    const after = await row(tx.id);
    expect(after.status).toBe("PENDING");
    expect(after.refunded).toBe(false);
    expect(await balanceOf(main)).toBe(before);
  });
  test("PENDING with a charge but under 10 minutes old: not touched", async () => {
    const tx = await makeStuck(main, { status: "PENDING", ageMinutes: 2, charged: true });
    const before = await balanceOf(main);
    await run(main, "FAILED");
    const after = await row(tx.id);
    expect(after.status).toBe("PENDING");
    expect(after.refunded).toBe(false);
    expect(await balanceOf(main)).toBe(before);
  });
  test("finished transactions are never touched", async () => {
    const done = await makeStuck(main, { status: "SUCCESS", ageMinutes: 60, charged: false });
    const failed = await makeStuck(main, { status: "FAILED", ageMinutes: 60, charged: false });
    const before = await balanceOf(main);
    await run(main, "FAILED");
    expect((await row(done.id)).status).toBe("SUCCESS");
    const f = await row(failed.id);
    expect(f.status).toBe("FAILED");
    expect(f.refunded).toBe(false);
    expect(await balanceOf(main)).toBe(before);
  });
  test("the batch limit is respected and the oldest are done first", async () => {
    const first = await makeStuck(batch, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const second = await makeStuck(batch, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const third = await makeStuck(batch, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const result = await run(batch, "SUCCESS", { limit: 2 });
    expect(result.checked).toBe(2);
    expect((await row(first.id)).status).toBe("SUCCESS");
    expect((await row(second.id)).status).toBe("SUCCESS");
    expect((await row(third.id)).status).toBe("PROCESSING");
  });
});
describe("reconcile endpoints", () => {
  test("/internal/reconcile is shut (503) when no secret is configured", async () => {
    delete process.env.RECONCILE_SECRET;
    const res = await callInternal("anything");
    expect(res.status).toBe(503);
  });
  test("/internal/reconcile rejects a missing or wrong secret (401)", async () => {
    process.env.RECONCILE_SECRET = `jest-secret-${stamp}`;
    expect((await callInternal()).status).toBe(401);
    expect((await callInternal("wrong-secret")).status).toBe(401);
  });
  test("/internal/reconcile with the right secret runs the check (200)", async () => {
    const secret = `jest-secret-${stamp}`;
    process.env.RECONCILE_SECRET = secret;
    process.env.MOCK_PROVIDER_MODE = "ERROR";
    const tx = await makeStuck(main, { status: "PROCESSING", ageMinutes: 60, charged: true });
    const res = await callInternal(secret);
    expect(res.status).toBe(200);
    expect(typeof res.body.checked).toBe("number");
    expect((await row(tx.id)).status).toBe("PROCESSING");
  });
  test("/admin/reconcile is blocked for a regular user (403)", async () => {
    const res = await request(app)
      .post("/admin/reconcile")
      .set("Authorization", `Bearer ${main.token}`);
    expect(res.status).toBe(403);
  });
  test("/admin/reconcile works for an admin and is written to the audit log", async () => {
    process.env.MOCK_PROVIDER_MODE = "ERROR";
    const res = await request(app)
      .post("/admin/reconcile")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.checked).toBe("number");
    const log = await prisma.adminAuditLog.findFirst({
      where: { actorId: admin.id, action: "RECONCILE_STUCK_TRANSACTIONS" },
    });
    expect(log).not.toBeNull();
  });
});