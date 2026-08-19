interface MiniTrendChartProps {
  data: number[];
  height?: number;
  color?: string;
}

/** SVG sparkline. Renders null when fewer than 2 data points — a single
 *  value is not a trend, and showing a flat line for one session would
 *  imply a direction that doesn't exist. */
export default function MiniTrendChart({
  data,
  height = 32,
  color = "var(--teal)",
}: MiniTrendChartProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const width = 80;
  const padding = 2;

  const points = data
    .map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
