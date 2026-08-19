import { useEffect, useId, useRef } from "react";

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" tints the confirm button red for destructive actions. */
  tone?: "neutral" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Accessible confirmation modal. Traps initial focus on the safe (cancel)
 * button, closes on Escape or backdrop click, and labels itself for
 * screen readers via aria-labelledby/aria-describedby.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "neutral",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe choice on open and close on Escape.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="pp-modal-overlay"
      onMouseDown={(e) => {
        // Only cancel on a click that starts and ends on the backdrop itself.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="pp-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
        <h2 id={titleId}>{title}</h2>
        <p id={descId}>{message}</p>
        <div className="pp-modal-actions">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
