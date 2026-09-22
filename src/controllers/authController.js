const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");
const { z } = require("zod");
const { signToken } = require("../utils/jwt");

const prisma = new PrismaClient();

const registerSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  name: z.string().min(1).max(191).optional(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { email, phone, name, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, phone, name, passwordHash },
  });

  await prisma.wallet.create({
    data: { userId: user.id, balance: "0.00" },
  });

  const token = signToken({ id: user.id, role: user.role });

  return res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
  });
}

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (user.status !== "ACTIVE") {
    return res.status(403).json({ error: "Account is not active." });
  }

  const token = signToken({ id: user.id, role: user.role });

  return res.status(200).json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
  });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, phone: true, name: true, role: true, status: true, createdAt: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  return res.status(200).json({ user });
}

module.exports = { register, login, me };