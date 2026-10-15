require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const vtuRoutes = require("./routes/vtuRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const { webhook } = require("./controllers/paymentController");
const { generalLimiter } = require("./middleware/rateLimit");

const app = express();
// Render puts one proxy in front of the app. Without this, every visitor shares the
// proxy's IP address and the rate limits would count all users together.
app.set("trust proxy", 1);

app.use(helmet());

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  })
);

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Mounted BEFORE express.json() so the webhook gets the raw body for signature verification.
// Not rate-limited: this is called by Paystack's servers, not end users.
app.post("/payments/webhook", express.raw({ type: "application/json" }), webhook);

app.use(express.json());
app.use(generalLimiter);

app.use("/auth", authRoutes);
app.use("/wallet", walletRoutes);
app.use("/vtu", vtuRoutes);
app.use("/payments", paymentRoutes);
app.use("/admin", adminRoutes);
app.use("/catalog", catalogRoutes);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

module.exports = app;