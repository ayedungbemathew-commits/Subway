import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";

export default function HistoryPage() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get("/wallet/transactions")
      .then((res) => setEntries(res.data.entries))
      .catch(() => setError("Could not load transaction history."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Transaction History</h1>

      {loading && <p>Loading...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && entries.length === 0 && <p>No transactions yet.</p>}

      {entries.map((e) => (
        <div key={e.id} className="history-item">
          <div>
            <div className="desc">{e.description || e.type}</div>
            <div className="date">{new Date(e.createdAt).toLocaleString()}</div>
          </div>
          <div className={`amount ${e.type === "DEBIT" ? "debit" : "credit"}`}>
            {e.type === "DEBIT" ? "-" : "+"}₦{Number(e.amount).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}