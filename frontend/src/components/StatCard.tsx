import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  note?: string;
  alarm?: boolean;
}

export default function StatCard({ label, value, note, alarm }: StatCardProps) {
  return (
    <div
      className="metric-card"
      style={alarm ? { borderColor: "var(--color-flag-ink)" } : undefined}
    >
      <div className="metric-label">{label}</div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: alarm ? "var(--color-flag-ink)" : "var(--text)",
          fontFamily: "var(--mono)",
          lineHeight: 1.15,
        }}
      >
        {value}
      </div>
      {note && <div className="metric-sub">{note}</div>}
    </div>
  );
}
