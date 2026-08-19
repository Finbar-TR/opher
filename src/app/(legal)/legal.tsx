// Shared shell for the legal pages. The content is a starting-point TEMPLATE —
// have a UK solicitor review before you rely on it publicly.

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="font-display text-[38px] leading-tight text-ink">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated: {updated}</p>
      <div className="mt-4 rounded-lg bg-accent-400/15 px-4 py-3 text-sm text-accent-600">
        Template only — review with a qualified UK solicitor before launch.
      </div>
      <div className="prose mt-6 space-y-4 text-ink [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:text-muted [&_li]:text-muted">
        {children}
      </div>
    </article>
  );
}
