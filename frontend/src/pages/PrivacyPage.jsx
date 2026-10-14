import { Link } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import siteConfig from "../siteConfig";

export default function PrivacyPage() {
  return (
    <div className="legal">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Privacy policy</h1>
      <p className="meta">Last updated {siteConfig.lastUpdated}</p>

      <h2>1. What we collect</h2>
      <ul>
        <li>Your name and email address when you create an account.</li>
        <li>Your password, which we store only in scrambled (hashed) form, never as plain text.</li>
        <li>The phone numbers, networks and amounts you enter when you buy airtime or data.</li>
        <li>Records of your wallet funding, purchases and balance.</li>
        <li>Basic technical information, such as your IP address and browser type, in server logs.</li>
      </ul>

      <h2>2. Payments</h2>
      <p>
        Card and bank payments are handled by Paystack. We do not see or store your card details. We
        receive the payment status, amount and reference so we can credit your wallet.
      </p>

      <h2>3. How we use your information</h2>
      <p>
        We use it to run your account, process payments and purchases, keep the service secure, prevent
        fraud and abuse, and answer your questions.
      </p>

      <h2>4. Who we share it with</h2>
      <p>
        We share only what is needed with Paystack for payments, with our airtime and data provider to
        deliver your purchase (the phone number, network and amount), and with the hosting providers that
        run the service. We may also share information when the law requires it. We do not sell your
        personal information.
      </p>

      <h2>5. Security</h2>
      <p>
        We use encrypted connections and hashed passwords, and we limit who can reach the data. No
        system is perfectly secure, so please choose a strong password and keep it private.
      </p>

      <h2>6. How long we keep it</h2>
      <p>
        We keep account and transaction records for as long as we need them to run the service and to meet
        legal and accounting obligations.
      </p>

      <h2>7. Your choices</h2>
      <p>
        You can ask us to correct your details or to close your account through the{" "}
        <Link to="/contact">contact page</Link>. We may need to keep some transaction records after an
        account is closed.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>
        We may update this policy. The date at the top shows the latest version.
      </p>

      <SiteFooter />
    </div>
  );
}
