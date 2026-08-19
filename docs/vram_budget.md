# VRAM Budget — Extractor A

**Date measured:** 2026-07-25
**Rule applied:** ≤ 4 GB peak VRAM → integrate into the backend service. > 4 GB → notebook path.

## Results

| Component | Peak VRAM | Host RSS (Δ) | Throughput | Method | Branch |
|---|---|---|---|---|---|
| MediaPipe Face Landmarker (float16 `.task`) | **0 MB** | 93.0 MB | 97.2 fps (3.24× realtime) | measured — see below | **light — in-backend** |
| V-JEPA 2.1 teacher (Extractor B) | not measured | — | — | **not present in this repo** | n/a |
| Distilled student (Extractor B) | not measured | — | — | **not present in this repo** | n/a |

## Method — how these numbers were obtained

**Not** from a model card. Measured on this machine, on a realistic workload.

`torch.cuda.max_memory_allocated()` was **attempted and is unavailable here**: the
installed torch is `2.12.0+cpu`, a CPU-only build, so `torch.cuda.is_available()`
returns `False` and there is no CUDA allocator to interrogate. The script records
this explicitly rather than silently skipping it. This is not a limitation that
affects the result, because MediaPipe does not allocate through torch in any case.

GPU memory was therefore measured directly, three ways:

1. **`nvidia-smi --query-gpu=memory.used`** polled at ~7 Hz in a background thread
   for the whole run; peak taken over the idle baseline.
2. **`nvidia-smi --query-compute-apps`** polled on the same schedule, to catch a
   process holding a CUDA context even briefly.
3. **MediaPipe's own delegate log**, which reports which backend it selected.

Host working-set was read via the Windows `GetProcessMemoryInfo` API
(`WorkingSetSize` / `PeakWorkingSetSize`), since CPU RAM is the resource that
actually binds for this component.

### Workload

Realistic, not synthetic: **640×480 @ 30 fps** (exactly the capture settings in
research plan §2.2), 300 frames / 10 s, built from the 50 real webcam frames in
`daisee_report/frames/` — genuine faces under consumer webcam conditions. This
matters: with no face in frame MediaPipe skips the landmark subgraph entirely and
any memory figure would be an understatement. **286 of 300 frames (95.3%) produced
a face detection**, so the full graph was exercised.

Run in `VIDEO` running mode with `num_faces=1` and
`output_facial_transformation_matrixes=True` — the exact configuration the
extractor uses.

### Raw output

```json
{
  "frames_processed": 300,
  "faces_detected": 286,
  "wall_seconds": 3.08,
  "fps": 97.2,
  "realtime_factor": 3.24,
  "gpu_baseline_mb": 0.0,
  "gpu_peak_mb": 0.0,
  "gpu_delta_mb": 0.0,
  "gpu_total_mb": 4096,
  "gpu_compute_processes_seen": "none — no process held a GPU context",
  "host_rss_baseline_mb": 236.4,
  "host_rss_peak_mb": 329.5,
  "host_rss_delta_mb": 93.0,
  "torch_cuda_method": "unavailable — torch 2.12.0+cpu has no CUDA support"
}
```

MediaPipe logged `Created TensorFlow Lite XNNPACK delegate for CPU.` — XNNPACK is
a CPU-only inference backend. The GPU never registered a compute process at any
sample. The 0 MB is a real reading, not a failed probe: the same `nvidia-smi`
query reports the correct 4096 MB total, and an earlier deliberately-broken RSS
probe that returned 0.0 was found and fixed rather than reported.

### Hardware context

- GPU present: **NVIDIA GeForce GTX 1650 (mobile), 4096 MiB total** — idle at 0 MiB.
- The GPU is irrelevant to this component. The Python API for MediaPipe Face
  Landmarker has no CUDA path; GPU delegation exists only in the C++/Android/web
  builds. Even if a GPU delegate were wired up, the float16 model file is 3.58 MB
  and could not approach the 4 GB line.

## Decision

**Extractor A runs in-process in the backend service. The light path.**

Peak VRAM is **0 MB**, which is ≤ 4 GB by an enormous margin. There is no
notebook, no tunnel, and no separate compute host for this component.
**Phase 3 does not trigger.**

Extractor B (V-JEPA 2.1 teacher + distilled student) **does not exist in this
repository** — there is no V-JEPA code, no student model, and no `latent_*`
producer of any kind. Per the current scope (Galib's §2.2 module only), it is out
of scope and was not measured. If and when it lands it must be measured
separately; a ViT-G teacher will not fit on this 4 GB card and would take the
notebook path, which is exactly the split the phase plan anticipates.

### What this means downstream

- `signals.parquet` is written by the backend with the eight §2.2 feature columns
  populated and **`latent_0..latent_63` present but all-NaN**, since nothing
  produces them yet. The column set stays schema-stable so Extractor B can join
  on `t_ms` later without a format change.
- The frontend's compute-endpoint setting defaults to the normal backend and the
  tunnel field stays hidden, per Phase 4's conditional.
- The real cost of this component is **CPU and wall-clock**, not VRAM. At 3.24×
  realtime, a 40-minute session video extracts in roughly 12 minutes. That is far
  too long to hold an HTTP request open, which is why extraction is a background
  job with polled progress rather than a synchronous endpoint.
