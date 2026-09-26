import { useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";

export default function FundWalletPage() {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
       const callbackUrl = `${window.location.origin}/payment/callback`;
      const res = await client.post("/payments/initialize", { amount: Number(amount), callbackUrl });
      window.location.href = res.data.authorizationUrl;
    } catch (err) {
      setError(err.response?.data?.error || "Could not start payment. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Fund Wallet</h1>

      <form onSubmit={handleSubmit}>
        <label>Amount (₦)</label>
        <input
          type="number"
          min="100"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Redirecting..." : "Continue to Payment"}
        </button>
      </form>
    </div>
  );
}