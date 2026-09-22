require("dotenv").config();
const express = require("express");
const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const vtuRoutes = require("./routes/vtuRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const { webhook } = require("./controllers/paymentController");

const app = express();

// Mounted BEFORE express.json() so the webhook gets the raw body for signature verification.
app.post("/payments/webhook", express.raw({ type: "application/json" }), webhook);

app.use(express.json());
app.use("/auth", authRoutes);
app.use("/wallet", walletRoutes);
app.use("/vtu", vtuRoutes);
app.use("/payments", paymentRoutes);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

module.exports = app;