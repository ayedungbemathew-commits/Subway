require("./setup");

const request = require("supertest");
const { PrismaClient } = require("@prisma/client");
const app = require("../src/app");

const prisma = new PrismaClient();
const PASSWORD = "AdminGuard1!";

let superAdmin;
let admin;
let otherAdmin;
let customer;

async function makeUser(tag, role) {
  const email = tag + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000000) + "@example.com";
  const reg = await request(app).post("/auth/register").send({ email, password: PASSWORD, name: tag });
  expect(reg.status).toBe(201);
  if (role) {
    await prisma.user.update({ where: { id: reg.body.user.id }, data: { role } });
  }
  const login = await request(app).post("/auth/login").send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return { id: reg.body.user.id, email, token: login.body.token };
}

const as = (u) => ({ Authorization: "Bearer " + u.token });

beforeAll(async () => {
  superAdmin = await makeUser("guard-super", "SUPER_ADMIN");
  admin = await makeUser("guard-admin", "ADMIN");
  otherAdmin = await makeUser("guard-admin2", "ADMIN");
  customer = await makeUser("guard-cust", null);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Admin account safety", () => {
  test("an admin cannot change their own status", async () => {
    const res = await request(app)
      .patch("/admin/users/" + admin.id + "/status")
      .set(as(admin))
      .send({ status: "SUSPENDED" });
    expect(res.status).toBe(403);

    const row = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(row.status).toBe("ACTIVE");
  });

  test("an ADMIN cannot suspend another admin or a super admin", async () => {
    const a = await request(app)
      .patch("/admin/users/" + otherAdmin.id + "/status")
      .set(as(admin))
      .send({ status: "SUSPENDED" });
    expect(a.status).toBe(403);

    const b = await request(app)
      .patch("/admin/users/" + superAdmin.id + "/status")
      .set(as(admin))
      .send({ status: "SUSPENDED" });
    expect(b.status).toBe(403);
  });

  test("an ADMIN can suspend and reinstate a customer", async () => {
    const off = await request(app)
      .patch("/admin/users/" + customer.id + "/status")
      .set(as(admin))
      .send({ status: "SUSPENDED" });
    expect(off.status).toBe(200);

    const blocked = await request(app).get("/auth/me").set(as(customer));
    expect(blocked.status).toBe(403);

    const on = await request(app)
      .patch("/admin/users/" + customer.id + "/status")
      .set(as(admin))
      .send({ status: "ACTIVE" });
    expect(on.status).toBe(200);
  });

  test("a SUPER_ADMIN can suspend and reinstate an admin", async () => {
    const off = await request(app)
      .patch("/admin/users/" + otherAdmin.id + "/status")
      .set(as(superAdmin))
      .send({ status: "SUSPENDED" });
    expect(off.status).toBe(200);

    const on = await request(app)
      .patch("/admin/users/" + otherAdmin.id + "/status")
      .set(as(superAdmin))
      .send({ status: "ACTIVE" });
    expect(on.status).toBe(200);
  });
});

describe("Admin lists and wallet adjustments", () => {
  test("user search finds the right account", async () => {
    const res = await request(app)
      .get("/admin/users?q=" + encodeURIComponent(customer.email))
      .set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].id).toBe(customer.id);
  });

  test("the transactions list accepts type and search filters", async () => {
    const res = await request(app)
      .get("/admin/transactions?type=AIRTIME&q=no-such-reference-123")
      .set(as(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions).toHaveLength(0);
  });

  test("two wallet credits sent at the same moment both apply", async () => {
    const send = () =>
      request(app)
        .post("/admin/users/" + customer.id + "/wallet/adjust")
        .set(as(superAdmin))
        .send({ amount: 100, type: "CREDIT", reason: "test credit" });

    // Pin the clock so both requests would build the same millisecond-based reference.
    const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now());
    let one;
    let two;
    try {
      [one, two] = await Promise.all([send(), send()]);
    } finally {
      spy.mockRestore();
    }
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);

    const wallet = await prisma.wallet.findUnique({ where: { userId: customer.id } });
    expect(Number(wallet.balance)).toBe(200);
  });
});
