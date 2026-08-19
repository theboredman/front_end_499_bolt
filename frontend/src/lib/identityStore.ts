// Where the enrolment reference lives: this browser, and nowhere else.
//
// Identity Spec §4.5 option (A). The embedding is computed here, held here, and
// compared here; the server learns a score and a consent decision and never the
// vector. That has a consequence the UI has to be honest about rather than hide:
// the reference is DEVICE-LOCAL. A candidate who enrolled on their laptop and
// arrives on a desktop has consented to matching and has no reference on this
// machine — which is a different state from "not enrolled", and pretending
// otherwise is how a system ends up claiming a check it cannot perform.
//
// IndexedDB rather than localStorage: a 512-float embedding is ~2KB of binary,
// and localStorage would mean base64 or JSON-stringified floats — lossy in the
// second case, wasteful in both. IndexedDB stores the Float32Array directly.

const DB_NAME = "pp-identity";
const DB_VERSION = 1;
const STORE = "reference";

/** What is kept locally. Note what is NOT here: no frame, no crop, no landmark
 *  set, nothing from which a face could be reconstructed for display. */
export type StoredReference = {
  /** Which account this reference belongs to. A shared machine must not let
   *  one person's reference be compared against another person's session. */
  userId: string;
  /** The centroid of the enrolment frames, unit length. */
  embedding: Float32Array;
  /** Mean agreement between the enrolment frames. Recorded so a weak reference
   *  can be recognised later rather than silently producing poor scores. */
  coherence: number;
  /** Which version of the enrolment request was answered. */
  consentVersion: string;
  createdAt: number;
  /** Model the embedding came from. An embedding is only comparable against
   *  another from the SAME model — swap the weights and every stored reference
   *  becomes meaningless while remaining perfectly well-formed. */
  modelUrl: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "userId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

export async function saveReference(ref: StoredReference): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(ref);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadReference(userId: string): Promise<StoredReference | null> {
  try {
    const db = await open();
    const ref = await new Promise<StoredReference | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const get = tx.objectStore(STORE).get(userId);
      get.onsuccess = () => resolve((get.result as StoredReference) ?? null);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return ref;
  } catch {
    // Private browsing, storage disabled, or a corrupt database. Treated as
    // "no reference on this device", which is true and which the caller
    // already has to handle.
    return null;
  }
}

export async function clearReference(userId: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* nothing stored, or storage unavailable */
  }
}

/** What the account page actually needs to say.
 *
 *  The server knows whether consent was given; only this browser knows whether
 *  a reference exists. Four combinations, and three of them are states the old
 *  panel rendered identically as "Enrolled".
 */
export type EnrolmentReality =
  /** Consented and usable here. */
  | { state: "ready"; coherence: number }
  /** Consented, but the reference is on another device or was cleared. Matching
   *  cannot run on this machine until they enrol again. */
  | { state: "reference_missing" }
  /** Consented, and the reference here came from a different model, so it
   *  cannot be compared. Same remedy, different cause. */
  | { state: "model_changed" }
  | { state: "declined" }
  | { state: "not_enrolled" };

export function reconcile(
  serverDecision: "none" | "enrolled" | "declined",
  local: StoredReference | null,
  currentModelUrl: string
): EnrolmentReality {
  if (serverDecision === "declined") return { state: "declined" };
  if (serverDecision !== "enrolled") return { state: "not_enrolled" };
  if (!local) return { state: "reference_missing" };
  if (local.modelUrl !== currentModelUrl) return { state: "model_changed" };
  return { state: "ready", coherence: local.coherence };
}
