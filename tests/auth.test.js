const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const testEmail = `jest-auth-${Date.now()}@example.com`;
const testPassword = "password123";

afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { email: testEmail } });
  if (user) {
    await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: user.id } } });
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

describe("Auth flow", () => {
  let token;

  test("registers a new user and creates a wallet", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: testEmail, password: testPassword, name: "Jest Test User" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.role).toBe("USER");
    expect(res.body.token).toBeTruthy();

    token = res.body.token;

    const wallet = await prisma.wallet.findUnique({ where: { userId: res.body.user.id } });
    expect(wallet).not.toBeNull();
    expect(wallet.balance.toString()).toBe("0");
  });

  test("rejects duplicate email registration", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: testEmail, password: testPassword, name: "Duplicate" });

    expect(res.status).toBe(409);
  });

  test("rejects registration with a short password", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: `short-${Date.now()}@example.com`, password: "abc" });

    expect(res.status).toBe(400);
  });

  test("logs in with correct credentials", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test("rejects login with wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: testEmail, password: "wrongpassword" });

    expect(res.status).toBe(401);
  });

  test("GET /auth/me returns the authenticated user with a valid token", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testEmail);
  });

  test("GET /auth/me rejects a request with no token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  test("GET /auth/me rejects an invalid token", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer not-a-real-token");

    expect(res.status).toBe(401);
  });
});