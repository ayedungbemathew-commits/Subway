const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stamp = Date.now();
const adminEmail = `jest-failtx-admin-${stamp}@example.com`;
const userEmail = `jest-failtx-user-${stamp}@example.com`;
const testPassword = "password123";
let adminUserId, adminToken, userId, userToken;
let network;
let createdNetwork = false;
const txIds = [];
async function makeTx(extra = {}) {
  const tx = await prisma.transaction.create({
    data: {
      userId,
      networkId: network.id,
      reference: `FAILTX-${stamp}-${txIds.length}-${Math.random().toString(16).slice(2, 8)}`,
      type: "AIRTIME",
      phoneNumber: "08000000000",
      amount: 100,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      ...extra,
    },
  });
  txIds.push(tx.id);
  return tx;
}
function failTx(id, body) {
  return request(app)
    .patch(`/admin/transactions/${id}/fail`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send(body);
}
beforeAll(async () => {
  const adminReg = await request(app)
    .post("/auth/register")
    .send({ email: adminEmail, password: testPassword, name: "Jest FailTx Admin" });
  adminUserId = adminReg.body.user.id;
  await prisma.user.update({ where: { id: adminUserId }, data: { role: "SUPER_ADMIN" } });
  const adminLogin = await request(app)
    .post("/auth/login")
    .send({ email: adminEmail, password: testPassword });
  adminToken = adminLogin.body.token;
  const userReg = await request(app)
    .post("/auth/register")
    .send({ email: userEmail, password: testPassword, name: "Jest FailTx User" });
  userId = userReg.body.user.id;
  userToken = userReg.body.token;
  network = await prisma.network.findFirst();
  if (!network) {
    network = await prisma.network.create({ data: { name: "FailTx Net " + stamp, code: "FT" + stamp } });
    createdNetwork = true;
  }
});
afterAll(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { actorId: adminUserId } });
  await prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
  const ids = [adminUserId, userId];
  for (const id of ids) {
    const wallet = await prisma.wallet.findUnique({ where: { userId: id } });
    if (wallet) {
      await prisma.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
    }
    await prisma.wallet.deleteMany({ where: { userId: id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (createdNetwork) {
    await prisma.network.deleteMany({ where: { id: network.id } });
  }
  await prisma.$disconnect();
});
describe("Admin: mark a pending transaction as failed", () => {
  test("a regular user is blocked (403)", async () => {
    const res = await request(app)
      .patch("/admin/transactions/1/fail")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ reason: "stale test record" });
    expect(res.status).toBe(403);
  });
  test("a reason that is too short is rejected (400)", async () => {
    const tx = await makeTx();
    const res = await failTx(tx.id, { reason: "x" });
    expect(res.status).toBe(400);
  });
  test("an unknown transaction returns 404", async () => {
    const res = await failTx(999999999, { reason: "stale test record" });
    expect(res.status).toBe(404);
  });
  test("a transaction under 10 minutes old is refused and left PENDING (409)", async () => {
    const tx = await makeTx({ createdAt: new Date() });
    const res = await failTx(tx.id, { reason: "stale test record" });
    expect(res.status).toBe(409);
    const after = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(after.status).toBe("PENDING");
  });
  test("a transaction with a provider reference is refused (409)", async () => {
    const tx = await makeTx({ providerReference: "PROVREF-" + stamp });
    const res = await failTx(tx.id, { reason: "stale test record" });
    expect(res.status).toBe(409);
    const after = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(after.status).toBe("PENDING");
  });
  test("a transaction that is not PENDING is refused (409)", async () => {
    const tx = await makeTx({ status: "SUCCESS" });
    const res = await failTx(tx.id, { reason: "stale test record" });
    expect(res.status).toBe(409);
    const after = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(after.status).toBe("SUCCESS");
  });
  test("a stale PENDING transaction is marked FAILED and logged", async () => {
    const tx = await makeTx();
    const res = await failTx(tx.id, { reason: "stale test record" });
    expect(res.status).toBe(200);
    const after = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(after.status).toBe("FAILED");
    expect(after.failureReason).toContain("Marked failed by admin");
    const log = await prisma.adminAuditLog.findFirst({
      where: { actorId: adminUserId, action: "MARK_TRANSACTION_FAILED", entityId: String(tx.id) },
    });
    expect(log).not.toBeNull();
    expect(log.newValue.reason).toBe("stale test record");
  });
  test("the same transaction cannot be marked failed twice (409)", async () => {
    const tx = await makeTx();
    const first = await failTx(tx.id, { reason: "stale test record" });
    expect(first.status).toBe(200);
    const second = await failTx(tx.id, { reason: "stale test record" });
    expect(second.status).toBe(409);
  });
});