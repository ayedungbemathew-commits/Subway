import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="page" style={{ textAlign: "center" }}>
      <h1>Page Not Found</h1>
      <p style={{ color: "#999" }}>The page you're looking for doesn't exist.</p>
      <Link to="/" className="back-link">&larr; Back to Dashboard</Link>
    </div>
  );
}