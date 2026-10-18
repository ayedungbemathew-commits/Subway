require("./setup");

const request = require("supertest");
const { PrismaClient } = require("@prisma/client");
const app = require("../src/app");

const prisma = new PrismaClient();
const PASSWORD = "AdminPlans1!";

let adminToken;
let userToken;
let networkId;

function uniqueEmail(tag) {
  return tag + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000000) + "@example.com";
}

async function makeUser(tag, role) {
  const email = uniqueEmail(tag);
  const reg = await request(app).post("/auth/register").send({ email, password: PASSWORD, name: tag });
  expect(reg.status).toBe(201);
  if (role) {
    await prisma.user.update({ where: { id: reg.body.user.id }, data: { role } });
  }
  const login = await request(app).post("/auth/login").send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return login.body.token;
}

beforeAll(async () => {
  adminToken = await makeUser("plans-admin", "ADMIN");
  userToken = await makeUser("plans-user", null);

  const code = "PLN" + Date.now();
  const net = await request(app)
    .post("/catalog/networks")
    .set("Authorization", "Bearer " + adminToken)
    .send({ name: "Plans Test Net", code });
  expect(net.status).toBe(201);
  networkId = net.body.network.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createPlan(extra) {
  const res = await request(app)
    .post("/catalog/data-plans")
    .set("Authorization", "Bearer " + adminToken)
    .send({
      networkId,
      name: "Plan " + Date.now() + Math.floor(Math.random() * 1000),
      dataAmount: "1GB",
      providerCost: 100,
      sellingPrice: 120,
      ...extra,
    });
  expect(res.status).toBe(201);
  return res.body.dataPlan;
}

describe("Data plan admin and public lists", () => {
  test("public list shows active plans but never the provider cost", async () => {
    const plan = await createPlan();

    const res = await request(app).get("/catalog/data-plans?networkId=" + networkId);
    expect(res.status).toBe(200);

    const found = res.body.dataPlans.find((x) => x.id === plan.id);
    expect(found).toBeDefined();
    expect(found.sellingPrice).toBeDefined();
    expect(found).not.toHaveProperty("providerCost");
    expect(found).not.toHaveProperty("provider");
    expect(found).not.toHaveProperty("providerId");
  });

  test("a hidden plan disappears from the public list but stays in the admin list", async () => {
    const plan = await createPlan();

    const hide = await request(app)
      .patch("/catalog/data-plans/" + plan.id)
      .set("Authorization", "Bearer " + adminToken)
      .send({ status: "INACTIVE" });
    expect(hide.status).toBe(200);

    const publicList = await request(app).get("/catalog/data-plans?networkId=" + networkId);
    expect(publicList.body.dataPlans.some((x) => x.id === plan.id)).toBe(false);

    const adminList = await request(app)
      .get("/catalog/admin/data-plans")
      .set("Authorization", "Bearer " + adminToken);
    expect(adminList.status).toBe(200);
    const found = adminList.body.dataPlans.find((x) => x.id === plan.id);
    expect(found).toBeDefined();
    expect(found.status).toBe("INACTIVE");
    expect(found.providerCost).toBeDefined();

    const show = await request(app)
      .patch("/catalog/data-plans/" + plan.id)
      .set("Authorization", "Bearer " + adminToken)
      .send({ status: "ACTIVE" });
    expect(show.status).toBe(200);

    const again = await request(app).get("/catalog/data-plans?networkId=" + networkId);
    expect(again.body.dataPlans.some((x) => x.id === plan.id)).toBe(true);
  });

  test("an edit that puts the price below the cost is refused", async () => {
    const plan = await createPlan();

    const res = await request(app)
      .patch("/catalog/data-plans/" + plan.id)
      .set("Authorization", "Bearer " + adminToken)
      .send({ sellingPrice: 50 });
    expect(res.status).toBe(400);

    const ok = await request(app)
      .patch("/catalog/data-plans/" + plan.id)
      .set("Authorization", "Bearer " + adminToken)
      .send({ sellingPrice: 150 });
    expect(ok.status).toBe(200);
  });

  test("the admin list is closed to customers and visitors", async () => {
    const anonymous = await request(app).get("/catalog/admin/data-plans");
    expect(anonymous.status).toBe(401);

    const customer = await request(app)
      .get("/catalog/admin/data-plans")
      .set("Authorization", "Bearer " + userToken);
    expect(customer.status).toBe(403);
  });
});
