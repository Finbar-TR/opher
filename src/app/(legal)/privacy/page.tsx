import { LegalPage } from "../legal";

export const metadata = { title: "Privacy Policy — Opher" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="2 September 2026">
      <p>
        Opher (&quot;we&quot;) processes personal data to run a group food-buying
        service. This policy explains what we collect and your rights under UK GDPR.
      </p>
      <h2>What we collect</h2>
      <ul className="list-disc pl-5">
        <li>Account details: name, email, password (stored hashed).</li>
        <li>Delivery details: address and phone, used to deliver your order.</li>
        <li>
          Order and payment records. Card data is handled by Stripe, not by us: when
          you join a basket your card is saved with Stripe so it can be charged when
          the basket closes, and we hold only Stripe&apos;s references to it.
        </li>
      </ul>
      <h2>Why we use it</h2>
      <p>
        To operate baskets and orders, take payment for your order when your basket
        closes, arrange delivery, and send you transactional emails about your
        orders. Our lawful bases are contract performance and legitimate interests.
      </p>
      <h2>Sharing</h2>
      <p>
        We share data with processors who help us operate: Stripe (payments) and our
        email provider. We share delivery details with our logistics function to
        fulfil orders. We do not sell your data.
      </p>
      <h2>Your rights</h2>
      <p>
        You may access, correct, or delete your data, and object to processing.
        Contact us to exercise these rights or to complain to the ICO.
      </p>
      <h2>Retention</h2>
      <p>We keep order records as long as needed for legal and accounting purposes.</p>
    </LegalPage>
  );
}
