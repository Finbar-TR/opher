import { LegalPage } from "../legal";

export const metadata = { title: "Cookie Notice — Opher" };

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Notice" updated="17 August 2026">
      <p>
        Opher uses the minimum cookies needed to run the service. We do not use
        advertising or third-party tracking cookies.
      </p>
      <h2>Essential cookies</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Session cookie</strong> (<code>opher_session</code>): keeps you
          signed in. It&apos;s strictly necessary and set only after you log in.
        </li>
      </ul>
      <p>
        Because we only use strictly-necessary cookies, no consent banner is
        required — but confirm this remains true if you later add analytics.
      </p>
    </LegalPage>
  );
}
