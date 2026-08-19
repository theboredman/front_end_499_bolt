import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Three bundles (Frontend Spec §14), and the separation is a security boundary
// rather than a build preference.
//
//   index.html   customer app — candidate and organisation portals
//   admin.html   internal tooling, behind separate authentication (§7.3)
//   verify.html  the public credential verifier (§7.1)
//
// Why admin is separate: shipped in the customer bundle, its route definitions
// and API surface are readable by any customer who opens devtools, and one
// guard bug exposes platform-wide tooling rather than one tenant's data.
//
// Why the verifier is separate: it must load fast for a stranger with no
// account, share no code path with authenticated surfaces, and — critically —
// never carry the code that attaches a bearer token. A verifier that behaved
// differently for a signed-in reader would be reporting on the reader rather
// than on the credential.
//
// The verifier answers /c/:credentialId, which is not where its entry point
// lives, so something has to rewrite /c/* to verify.html. In production that is
// the host. In development it is the plugin below.
//
// Both are required, and the dev half is not a convenience. Without it the dev
// server's SPA fallback hands /c/* to index.html — the customer bundle, which
// deliberately does not route /c/* — so the verifier renders a not-found page
// locally and works only once deployed. That is the worst arrangement
// available: the one surface whose whole purpose is to be trustworthy to a
// stranger becomes the one surface nobody can look at before shipping it.
function serveVerifierAtItsRealPath() {
  return {
    name: "problemproof:verifier-rewrite",
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/c\/[^/?#]+/.test(req.url)) req.url = "/verify.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveVerifierAtItsRealPath()],
  // One configuration file for the whole project, at the repository root.
  // The backend reads the same file via backend/problemproof/env.py.
  //
  // Only VITE_-prefixed variables are exposed to the bundle, so the NIM API key
  // and the rest of the backend settings in that file stay server-side.
  envDir: "..",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
        verify: resolve(__dirname, "verify.html"),
      },
    },
  },
});
