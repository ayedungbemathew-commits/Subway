import { Link } from "react-router-dom";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link to="/terms">Terms</Link>
      <Link to="/privacy">Privacy</Link>
      <Link to="/contact">Contact</Link>
    </footer>
  );
}
