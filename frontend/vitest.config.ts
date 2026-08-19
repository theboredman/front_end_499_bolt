import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The frontend test runner (Frontend Spec §13).
//
// This does NOT replace the Python tests in backend/tests that read .tsx files
// as text. Those assert structural invariants — that the exam route is guarded,
// that the guard consumes a ticket rather than reading a stored profile, that
// the phase rail carries no phase vocabulary — and a text assertion is the
// right shape for a claim about what the source may not contain. It survives
// refactors that a rendering test would not, and it cannot be satisfied by a
// mock.
//
// What it could never do is exercise behaviour. That is what lives here.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
