import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import client from "../api/client";
import SiteFooter from "../components/SiteFooter";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await client.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1>Choose a new password</h1>

      {!token ? (
        <>
          <p className="error-text">This reset link is not valid.</p>
          <Link to="/forgot-password" className="back-link">Request a new link</Link>
        </>
      ) : done ? (
        <>
          <p className="success-text">Your password has been updated.</p>
          <Link to="/login" className="back-link">Go to log in</Link>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>New password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />

          <label>Confirm new password</label>
          <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />

          {error && <p className="error-text">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "Please wait..." : "Update password"}
          </button>
        </form>
      )}

      <SiteFooter />
    </div>
  );
}
