import { requireOperator } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OperatorHome() {
  await requireOperator();

  return (
    <div>
      <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
        Today in the kitchen
      </h1>
      <p className="mt-4 text-[17px] text-muted">
        Basket management returns in the next release.
      </p>
    </div>
  );
}
