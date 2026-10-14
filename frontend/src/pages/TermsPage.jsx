import { Link } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import siteConfig from "../siteConfig";

export default function TermsPage() {
  return (
    <div className="legal">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Terms of use</h1>
      <p className="meta">Last updated {siteConfig.lastUpdated}</p>

      <h2>1. About {siteConfig.name}</h2>
      <p>
        {siteConfig.name} is a wallet-based service for buying mobile airtime and data. By creating an
        account or using the service, you agree to these terms. If you do not agree, please do not use
        the service.
      </p>

      <h2>2. Your account</h2>
      <p>
        Give accurate information when you sign up and keep your password private. You are responsible
        for everything done through your account. We may suspend or disable an account that breaks
        these terms or shows signs of fraud or abuse.
      </p>

      <h2>3. Funding your wallet</h2>
      <p>
        Payments are processed by Paystack. Your wallet is credited after Paystack confirms the payment.
        Your wallet balance is a prepaid balance for buying airtime and data on {siteConfig.name}. It is
        not a bank account and does not earn interest.
      </p>

      <h2>4. Buying airtime and data</h2>
      <p>
        Check the network and phone number before you confirm. Airtime or data sent to a wrong number
        usually cannot be recovered. The price is shown when you buy, and your wallet is charged when the
        purchase completes. If a purchase fails, your wallet is not charged. If you think you were
        charged for a purchase that did not arrive, contact us.
      </p>

      <h2>5. Refunds</h2>
      <p>
        Wallet money is meant to be spent on purchases. If you want a refund of unused wallet money or
        have a problem with a transaction, contact us and we will review it case by case.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        Do not use {siteConfig.name} for fraud, for anything unlawful, or to disrupt or attack the
        service. Do not use another person's payment details without their permission.
      </p>

      <h2>7. Availability</h2>
      <p>
        The service depends on third parties such as Paystack and mobile network providers. We may be
        unable to complete a purchase when they are unavailable, and we are not responsible for delays
        outside our control.
      </p>

      <h2>8. Limits on our responsibility</h2>
      <p>
        To the extent the law allows, {siteConfig.name} is not liable for indirect or consequential
        losses arising from use of the service. Nothing in these terms limits any right you have that
        cannot be limited by law.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>
        We may update these terms from time to time. The date at the top shows the latest version.
        Continuing to use the service after a change means you accept the new terms.
      </p>

      <h2>10. Governing law and contact</h2>
      <p>
        These terms are governed by the laws of the Federal Republic of Nigeria. Questions about them can
        be sent through the <Link to="/contact">contact page</Link>.
      </p>

      <SiteFooter />
    </div>
  );
}
