import { Link } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import siteConfig from "../siteConfig";

export default function LandingPage() {
  return (
    <div className="landing">
      <h1>{siteConfig.name}: airtime and data from one wallet</h1>
      <p className="lead">
        Add money with Paystack, then top up MTN, Airtel, Glo and 9mobile numbers whenever you need to.
      </p>

      <div className="cta-row">
        <Link to="/login?mode=register" className="cta-button">Create account</Link>
        <Link to="/login" className="cta-button secondary">Log in</Link>
      </div>

      <ul className="feature-list">
        <li>
          <strong>One wallet</strong>
          <span>Fund it once and spend it on airtime or data.</span>
        </li>
        <li>
          <strong>Four networks</strong>
          <span>MTN, Airtel, Glo and 9mobile.</span>
        </li>
        <li>
          <strong>A record of everything</strong>
          <span>Every funding and purchase appears in your transaction history.</span>
        </li>
      </ul>

      <SiteFooter />
    </div>
  );
}
