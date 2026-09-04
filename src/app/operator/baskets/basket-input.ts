// Shared by the server action and the client form. It cannot live in
// `actions.ts`: a "use server" module may export only async functions, so a
// type or const export from there fails the build. Same reason as
// `lib/join-input.ts`.

// Four tier rows are the most a basket can have, so the form never renders more.
export const TIER_ROWS = 4;

// Every field as the operator typed it, so a rejected submit can put their
// words back in the boxes instead of wiping a form with up to fifteen of them.
export type BasketFormValues = {
  cityId: string;
  skuId: string;
  label: string;
  tierLabels: string[];
  tierWeights: string[];
  tierPrices: string[];
};

// The `useActionState` shape. An expected operator mistake — a half-filled
// size row, a city that already has this food — is a return value, not a
// thrown error: Next only serializes a real `Error.message` to the error
// boundary in development, and substitutes a generic paragraph in production.
export type BasketFormState = {
  error: string | null;
  values: BasketFormValues | null;
};

export const EMPTY_BASKET_FORM: BasketFormState = { error: null, values: null };
