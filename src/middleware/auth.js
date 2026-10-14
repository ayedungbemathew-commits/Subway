const { verifyToken } = require("../utils/jwt");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header." });
  }

  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyToken(token);
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, role: true, status: true },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    if (user.status !== "ACTIVE") {
      return res.status(403).json({ error: "Account is not active." });
    }

    req.user = { ...payload, role: user.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireAuth };
