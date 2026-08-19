import { BrowserRouter, Navigate, Routes, Route, useParams } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Onboarding from "./pages/Onboarding";
import Candidate from "./pages/Candidate";
import Assessment from "./pages/Assessment";
import Account from "./pages/Account";
import OrgSettings from "./pages/OrgSettings";
import OrgQueue from "./pages/OrgQueue";
import OrgReview from "./pages/OrgReview";
import Exam from "./pages/Exam";
import Verify from "./pages/Verify";
import Label from "./pages/Label";
import CuedRecall from "./pages/CuedRecall";
import RequireCalibration from "./components/RequireCalibration";
import { ScreenCaptureProvider } from "./lib/screenCapture";
import { AuthProvider, NotFound, RequireAuth, RequireRole } from "./lib/auth";

/** `/employer/review/:sessionId` → `/org/review/:sessionId`, keeping the id.
 *
 *  A plain `<Navigate to="/org">` would drop the session and land the reviewer
 *  in the queue, which reads as the link being broken. */
function EmployerReviewRedirect() {
  const { sessionId = "" } = useParams();
  return <Navigate to={`/org/review/${sessionId}`} replace />;
}

export default function App() {
  return (
    // Capture provider ABOVE the router (invariant 1) — getDisplayMedia needs a
    // user gesture and cannot be silently re-acquired, so the stream must
    // survive navigation. AuthProvider sits INSIDE it, because auth state is
    // derived from a token and can be rebuilt on any mount; being inside the
    // router is what lets the guards preserve the intended destination.
    <ScreenCaptureProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            {/* The public verifier is NOT routed here. It has its own entry
                point (verify.html → src/verifier/main.tsx) and the host
                rewrites /c/* to it, so that the page a stranger loads carries
                none of this bundle's authenticated code — in particular not
                `apiFetch`, which attaches a bearer token.

                Declaring it here as well would put it back in this bundle and
                undo exactly the separation §14 asks for, which is why the
                route is absent rather than duplicated for convenience. */}

            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <Onboarding />
                </RequireAuth>
              }
            />
            <Route
              path="/candidate"
              element={
                <RequireRole roles={["candidate"]}>
                  <Candidate />
                </RequireRole>
              }
            />

            {/* The personalisation layer, before capture. Inside the capture
                provider like everything else, and does not touch it: the
                recording starts at calibration (invariant 2), which is after
                this. A participant who reaches /exam without preparing an
                assessment still gets a session — the exam falls back to its
                default problem and says so.

                The CV/skill-graph review that used to live at /profile is now
                part of /account (merged 2026-08-19 — see Account.tsx) since
                that page already owned "who am I to this system". /profile
                redirects rather than 404ing, for anyone who bookmarked it. */}
            <Route path="/profile" element={<Navigate to="/account" replace />} />
            <Route
              path="/assessment"
              element={
                <RequireRole roles={["candidate"]}>
                  <Assessment />
                </RequireRole>
              }
            />

            {/* Calibration is a gate on the session, and /exam is a URL — the
                guard is what stops a bookmark from bypassing onboarding.
                Authentication is checked first: an unauthenticated visitor
                should be sent to sign in, not told their calibration is stale. */}
            <Route
              path="/exam"
              element={
                <RequireAuth>
                  <RequireCalibration>
                    <Exam />
                  </RequireCalibration>
                </RequireAuth>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <Account />
                </RequireAuth>
              }
            />
            <Route
              path="/verify"
              element={
                <RequireAuth>
                  <Verify />
                </RequireAuth>
              }
            />

            {/* One portal, permission-based views — not two applications.
                Reviewers and org admins share these routes; the settings
                surface below is the only role split.

                `/org` is canonical. `/employer` REDIRECTS rather than mounting
                the same component a second time, which is the rename the
                frontend spec asks for. Two mounts of one page are two places a
                guard can be changed and one of them forgotten — and a bookmark
                that keeps working is the whole point of a redirect, so there is
                nothing to gain by duplicating instead. */}
            <Route
              path="/org"
              element={
                <RequireRole roles={["reviewer", "org_admin"]}>
                  <OrgQueue />
                </RequireRole>
              }
            />
            <Route path="/employer" element={<Navigate to="/org" replace />} />
            <Route
              path="/org/review/:sessionId"
              element={
                <RequireRole roles={["reviewer", "org_admin"]}>
                  <OrgReview />
                </RequireRole>
              }
            />
            <Route path="/employer/review/:sessionId" element={<EmployerReviewRedirect />} />
            <Route
              path="/org/settings"
              element={
                <RequireRole roles={["org_admin"]}>
                  <OrgSettings />
                </RequireRole>
              }
            />

            {/* Boundary-editing labelling tool — expert_a/expert_b, and manual
                cued_recall editing/resuming via its source selector. */}
            <Route
              path="/label/:sessionId"
              element={
                <RequireRole roles={["labeller", "staff"]}>
                  <Label />
                </RequireRole>
              }
            />
            {/* The cued-recall protocol itself (research plan §4, van Gog et
                al.): playback with cue points derived from the participant's own
                event log, at each of which they are asked an open question and
                their spoken answer is recorded. Submitted through POST
                /sessions/{id}/narration — NOT a labels writer. The narration
                carries no phase, because the taxonomy is the thing under test;
                mapping it onto phases is a later researcher step that goes
                through the /label route above. */}
            <Route
              path="/cued-recall/:sessionId"
              element={
                <RequireAuth>
                  <CuedRecall />
                </RequireAuth>
              }
            />

            {/* Identical to what a role refusal renders, so the two are
                indistinguishable to someone probing for structure. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ScreenCaptureProvider>
  );
}
