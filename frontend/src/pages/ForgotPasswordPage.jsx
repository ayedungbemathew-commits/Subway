import { useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import SiteFooter from "../components/SiteFooter";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await client.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Link to="/login" className="back-link">&larr; Back to log in</Link>
      <h1>Forgot password</h1>

      {sent ? (
        <p className="success-text">
          If an account exists for that email, we have sent a reset link. It expires in 30 minutes.
          Check your spam folder if it does not arrive.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <p style={{ color: "#aaa", fontSize: 14 }}>
            Enter your account email and we will send you a link to choose a new password.
          </p>

          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />

          {error && <p className="error-text">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "Please wait..." : "Send reset link"}
          </button>
        </form>
      )}

      <SiteFooter />
    </div>
  );
}
