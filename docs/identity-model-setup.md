# Identity matching — model setup and the road to enforcement

**Status:** the matcher is real and runs. It is in **shadow mode**: it computes
scores and records them, and is not permitted to refuse or flag anybody.

---

## 1. What is built

| Piece | Where | State |
|---|---|---|
| Face detection + crop | `frontend/src/lib/faceMatcher.ts` (MediaPipe `FaceDetector`) | Real, weights fetched from Google's pinned CDN |
| Recognition embedding | `faceMatcher.ts` (ONNX Runtime Web) | Real. ArcFace ResNet100 installed; see §2 |
| Crop / normalise / cosine / enrolment centroid | `frontend/src/lib/faceMath.ts` | Real, 25 unit tests |
| Decision logic | `frontend/src/lib/identity.ts` | Real, enforcement-aware |
| Calibration gate | `backend/problemproof/api/calibration.py` | Real |
| Enrolment consent record | `backend/problemproof/accounts.py` | Real |

---

## 2. Supplying the recognition model

The detector's weights ship. The **recognition** weights do not, and that is
deliberate.

A face-recognition model's demographic error profile is a property of its
weights, and it is precisely the property this deployment has not measured.
NIST FRVT publishes error rates for specific, named algorithms; an unattributed
ONNX file pulled off the internet has no published characteristics at all. If
this repository bundled one, "we have not measured this" would become "we
cannot, even in principle, look it up" — and the model choice is exactly the
decision that should be made by someone who can name it in a validation report.

**Requirements**

- ONNX, opset 11+
- Input: `float32`, 112x112, three channels
- Output: a single embedding vector, `float32[1, N]`
- `N` must equal `embeddingDim` in `identityConfig.ts` (the loader throws on
  mismatch rather than producing uniformly poor scores)

**Four things must match the weights, and only one of them errors when wrong.**

| Setting | Where | Wrong value produces |
|---|---|---|
| `embeddingDim` | `identityConfig.ts` | a loud throw at first inference |
| `modelLayout` | `identityConfig.ts` | silence — a well-formed embedding of nothing |
| `modelNormalisation` | `identityConfig.ts` | silence — degraded discrimination |
| channel order (RGB) | `faceMatcher.ts` | silence — degraded discrimination |

Only the first announces itself. The other three return plausible numbers, and
a poorly discriminating model is indistinguishable from thresholds that need
tuning — which is why the layout is read off the graph and the other two are
measured rather than guessed (see below).

**Reading the layout off the graph**

```python
import onnx
m = onnx.load("model.onnx", load_external_data=False)
for t in list(m.graph.input) + list(m.graph.output):
    print(t.name, [d.dim_value or d.dim_param for d in t.type.tensor_type.shape.dim])
```

`[N, 3, 112, 112]` is `nchw`; `[N, 112, 112, 3]` is `nhwc`. PyTorch/insightface
exports are usually the first, TensorFlow/Keras exports the second.

**Choosing normalisation and channel order empirically**

Run several distinct inputs through the model under each combination and take
the one with the *lowest* mean pairwise cosine similarity — that is the setting
under which the model discriminates most. For the ArcFace currently installed:

```
sym  RGB  0.9013   <- chosen
sym  BGR  0.9169
unit RGB  0.9546
unit BGR  0.9618
```

**Install**

```
frontend/public/models/<your-model>.onnx
```

and point `modelUrl` at it. The directory is **gitignored**: these files are
large, and git keeps a blob forever once it lands, so a 136MB model committed
once cannot be removed without rewriting history. Serve it from your own
origin — a model fetched from a third party is a third party deciding what your
identity check does.

> **Currently installed: ArcFace ResNet100, 136MB, NHWC, 512-d.** It works and
> is measured at ~43ms per inference on CPU.
>
> It is also far too large for browser delivery. Every candidate who enrols
> downloads 136MB before their first frame is captured, which on a phone or a
> poor connection is prohibitive, and it is 136MB of `public/` in every
> deployment artifact. ArcFace ResNet100 is a server-side model.
> **MobileFaceNet is the browser-appropriate member of the same family at
> roughly 4MB**, and swapping it in is a one-line `modelUrl` change plus
> re-reading its layout and re-running the discrimination comparison above.

Without the file the matcher throws `FaceMatcherLoadError` on load and matching
does not run. It does not silently degrade to "no face detected", because that
would make every session look like the candidate was absent — a finding about a
person produced by a missing file.

**A dev-server trap worth knowing about.** Vite answers an unknown path with
`index.html` rather than a 404, so a model that simply is not installed arrives
as a `200` with an HTML body. Handed straight to the runtime that produces:

```
expected magic word 00 61 73 6d, found 3c 21 64 6f
```

`3c 21 64 6f` is `<!do` — the start of `<!doctype html>`. The message is
accurate and useless. `createFaceMatcher` therefore fetches the first byte of
`modelUrl` before touching the runtime and fails with a sentence naming the
path and the fix instead.

The same trap catches ONNX Runtime's own WASM binaries: their location is set
explicitly via `ort.env.wasm.wasmPaths` from Vite `?url` imports, so the
bundler emits them as real assets. Left unset, the runtime looks for them at a
default path that does not exist here, gets `index.html`, and reports
`no available backend found` — which sounds like a browser capability problem
and is a build configuration one.

Threading is disabled (`numThreads = 1`). Threaded WASM needs SharedArrayBuffer,
which needs COOP/COEP headers this app does not send; left on, the runtime
either fails to start or silently falls back, and a silent fallback inside an
identity check is worse than a slower one.

---

## 3. Enforcement levels

Set with `PP_IDENTITY_MATCHING` (server) and `enforcement` in
`identityConfig.ts` (client). **Default: `shadow`.**

| Level | Matcher runs | Calibration can refuse | Mid-exam can flag | Assurance |
|---|---|---|---|---|
| `off` | no | no | no | L1 |
| `shadow` | **yes** | **no** | **no** | L1 |
| `enforced` | yes | yes | yes | L2 on a pass |

### Why shadow exists

Per-cohort thresholds cannot be fitted without real scores from real sessions,
and real scores cannot be collected without running the matcher. "Wait until it
is validated" is therefore circular — it forbids the only activity that could
end the wait.

Shadow breaks the circle. Every score is computed and recorded exactly as it
would be in production, and the system is structurally incapable of acting on
any of it: `judgeCalibration` returns `observed` rather than `pass`/`refuse`,
`judgeExamSample` emits its event with `enforced: false` and raises no flag, and
the server checks its own enforcement level rather than trusting the outcome the
client reported. A client that sent `outcome: "refuse"` still cannot lock anyone
out.

Shadow results **do not raise the assurance level**. A credential claiming L2 on
the strength of a check nobody was allowed to act on is exactly the misleading
disclosure Identity Spec §4.2 warns about.

### `enforced` is refused while unvalidated

`assertUsable()` rejects the combination, on both sides. This is the control:
the only way to make "must be validated first" true is to make the alternative
unrepresentable rather than merely discouraged.

---

## 4. Getting to `enforced`

Three blockers. None is an engineering task.

**1. Per-cohort validation.** Collect shadow scores across a demographically
diverse participant set who have consented to share cohort data for this
purpose. Compute false-match and false-non-match rates per cohort at candidate
thresholds; report the disparity ratio. Set `thresholds` per cohort, write what
was measured into `validationNote`, and set `validated: true`.

> The shipped thresholds (0.62 / 0.45) were placeholders chosen before any
> model existed, and the installed ArcFace almost certainly does not sit on
> that scale. Its similarities cluster high — 0.90 mean pairwise on synthetic
> non-face inputs — so a genuine different-person pair may well score above
> 0.45 and be admitted. Do not read the current numbers as approximately right
> and in need of tuning; read them as unset. Shadow mode is what will show
> where the real distribution lies.

`CohortId` is never collected from candidates or inferred from their faces. It
exists so a validation study can fit and report per-cohort numbers without the
config shape changing.

**2. Liveness detection.** None exists. Enrolment is currently "live camera",
not "verified live", and a presentation attack at enrolment would poison the
reference embedding for every later session. This matters more than it sounds:
enrolment is the one moment the system takes a claim about identity on trust.

**3. Article 9 review.** Adding identity matching as a processing purpose may
make the already-stored session webcam video Article 9 biometric data,
regardless of the embedding being computed client-side. Needs counsel.

---

## 5. What never leaves the browser

The embedding. It is computed in `faceMatcher.ts`, held client-side, and
compared client-side. Events carry a score, a threshold, a version and a face
count — `assertNoBiometricContent` rejects anything vector-shaped or named for a
biometric artefact, and `IdentityMatchResult` on the server declares no field
one could arrive in.

The user record stores a **consent decision** — enrolled/declined/none, its
version, its timestamp. That is an ordinary consent artefact, not an identifier.
