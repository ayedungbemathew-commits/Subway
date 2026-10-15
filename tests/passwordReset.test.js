require("./setup");

jest.mock("../src/utils/email", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require("supertest");
const { PrismaClient } = require("@prisma/client");
const app = require("../src/app");
const { sendPasswordResetEmail } = require("../src/utils/email");

const prisma = new PrismaClient();
const OLD_PASSWORD = "OldPassw0rd!";
const NEW_PASSWORD = "NewPassw0rd!";

function uniqueEmail() {
  return "reset-" + Date.now() + "-" + Math.floor(Math.random() * 1000000) + "@example.com";
}

async function registerUser() {
  const email = uniqueEmail();
  const res = await request(app)
    .post("/auth/register")
    .send({ email, password: OLD_PASSWORD, name: "Reset Tester" });
  expect(res.status).toBe(201);
  return { email, id: res.body.user.id };
}

function lastToken() {
  const calls = sendPasswordResetEmail.mock.calls;
  const link = calls[calls.length - 1][0].link;
  return link.split("token=")[1];
}

beforeEach(() => {
  sendPasswordResetEmail.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Password reset", () => {
  test("forgot-password gives the same answer for known and unknown emails", async () => {
    const user = await registerUser();

    const known = await request(app).post("/auth/forgot-password").send({ email: user.email });
    const unknown = await request(app)
      .post("/auth/forgot-password")
      .send({ email: "nobody-" + Date.now() + "@example.com" });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail.mock.calls[0][0].to).toBe(user.email);
  });

  test("full flow: link works once, new password works, old one does not", async () => {
    const user = await registerUser();

    await request(app).post("/auth/forgot-password").send({ email: user.email });
    const token = lastToken();
    expect(token).toHaveLength(64);

    // The token must not be stored in plain text.
    const stored = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).not.toBe(token);
    expect(stored[0].tokenHash).toHaveLength(64);

    const reset = await request(app).post("/auth/reset-password").send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    const loginNew = await request(app).post("/auth/login").send({ email: user.email, password: NEW_PASSWORD });
    expect(loginNew.status).toBe(200);

    const loginOld = await request(app).post("/auth/login").send({ email: user.email, password: OLD_PASSWORD });
    expect(loginOld.status).toBe(401);

    const reuse = await request(app).post("/auth/reset-password").send({ token, password: "AnotherPassw0rd!" });
    expect(reuse.status).toBe(400);
  });

  test("an expired link is rejected", async () => {
    const user = await registerUser();

    await request(app).post("/auth/forgot-password").send({ email: user.email });
    const token = lastToken();

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post("/auth/reset-password").send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  test("a short new password is rejected and the link stays usable", async () => {
    const user = await registerUser();

    await request(app).post("/auth/forgot-password").send({ email: user.email });
    const token = lastToken();

    const short = await request(app).post("/auth/reset-password").send({ token, password: "short" });
    expect(short.status).toBe(400);

    const ok = await request(app).post("/auth/reset-password").send({ token, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
  });

  test("a made-up token is rejected", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "a".repeat(64), password: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  test("a disabled account gets no email but the same answer", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });

    const res = await request(app).post("/auth/forgot-password").send({ email: user.email });
    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
