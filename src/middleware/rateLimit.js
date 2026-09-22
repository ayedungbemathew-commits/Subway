const rateLimit = require("express-rate-limit");

// General limiter for most authenticated endpoints.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// Stricter limiter for auth endpoints (login/register) to slow down
// credential-stuffing and brute-force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

module.exports = { generalLimiter, authLimiter };