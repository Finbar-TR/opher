// Striped photo placeholder (or the real image when a URL exists).
export function PhotoSlot({
  caption,
  imageUrl,
  dark = false,
  className = "",
}: {
  caption?: string;
  imageUrl?: string | null;
  dark?: boolean;
  className?: string;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt={caption ?? ""}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <div
      className={`flex items-end p-3 ${dark ? "photo-slot-dark" : "photo-slot"} ${className}`}
    >
      {caption && (
        <span
          className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-[#a08064]" : "text-soft"
          }`}
        >
          {caption}
        </span>
      )}
    </div>
  );
}
