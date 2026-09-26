import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import client from "../api/client";

export default function PaymentCallbackPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("verifying");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const reference = searchParams.get("reference") || searchParams.get("trxref");

    if (!reference) {
      setStatus("error");
      setError("No payment reference found.");
      return;
    }

    client
      .post(`/payments/${reference}/verify`)
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate("/"), 2000);
      })
      .catch((err) => {
        setStatus("error");
        setError(err.response?.data?.error || "Could not verify payment.");
      });
  }, [searchParams, navigate]);

  return (
    <div className="page" style={{ textAlign: "center" }}>
      {status === "verifying" && <p>Verifying your payment...</p>}

      {status === "success" && (
        <>
          <h1>Payment Successful</h1>
          <p>Your wallet has been credited. Redirecting...</p>
        </>
      )}

      {status === "error" && (
        <>
          <h1>Payment Verification Failed</h1>
          <p className="error-text">{error}</p>
          <Link to="/" className="back-link">Back to Dashboard</Link>
        </>
      )}
    </div>
  );
}