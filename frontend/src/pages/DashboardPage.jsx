import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get("/wallet/balance")
      .then((res) => setBalance(res.data.balance))
      .catch(() => setError("Could not load balance."));
  }, []);

  return (
    <div className="page">
      <div className="top-bar">
        <h1 style={{ margin: 0 }}>Hi, {user?.name || user?.email}</h1>
        <button onClick={logout}>Log Out</button>
      </div>

      <div className="balance-card">
        <div className="label">Wallet Balance</div>
        <div className="amount">
          {error ? "—" : balance === null ? "Loading..." : `₦${Number(balance).toLocaleString()}`}
        </div>
        {error && <p className="error-text" style={{ fontSize: 13 }}>{error}</p>}
      </div>

      <Link to="/fund" className="link-button">
        Fund Wallet
      </Link>
      <Link to="/buy" className="link-button">
        Buy Airtime / Data
      </Link>
      <Link to="/history" className="link-button">
        Transaction History
      </Link>
    </div>
  );
}