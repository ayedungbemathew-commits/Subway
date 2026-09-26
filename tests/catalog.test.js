const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const adminEmail = `jest-catalogadmin-${Date.now()}@example.com`;
const testPassword = "password123";

let adminUserId, adminToken;
let createdNetworkId, createdDataPlanId;

beforeAll(async () => {
  const reg = await request(app)
    .post("/auth/register")
    .send({ email: adminEmail, password: testPassword, name: "Jest Catalog Admin" });
  adminUserId = reg.body.user.id;

  await prisma.user.update({ where: { id: adminUserId }, data: { role: "ADMIN" } });

  const login = await request(app)
    .post("/auth/login")
    .send({ email: adminEmail, password: testPassword });
  adminToken = login.body.token;
});

afterAll(async () => {
  if (createdDataPlanId) {
    await prisma.dataPlan.deleteMany({ where: { id: createdDataPlanId } });
  }
  if (createdNetworkId) {
    await prisma.network.deleteMany({ where: { id: createdNetworkId } });
  }
  await prisma.adminAuditLog.deleteMany({ where: { actorId: adminUserId } });
  await prisma.wallet.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe("Catalog read endpoints (public, no auth)", () => {
  test("GET /catalog/networks works without a token", async () => {
    const res = await request(app).get("/catalog/networks");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.networks)).toBe(true);
    expect(res.body.networks.length).toBeGreaterThan(0);
  });

  test("GET /catalog/providers works without a token", async () => {
    const res = await request(app).get("/catalog/providers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
  });

  test("GET /catalog/data-plans works without a token", async () => {
    const res = await request(app).get("/catalog/data-plans");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.dataPlans)).toBe(true);
  });
});

describe("Catalog write endpoints (admin only)", () => {
  test("POST /catalog/networks is rejected without auth", async () => {
    const res = await request(app)
      .post("/catalog/networks")
      .send({ name: "Should Fail", code: "SHOULDFAIL" });
    expect(res.status).toBe(401);
  });

  test("POST /catalog/networks creates a network as admin", async () => {
    const res = await request(app)
      .post("/catalog/networks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Jest Test Network", code: `JESTNET-${Date.now()}` });

    expect(res.status).toBe(201);
    expect(res.body.network.status).toBe("ACTIVE");
    createdNetworkId = res.body.network.id;
  });

  test("PATCH /catalog/networks/:id updates status", async () => {
    const res = await request(app)
      .patch(`/catalog/networks/${createdNetworkId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INACTIVE" });

    expect(res.status).toBe(200);
    expect(res.body.network.status).toBe("INACTIVE");
  });

  test("PATCH /catalog/networks/:id returns 400 for a non-numeric ID", async () => {
    const res = await request(app)
      .patch("/catalog/networks/not-a-number")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACTIVE" });
    expect(res.status).toBe(400);
  });

  test("POST /catalog/data-plans rejects sellingPrice below providerCost", async () => {
    const res = await request(app)
      .post("/catalog/data-plans")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        networkId: createdNetworkId,
        name: "Bad Pricing Plan",
        dataAmount: "1GB",
        providerCost: 1000,
        sellingPrice: 500,
      });

    expect(res.status).toBe(400);
  });

  test("POST /catalog/data-plans creates a plan with valid pricing", async () => {
    const res = await request(app)
      .post("/catalog/data-plans")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        networkId: createdNetworkId,
        name: "Jest Test Plan",
        dataAmount: "2GB",
        validity: "30 Days",
        providerCost: 500,
        sellingPrice: 700,
      });

    expect(res.status).toBe(201);
    createdDataPlanId = res.body.dataPlan.id;
  });

  test("GET /catalog/data-plans?networkId filters correctly", async () => {
    const res = await request(app).get(`/catalog/data-plans?networkId=${createdNetworkId}`);
    expect(res.status).toBe(200);
    expect(res.body.dataPlans.every((p) => p.networkId === createdNetworkId)).toBe(true);
  });
});