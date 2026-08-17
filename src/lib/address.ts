// Delivery-address helpers. A member must have a usable address before claiming a
// portion, so every order the merge engine produces is shippable.

export type AddressFields = {
  addrLine1: string | null;
  addrLine2: string | null;
  addrCity: string | null;
  postcode: string | null;
  phone: string | null;
};

export function hasDeliveryAddress(u: AddressFields): boolean {
  return Boolean(u.addrLine1 && u.addrCity && u.postcode && u.phone);
}

export function formatAddress(u: AddressFields): string {
  return [u.addrLine1, u.addrLine2, u.addrCity, u.postcode]
    .filter(Boolean)
    .join(", ");
}
