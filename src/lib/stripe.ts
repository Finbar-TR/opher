import Stripe from "stripe";

// Stripe is optional in local dev: if no key is set, `stripe` is null and the
// app falls back to a "mark as paid" dev path (see the payments actions).
const key = process.env.STRIPE_SECRET_KEY;

export const stripe = key ? new Stripe(key) : null;

export function stripeConfigured(): boolean {
  return Boolean(key);
}
