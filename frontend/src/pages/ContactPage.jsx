import { Link } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import siteConfig from "../siteConfig";

export default function ContactPage() {
  const { contactEmail, whatsapp } = siteConfig;

  return (
    <div className="legal">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Contact us</h1>

      {contactEmail || whatsapp ? (
        <>
          <p>Have a question about your wallet, a payment or a purchase? Reach us here.</p>
          <ul>
            {contactEmail && (
              <li>
                Email: <a href={"mailto:" + contactEmail}>{contactEmail}</a>
              </li>
            )}
            {whatsapp && (
              <li>
                WhatsApp: <a href={"https://wa.me/" + whatsapp}>+{whatsapp}</a>
              </li>
            )}
          </ul>
        </>
      ) : (
        <p>Support contact details will be added here soon.</p>
      )}

      <h2>When you write to us</h2>
      <p>
        Include the email address on your account. If your message is about a purchase, add the phone
        number, the network, the amount and roughly when you bought it. If it is about a payment, add
        the amount and the time you paid. Never send your password.
      </p>

      <SiteFooter />
    </div>
  );
}
