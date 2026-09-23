require("dotenv").config();
const VtuNgProvider = require("./src/providers/vtuNgProvider");

async function main() {
  const provider = new VtuNgProvider();
  console.log("Attempting login...");
  const token = await provider.getToken();
  console.log("Login successful. Token (first 20 chars):", token.slice(0, 20) + "...");

  console.log("Checking balance...");
  const balance = await provider.checkBalance();
  console.log("Balance:", balance);
}

main().catch((error) => {
  console.error("FAILED:", error.message);
});