require("dotenv").config();
const express = require("express");
const morgan = require("morgan");
const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const vtuRoutes = require("./routes/vtuRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const { webhook } = require("./controllers/paymentController");
const { generalLimiter } = require("./middleware/rateLimit");

const app = express();

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

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

module.exports = app;