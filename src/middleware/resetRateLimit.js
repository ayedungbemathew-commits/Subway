const rateLimit = require("express-rate-limit");

// Skipped under Jest so the tests are not slowed down by the limits.
const skip = () => Boolean(process.env.JEST_WORKER_ID);

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: "Too many reset requests. Please try again later." },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: "Too many attempts. Please try again later." },
});

module.exports = { forgotLimiter, resetLimiter };
