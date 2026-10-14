import { useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import SiteFooter from "../components/SiteFooter";

export default function AuthPage() {
  const [mode, setMode] = useState(new URLSearchParams(window.location.search).get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { login } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = mode === "login" ? { email, password } : { email, password, name };

      const res = await client.post(endpoint, payload);
      login(res.data.token, res.data.user);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1 style={{ textAlign: "center" }}>{mode === "login" ? "Log In" : "Create Account"}</h1>

      <form onSubmit={handleSubmit}>
        {mode === "register" && (
          <>
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}

        <label>Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />

        <label>Password</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Please wait..." : mode === "login" ? "Log In" : "Create Account"}
        </button>
      </form>

      <p style={{ textAlign: "center", marginTop: 16, fontSize: 14 }}>
        {mode === "login" ? (
          <>
            Don't have an account?{" "}
            <button
              type="button"
              onClick={() => setMode("register")}
              style={{ border: "none", background: "none", color: "#8ab4f8", cursor: "pointer" }}
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => setMode("login")}
              style={{ border: "none", background: "none", color: "#8ab4f8", cursor: "pointer" }}
            >
              Log in
            </button>
          </>
        )}
      </p>
    <SiteFooter />
    </div>
  );
}
