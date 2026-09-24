const request = require("supertest");
const app = require("../src/app");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const testEmail = `jest-payments-${Date.now()}@example.com`;
const testPassword = "password123";

let userId;
let token;

beforeAll(async () => {
  const res = await request(app)
    .post("/auth/register")
    .send({ email: testEmail, password: testPassword, name: "Jest Payments User" });
  userId = res.body.user.id;
  token = res.body.token;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { userId } });
  await prisma.wallet.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("Payment endpoints", () => {
  let paymentReference;

  test("POST /payments/initialize creates a real Paystack transaction", async () => {
    const res = await request(app)
      .post("/payments/initialize")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 1000 });

    expect(res.status).toBe(201);
    expect(res.body.reference).toBeTruthy();
    expect(res.body.authorizationUrl).toContain("paystack.com");
    expect(res.body.accessCode).toBeTruthy();

    paymentReference = res.body.reference;
  }, 15000);

  test("POST /payments/initialize rejects a non-positive amount", async () => {
    const res = await request(app)
      .post("/payments/initialize")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: -50 });

    expect(res.status).toBe(400);
  });

  test("POST /payments/initialize rejects unauthenticated requests", async () => {
    const res = await request(app).post("/payments/initialize").send({ amount: 1000 });
    expect(res.status).toBe(401);
  });

  test("GET /payments/:reference returns PENDING for an unpaid transaction", async () => {
    const res = await request(app)
      .get(`/payments/${paymentReference}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe("PENDING");
    expect(res.body.payment.reference).toBe(paymentReference);
  });

  test("GET /payments/:reference returns 404 for a nonexistent reference", async () => {
    const res = await request(app)
      .get("/payments/nonexistent-ref-12345")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test("POST /payments/:reference/verify returns 422 for an unpaid transaction", async () => {
    const res = await request(app)
      .post(`/payments/${paymentReference}/verify`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(422);
  }, 15000);

  test("POST /payments/webhook rejects a request with an invalid signature", async () => {
    const res = await request(app)
      .post("/payments/webhook")
      .set("Content-Type", "application/json")
      .set("X-Paystack-Signature", "not-a-real-signature")
      .send(JSON.stringify({ event: "charge.success", data: { reference: "fake" } }));

    expect(res.status).toBe(401);
  });
});