import { z } from "zod";

// Shared by the server action and the client form. It cannot live in
// `actions.ts`: a "use server" module may export only async functions, so a
// type or const export from there fails the build.
//
// `addrLine2` is a required string that may be empty, rather than optional —
// it keeps the controlled input's value a `string` throughout and spares the
// client component an intersection type to add it back.
export const addressSchema = z.object({
  addrLine1: z.string().trim().min(1, "Enter your address"),
  addrLine2: z.string().trim(),
  addrCity: z.string().trim().min(1, "Enter your town or city"),
  postcode: z.string().trim().min(5, "Enter a valid postcode"),
  phone: z.string().trim().min(6, "Enter a phone number for the courier"),
});

export type AddressInput = z.infer<typeof addressSchema>;
