require("dotenv").config();
const express = require("express");
const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const vtuRoutes = require("./routes/vtuRoutes");

const app = express();

app.use(express.json());
app.use("/auth", authRoutes);
app.use("/wallet", walletRoutes);
app.use("/vtu", vtuRoutes);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

module.exports = app;