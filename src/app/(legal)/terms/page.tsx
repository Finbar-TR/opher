import { LegalPage } from "../legal";

export const metadata = { title: "Terms of Service — Opher" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="17 August 2026">
      <p>
        These terms govern your use of Opher. By creating an account you agree to
        them.
      </p>
      <h2>How Opher works</h2>
      <p>
        You create or join baskets for food commodities and claim portions. When
        baskets merge into a whole bulk unit, an order is created and each member
        pays their share. Opher arranges bulk purchase and delivery of shares.
      </p>
      <h2>Payments</h2>
      <p>
        You pay only for the portions you claim, at the point an order is placed.
        Payments are processed by Stripe. If an order is cancelled, paid shares are
        refunded to the original payment method.
      </p>
      <h2>Deliveries</h2>
      <p>
        You are responsible for providing an accurate delivery address. Estimated
        delivery timings are not guaranteed.
      </p>
      <h2>Acceptable use</h2>
      <p>Don&apos;t misuse the service, and keep your account details secure.</p>
      <h2>Liability</h2>
      <p>
        Nothing in these terms limits liability that cannot be limited by law. Your
        statutory rights as a consumer are unaffected.
      </p>
    </LegalPage>
  );
}
