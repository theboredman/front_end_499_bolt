type LogoProps = {
  size?: number;
  wordmarkSize?: number;
  dark?: boolean;
  /** Hide the wordmark — for favicons, avatars and tight chrome. */
  markOnly?: boolean;
};

/** The Verification Pulse mark: a ring with a waveform spike through it,
 *  the peak tipped in coral.
 *
 *  From the style reference's component list. It replaces a bordered square
 *  with a dot in it, which said nothing about the product; this reads as a
 *  heartbeat-monitor blip inside a ring, which is the whole thesis — the
 *  honesty of the trace is the product.
 *
 *  Drawn as SVG rather than nested divs so it stays sharp at favicon scale and
 *  so the spike is a real path that could later animate left-to-right as the
 *  loading state the reference describes.
 */
export default function Logo({ size = 28, wordmarkSize = 15, dark = false, markOnly = false }: LogoProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        style={{ flexShrink: 0, display: "block" }}
      >
        <circle cx="16" cy="16" r="14" stroke="var(--color-cognition-blue)" strokeWidth="2" />
        {/* The trace. Deliberately uneven — the reference is explicit that a
            too-regular line reads as fake data, which undercuts the premise. */}
        <path
          d="M4 16 H10 L12.5 16 L14.5 9.5 L18 22 L20 16 H28"
          stroke="var(--color-cognition-blue)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* The peak, tipped in coral: the one moment of the signal colour. */}
        <path
          d="M14.5 9.5 L18 22"
          stroke="var(--color-signal-coral)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!markOnly && (
        <span
          style={{
            fontFamily: "var(--sans)",
            fontWeight: 600,
            fontSize: wordmarkSize,
            letterSpacing: "-0.01em",
            color: dark ? "var(--color-porcelain)" : "var(--color-graphite-ink)",
          }}
        >
          ProblemProof
        </span>
      )}
    </div>
  );
}
