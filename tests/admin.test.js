const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const adminEmail = `jest-admin-${Date.now()}@example.com`;
const regularEmail = `jest-regular-${Date.now()}@example.com`;
const testPassword = "password123";

let adminUserId, adminToken;
let regularUserId, regularToken;

beforeAll(async () => {
  const adminReg = await request(app)
    .post("/auth/register")
    .send({ email: adminEmail, password: testPassword, name: "Jest Admin" });
  adminUserId = adminReg.body.user.id;

  await prisma.user.update({ where: { id: adminUserId }, data: { role: "SUPER_ADMIN" } });

  const adminLogin = await request(app)
    .post("/auth/login")
    .send({ email: adminEmail, password: testPassword });
  adminToken = adminLogin.body.token;

  const regularReg = await request(app)
    .post("/auth/register")
    .send({ email: regularEmail, password: testPassword, name: "Jest Regular" });
  regularUserId = regularReg.body.user.id;
  regularToken = regularReg.body.token;
});

afterAll(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { actorId: adminUserId } });
  for (const id of [adminUserId, regularUserId]) {
    const wallet = await prisma.wallet.findUnique({ where: { userId: id } });
    if (wallet) {
      await prisma.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
    }
    await prisma.wallet.deleteMany({ where: { userId: id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, regularUserId] } } });
  await prisma.$disconnect();
});

describe("Admin access control", () => {
  test("a regular user is blocked from admin routes (403)", async () => {
    const res = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${regularToken}`);
    expect(res.status).toBe(403);
  });

  test("an unauthenticated request is blocked (401)", async () => {
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(401);
  });

  test("a SUPER_ADMIN can list users", async () => {
    const res = await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });
});

describe("Admin user management", () => {
  test("GET /admin/users/:id returns full user detail", async () => {
    const res = await request(app)
      .get(`/admin/users/${regularUserId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(regularUserId);
  });

  test("GET /admin/users/:id returns 400 for a non-numeric ID", async () => {
    const res = await request(app)
      .get("/admin/users/not-a-number")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test("PATCH /admin/users/:id/status updates status and logs the action", async () => {
    const res = await request(app)
      .patch(`/admin/users/${regularUserId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SUSPENDED" });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("SUSPENDED");

    const log = await prisma.adminAuditLog.findFirst({
      where: { entity: "User", entityId: String(regularUserId), action: "UPDATE_USER_STATUS" },
      orderBy: { id: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log.actorId).toBe(adminUserId);

    // restore for later tests
    await prisma.user.update({ where: { id: regularUserId }, data: { status: "ACTIVE" } });
  });

  test("PATCH /admin/users/:id/role is rejected for a non-SUPER_ADMIN admin", async () => {
    await prisma.user.update({ where: { id: regularUserId }, data: { role: "ADMIN" } });
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ email: regularEmail, password: testPassword });
    const nonSuperToken = loginRes.body.token;

    const res = await request(app)
      .patch(`/admin/users/${adminUserId}/role`)
      .set("Authorization", `Bearer ${nonSuperToken}`)
      .send({ role: "SUPER_ADMIN" });

    expect(res.status).toBe(403);

    await prisma.user.update({ where: { id: regularUserId }, data: { role: "USER" } });
  });
});

describe("Admin wallet adjustment", () => {
  test("POST /admin/users/:id/wallet/adjust credits a wallet and logs the action", async () => {
    const res = await request(app)
      .post(`/admin/users/${regularUserId}/wallet/adjust`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: 500, type: "CREDIT", reason: "Jest test credit" });

    expect(res.status).toBe(200);
    expect(Number(res.body.walletTransaction.balanceAfter)).toBe(500);

    const log = await prisma.adminAuditLog.findFirst({
      where: { action: "MANUAL_WALLET_ADJUSTMENT", entityId: String(res.body.walletTransaction.walletId) },
      orderBy: { id: "desc" },
    });
    expect(log).not.toBeNull();
  });

  test("POST /admin/users/:id/wallet/adjust rejects a DEBIT exceeding the balance", async () => {
    const res = await request(app)
      .post(`/admin/users/${regularUserId}/wallet/adjust`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: 999999, type: "DEBIT", reason: "Jest overdraw attempt" });

    expect(res.status).toBe(422);
  });
});

describe("Admin visibility endpoints", () => {
  test("GET /admin/transactions returns paginated results", async () => {
    const res = await request(app)
      .get("/admin/transactions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
  });

  test("GET /admin/payments returns paginated results", async () => {
    const res = await request(app)
      .get("/admin/payments")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
  });

  test("GET /admin/audit-log returns entries with actor info", async () => {
    const res = await request(app)
      .get("/admin/audit-log")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThan(0);
  });
});