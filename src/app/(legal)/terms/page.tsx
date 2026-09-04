import { LegalPage } from "../legal";

export const metadata = { title: "Terms of Service — Opher" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="2 September 2026">
      <p>
        These terms govern your use of Opher. By creating an account you agree to
        them.
      </p>
      <h2>How Opher works</h2>
      <p>
        Opher creates the baskets. Each basket offers one food item to one city
        for a particular delivery, in a small number of sizes at a fixed price.
        You join a basket by choosing a size; that is your order. Opher buys in
        bulk and arranges delivery.
      </p>
      <h2>Payments</h2>
      <p>
        Joining a basket saves your card details with Stripe, our payment
        processor, but does not charge you at that point. Each delivery has a
        closing time, stated on the basket when you join, which falls three days
        before the delivery date. At that time joining closes and your saved card
        is charged automatically for the price shown when you joined. Payments
        are processed by Stripe; Opher does not hold your card details.
      </p>
      <h2>Cancellation</h2>
      <p>
        You may cancel your order at any time before your basket closes, at no
        cost — nothing has been charged yet. Once the basket has closed, the
        order cannot be cancelled and the charge stands. If we cancel an order or
        fail to deliver it, we refund the amount charged to the original payment
        method. Your statutory rights as a consumer are unaffected.
      </p>
      <h2>Deliveries</h2>
      <p>
        You are responsible for providing an accurate delivery address. Estimated
        delivery timings are not guaranteed. A delivery may be moved to the next
        scheduled delivery date for your city; if that happens we will tell
        everyone who has joined a basket in that delivery.
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
