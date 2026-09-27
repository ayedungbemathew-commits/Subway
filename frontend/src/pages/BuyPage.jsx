import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import client from "../api/client";

export default function BuyPage() {
  const [type, setType] = useState("airtime");
  const [networks, setNetworks] = useState([]);
  const [dataPlans, setDataPlans] = useState([]);
  const [networkCode, setNetworkCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [variationId, setVariationId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    client.get("/catalog/networks").then((res) => {
      const active = res.data.networks.filter((n) => n.status === "ACTIVE");
      setNetworks(active);
      if (active.length > 0) setNetworkCode(active[0].code);
    });
  }, []);

  useEffect(() => {
    if (type === "data" && networkCode) {
      client.get(`/catalog/data-plans?networkId=${networks.find((n) => n.code === networkCode)?.id}`).then((res) => {
        const active = res.data.dataPlans.filter((p) => p.status === "ACTIVE");
                setDataPlans(active);
        if (active.length > 0) setVariationId(String(active[0].id));
      });
    }
  }, [type, networkCode, networks]);

    async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!phoneNumber || phoneNumber.length < 10 || phoneNumber.length > 15) {
      setError("Enter a valid phone number.");
      return;
    }

    if (type === "airtime" && (!amount || Number(amount) <= 0)) {
      setError("Enter a valid amount.");
      return;
    }

    setLoading(true);
    const reference = `WEB-${type.toUpperCase()}-${Date.now()}`;

    try {
      if (type === "airtime") {
        await client.post("/vtu/airtime", {
          networkCode,
          phoneNumber,
          amount: Number(amount),
          reference,
        });
      } else {
        await client.post("/vtu/data", {
          networkCode,
          phoneNumber,
          dataPlanId: Number(variationId),
          reference,
        });
      }      setSuccess("Purchase successful!");
      setTimeout(() => navigate("/history"), 1200);
    } catch (err) {
      setError(err.response?.data?.error || "Purchase failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Buy Airtime / Data</h1>

      <div className="tab-buttons">
        <button
          type="button"
          className={type === "airtime" ? "active" : ""}
          onClick={() => setType("airtime")}
        >
          Airtime
        </button>
        <button
          type="button"
          className={type === "data" ? "active" : ""}
          onClick={() => setType("data")}
        >
          Data
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <label>Network</label>
        <select value={networkCode} onChange={(e) => setNetworkCode(e.target.value)}>
          {networks.map((n) => (
            <option key={n.id} value={n.code}>
              {n.name}
            </option>
          ))}
        </select>

        <label>Phone Number</label>
        <input
          type="tel"
          required
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="08012345678"
        />

        {type === "airtime" ? (
          <>
            <label>Amount (₦)</label>
            <input
              type="number"
              min="10"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </>
        ) : (
          <>
            <label>Data Plan</label>
            <select value={variationId} onChange={(e) => setVariationId(e.target.value)}>
                            {dataPlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₦{p.sellingPrice}
                </option>
              ))}
            </select>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        {success && <p className="success-text">{success}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Processing..." : "Buy Now"}
        </button>
      </form>
    </div>
  );
}