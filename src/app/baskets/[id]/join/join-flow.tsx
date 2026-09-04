"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { startJoin, completeJoin } from "./actions";
import type { AddressInput } from "@/lib/join-input";
import { formatGBP, formatPricePerKg } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

type Tier = {
  id: string;
  label: string;
  weightGrams: number;
  pricePence: number;
  pricePerKgPence: number;
};

type BasketProps = {
  id: string;
  productName: string;
  city: string;
  deliveryDate: string;
  cutoffAt: string;
  cutoffDays: number;
  tiers: Tier[];
};

type Props = {
  basket: BasketProps;
  savedAddress: AddressInput;
  utm: { source?: string; medium?: string; campaign?: string };
  publishableKey: string | null;
};

// The disclosure block. Its wording is a compliance requirement, not a style
// choice: a customer must be told plainly that their card will be charged
// automatically, on which date, and until when they can cancel for free.
function Disclosure({ basket }: { basket: BasketProps }) {
  return (
    <div className="rounded-xl border border-line bg-brand-50 p-4 text-[15px]">
      <p className="text-muted">
        Delivery: <strong className="text-ink">{formatWeekday(new Date(basket.deliveryDate))}</strong>
      </p>
      <p className="mt-1 font-semibold text-ink">
        Your card will be charged on {formatWeekday(new Date(basket.cutoffAt))}
      </p>
      <p className="mt-1 text-muted">Cancel free until then.</p>
    </div>
  );
}

export function JoinFlow({ basket, savedAddress, utm, publishableKey }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState(savedAddress);
  const [tierId, setTierId] = useState(basket.tiers[0]?.id ?? "");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState("");
  const [devPaymentMethodId, setDevPaymentMethodId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tier = basket.tiers.find((t) => t.id === tierId);

  async function goToPayment() {
    setBusy(true);
    setError(null);
    try {
      const res = await startJoin(basket.id);
      setClientSecret(res.clientSecret);
      setSetupIntentId(res.setupIntentId);
      setDevPaymentMethodId(res.devPaymentMethodId);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const stripePromise =
    publishableKey && clientSecret ? loadStripe(publishableKey) : null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-display text-[32px] leading-tight text-ink">
          Join {basket.productName}
        </h1>
        <p className="mt-1 text-muted">{basket.city}</p>
      </div>

      <ol className="flex gap-2 text-sm">
        {["Address", "Size", "Card"].map((name, i) => (
          <li
            key={name}
            className={`badge ${step === i + 1 ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
          >
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      {error && (
        <p className="rounded-xl border border-line bg-saffron p-3 text-sm font-medium text-saffron-ink">
          {error}
        </p>
      )}

      {step === 1 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <div>
            <label className="label" htmlFor="addrLine1">Address</label>
            <input
              id="addrLine1" className="input" required
              value={address.addrLine1}
              onChange={(e) => setAddress({ ...address, addrLine1: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="addrLine2">Address line 2 (optional)</label>
            <input
              id="addrLine2" className="input"
              value={address.addrLine2}
              onChange={(e) => setAddress({ ...address, addrLine2: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="addrCity">Town or city</label>
            <input
              id="addrCity" className="input" required
              value={address.addrCity}
              onChange={(e) => setAddress({ ...address, addrCity: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="postcode">Postcode</label>
            <input
              id="postcode" className="input" required
              value={address.postcode}
              onChange={(e) => setAddress({ ...address, postcode: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone (for the courier)</label>
            <input
              id="phone" className="input" required
              value={address.phone}
              onChange={(e) => setAddress({ ...address, phone: e.target.value })}
            />
          </div>
          <button type="submit" className="btn-primary w-full">Continue</button>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {basket.tiers.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center justify-between px-4 py-3">
                <span className="flex items-center gap-3">
                  <input
                    type="radio" name="tier" value={t.id}
                    checked={tierId === t.id}
                    onChange={() => setTierId(t.id)}
                  />
                  <span className="font-medium text-ink">{t.label}</span>
                </span>
                <span className="text-right">
                  <span className="font-semibold text-ink">{formatGBP(t.pricePence)}</span>
                  <span className="ml-2 text-sm text-muted">
                    {formatPricePerKg(t.pricePerKgPence)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Disclosure basket={basket} />
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn-primary flex-1" disabled={!tier || busy} onClick={goToPayment}>
              {busy ? "One moment…" : "Continue to card"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && tier && (
        <div className="space-y-4">
          <div className="card">
            <p className="font-semibold text-ink">
              {basket.productName} · {tier.label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink">
              {formatGBP(tier.pricePence)}
            </p>
          </div>
          <Disclosure basket={basket} />

          {clientSecret && stripePromise ? (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CardStep
                basketId={basket.id}
                tierId={tier.id}
                setupIntentId={setupIntentId}
                address={address}
                utm={utm}
                onError={setError}
              />
            </Elements>
          ) : (
            <DevCardStep
              basketId={basket.id}
              tierId={tier.id}
              setupIntentId={setupIntentId}
              paymentMethodId={devPaymentMethodId ?? ""}
              address={address}
              utm={utm}
              onError={setError}
            />
          )}

          <button className="btn-secondary w-full" onClick={() => setStep(2)}>Back</button>
        </div>
      )}
    </div>
  );
}

type StepProps = {
  basketId: string;
  tierId: string;
  setupIntentId: string;
  address: AddressInput;
  utm: { source?: string; medium?: string; campaign?: string };
  onError: (message: string) => void;
};

function CardStep(props: StepProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (error) {
        props.onError(error.message ?? "Your card could not be saved.");
        return;
      }
      const paymentMethodId =
        typeof setupIntent?.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id;
      if (!paymentMethodId) {
        props.onError("Your card could not be saved.");
        return;
      }

      const { orderId } = await completeJoin({
        basketId: props.basketId,
        tierId: props.tierId,
        setupIntentId: props.setupIntentId,
        paymentMethodId,
        address: props.address,
        utm: props.utm,
      });
      router.push(`/orders/${orderId}?joined=1`);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      <button className="btn-primary w-full" disabled={busy} onClick={submit}>
        {busy ? "Joining…" : "Join basket"}
      </button>
    </div>
  );
}

// The path taken when no Stripe publishable key is configured. It keeps the
// whole flow clickable in local development without keys, exactly as the
// server-side charging code does.
function DevCardStep(props: StepProps & { paymentMethodId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const { orderId } = await completeJoin({
        basketId: props.basketId,
        tierId: props.tierId,
        setupIntentId: props.setupIntentId,
        paymentMethodId: props.paymentMethodId,
        address: props.address,
        utm: props.utm,
      });
      router.push(`/orders/${orderId}?joined=1`);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-line bg-brand-50 p-3 text-sm text-muted">
        Stripe isn&apos;t configured, so this will save a placeholder card.
      </p>
      <button className="btn-primary w-full" disabled={busy} onClick={submit}>
        {busy ? "Joining…" : "Join basket"}
      </button>
    </div>
  );
}
