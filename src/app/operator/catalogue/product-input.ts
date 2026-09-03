// Shared by the server action and the client form. It cannot live in
// `actions.ts`: a "use server" module may export only async functions, so a
// type or const export from there fails the build. Same reason as
// `lib/join-input.ts`.

// Ceilings on the two numbers. `weightGrams` and `wholesaleCostPence` are
// Prisma `Int`s — 32-bit — so an unbounded "1e9" reaches the database as a raw
// driver error rather than a sentence. Ten tonnes and a million pounds are far
// beyond any real bulk unit and far below the 2,147,483,647 limit.
export const MAX_BULK_WEIGHT_KG = 10_000;
export const MAX_BULK_COST_POUNDS = 1_000_000;

// Every field as the operator typed it, so a rejected submit can put their
// words back in the boxes instead of wiping the form.
export type ProductFormValues = {
  name: string;
  description: string;
  category: string;
  skuLabel: string;
  weightKg: string;
  wholesaleCostPounds: string;
};

// The `useActionState` shape: an expected operator mistake is a return value,
// not a thrown error. Next only serializes a real `Error.message` to the error
// boundary in development — in production it substitutes a generic paragraph —
// so a message that has to be read has to come back this way.
export type ProductFormState = {
  error: string | null;
  values: ProductFormValues | null;
};

export const EMPTY_PRODUCT_FORM: ProductFormState = { error: null, values: null };
