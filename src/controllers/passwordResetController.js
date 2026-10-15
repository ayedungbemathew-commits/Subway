const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");
const { z } = require("zod");
const { sendPasswordResetEmail } = require("../utils/email");

const prisma = new PrismaClient();

const TOKEN_TTL_MS = 30 * 60 * 1000;

const forgotSchema = z.object({
  email: z.string().email("Enter a valid email address."),
});

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const GENERIC_MESSAGE = "If an account exists for that email, a reset link has been sent.";
const INVALID_LINK = "This reset link is invalid or has expired. Please request a new one.";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function appBaseUrl() {
  const explicit = process.env.APP_URL || (process.env.CORS_ALLOWED_ORIGINS || "").split(",")[0] || "";
  return explicit.trim().replace(/\/+$/, "");
}

async function forgotPassword(req, res) {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { email } = parsed.data;

  // The reply is identical whether or not the account exists, so this endpoint
  // cannot be used to find out which emails are registered.
  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.status === "ACTIVE") {
      // Only one outstanding link per account.
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

      const token = crypto.randomBytes(32).toString("hex");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        },
      });

      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        link: appBaseUrl() + "/reset-password?token=" + token,
      });
    }
  } catch (error) {
    console.error("Password reset request failed:", error.message);
  }

  return res.status(200).json({ message: GENERIC_MESSAGE });
}

async function resetPassword(req, res) {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { token, password } = parsed.data;

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date() || record.user.status !== "ACTIVE") {
    return res.status(400).json({ error: INVALID_LINK });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Claim the link first so it can only ever be used once, even with two
  // requests arriving at the same moment.
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  if (claimed.count !== 1) {
    return res.status(400).json({ error: INVALID_LINK });
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash },
  });

  await prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } });

  return res.status(200).json({ message: "Password updated. You can now log in." });
}

module.exports = { forgotPassword, resetPassword };
