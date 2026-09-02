"use client";

import { useActionState } from "react";
import {
  updateProfileAction,
  changePasswordAction,
  type AccountState,
} from "./actions";

type Profile = {
  name: string;
  addrLine1: string;
  addrLine2: string;
  addrCity: string;
  postcode: string;
  phone: string;
};

function Notice({ state }: { state: AccountState }) {
  if (state.error)
    return (
      <p className="rounded-lg bg-saffron px-3 py-2 text-sm font-medium text-tomato-press">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
        {state.ok}
      </p>
    );
  return null;
}

export function ProfileForm({ initial }: { initial: Profile }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    updateProfileAction,
    {}
  );

  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-semibold text-ink">Profile & delivery address</h2>
      <p className="text-sm text-muted">
        A full address and phone number are required before you can join a basket —
        it&apos;s where your order gets delivered.
      </p>

      <div>
        <label className="label" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" className="input" defaultValue={initial.name} required />
      </div>
      <div>
        <label className="label" htmlFor="addrLine1">
          Address line 1
        </label>
        <input id="addrLine1" name="addrLine1" className="input" defaultValue={initial.addrLine1} />
      </div>
      <div>
        <label className="label" htmlFor="addrLine2">
          Address line 2 (optional)
        </label>
        <input id="addrLine2" name="addrLine2" className="input" defaultValue={initial.addrLine2} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="addrCity">
            Town / city
          </label>
          <input id="addrCity" name="addrCity" className="input" defaultValue={initial.addrCity} />
        </div>
        <div>
          <label className="label" htmlFor="postcode">
            Postcode
          </label>
          <input id="postcode" name="postcode" className="input" defaultValue={initial.postcode} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="phone">
          Phone
        </label>
        <input id="phone" name="phone" className="input" defaultValue={initial.phone} />
      </div>

      <Notice state={state} />
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    changePasswordAction,
    {}
  );

  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-semibold text-ink">Change password</h2>
      <div>
        <label className="label" htmlFor="currentPassword">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          className="input"
          autoComplete="current-password"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="newPassword">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          required
        />
      </div>
      <Notice state={state} />
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
