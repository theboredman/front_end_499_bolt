// The backend base URL, shared by every client in this folder.
//
// Extractor A, Stream B capture intake and baseline calibration are all served
// by the same FastAPI app (backend/problemproof/api/app.py), so they share one
// origin. They were developed as separate services against separate env vars;
// this is the single knob that replaced them.
//
// A user-set override wins over the build-time env var, so a candidate can be
// pointed at a different host without a rebuild.

const API_URL_KEY = "pp_api_url";

const ENV_API_BASE = (import.meta.env.VITE_PP_API_URL as string | undefined) ?? "http://localhost:8000";

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/** The backend base URL: user override > env var > localhost default. */
export function getApiBase(): string {
  try {
    return stripTrailingSlash(localStorage.getItem(API_URL_KEY) || ENV_API_BASE);
  } catch {
    // storage unavailable (private browsing, etc.)
    return stripTrailingSlash(ENV_API_BASE);
  }
}

export function setApiBase(url: string) {
  try {
    localStorage.setItem(API_URL_KEY, url);
  } catch {
    /* non-fatal */
  }
}

// --- the session token ------------------------------------------------------
//
// localStorage rather than a cookie, because the API is a separate origin from
// the app in every environment here and a cookie would need third-party
// cookie handling that browsers are actively removing. The cost is honest: a
// token in localStorage is readable by any script that achieves XSS on this
// origin, which makes the CSP in §14 load-bearing rather than hygienic.
//
// Deliberately NOT the same key family as the exam ticket, which lives in
// sessionStorage precisely so it dies with the tab (see lib/calibration.ts).
// Auth is meant to survive a reload; an exam ticket is not.

const TOKEN_KEY = "pp_auth_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — the session lasts for this page only */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

/** fetch() against the backend, given a root-relative path.
 *
 *  Attaches the bearer token when there is one. Callers never assemble an
 *  Authorization header themselves — one place that knows how a request is
 *  authenticated is one place to change when that stops being a bearer token.
 *
 *  Does NOT throw on 401. Error normalisation is the caller's, because the
 *  right response to an unauthorised read differs by surface: a guard
 *  redirects, a background poll gives up quietly, and a form shows a message. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(`${getApiBase()}${path}`, { ...init, headers });
  } catch {
    // `fetch` rejects with "Failed to fetch" for every network-level failure:
    // the server is down, the port is wrong, or CORS refused the origin. That
    // message names none of them, so it sends people looking for a bug in
    // their own code while the actual cause is a server that was never
    // started or an origin nobody allowed.
    //
    // Rethrown naming the URL that failed, which is the one piece of
    // information that distinguishes the three cases and is the first thing
    // anyone needs.
    throw new ApiUnreachable(getApiBase());
  }
}

/** The backend could not be reached at all — no response, not an error status.
 *
 *  Separate from an HTTP error because the fix is different: an HTTP error is
 *  a problem with the request, and this is a problem with the connection. */
export class ApiUnreachable extends Error {
  readonly baseUrl: string;
  constructor(baseUrl: string) {
    super(
      `Can't reach the ProblemProof server at ${baseUrl}. ` +
        `Check that the backend is running, and that this page's address matches an allowed origin.`
    );
    this.name = "ApiUnreachable";
    this.baseUrl = baseUrl;
  }
}
