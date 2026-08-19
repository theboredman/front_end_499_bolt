import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import PublicVerifier from "../pages/PublicVerifier";
import "../index.css";

// The verifier's own entry point. It mounts exactly one route and imports no
// authenticated surface — in particular it never reaches `apiFetch`, which
// would attach a bearer token to a page that must not send one.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/c/:credentialId" element={<PublicVerifier />} />
        {/* Any other path renders the same "could not be verified" page rather
            than nothing. A blank white page in front of someone checking a
            stranger's credential reads as a broken or fraudulent link; an
            honest refusal reads as a working check that found nothing. */}
        <Route path="*" element={<PublicVerifier />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
