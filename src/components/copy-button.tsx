"use client";

import { useState } from "react";

export function CopyButton({
  value,
  label = "Copy invite link",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn-secondary py-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard may be unavailable (e.g. insecure context); ignore.
        }
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
