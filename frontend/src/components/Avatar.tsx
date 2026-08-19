// Initials, not photographs.
//
// Deliberate, and worth stating because "add avatar upload" is the obvious
// next request. This product runs face matching against an enrolled
// embedding, and Identity Spec §4.5 requires enrollment to come from a live
// liveness-checked capture — an uploaded photograph can be anyone's. The
// moment a profile holds a user-supplied face image, that image is one careless
// import away from becoming an enrollment artifact, and the rule against it
// becomes a thing people have to remember rather than a thing the system
// cannot do.
//
// There is no upload path here, so there is nothing to remember. It also skips
// storage, moderation, EXIF stripping, and a second place personal data lives.

// Stops along the blue-to-coral signal gradient, and nothing else.
//
// The style reference reserves Verified Mint and Flag Red strictly for state,
// never decoration — so an avatar must not draw from them. A colleague
// rendered in Flag Red reads as "this person is flagged", which is a claim the
// roster is not making.
//
// Every stop clears 4.5:1 against the white initials sitting on it. The fourth
// is darker than the corresponding layer-dot stop for exactly that reason: a
// dot carries no text and can stay vivid, an avatar carries two letters.
const PALETTE = [
  "#3F4CE0",
  "#6A4FCB",
  "#9553B0",
  "#C34B76",
  "#E52500",
];

/** Up to two initials from a display name, falling back to the first letter. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable colour from an id.
 *
 *  Keyed on the id rather than the name so someone's avatar does not change
 *  colour when they correct a typo in their own name. */
export function colourFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export default function Avatar({
  id,
  name,
  size = 32,
  title,
}: {
  id: string;
  name: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      // Decorative: the name is always rendered beside it, so announcing the
      // initials again would just make a screen reader say it twice.
      aria-hidden
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: colourFor(id),
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--mono)",
        fontSize: size * 0.38,
        fontWeight: 600,
        letterSpacing: ".02em",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
