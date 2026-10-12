# Local preview and release qualification

VAudioFX 0.1.0 is a local preview. Five implementation milestones are present; manual Milestone 5 signoff remains. Git publication is separate from release qualification and deployment. Each preview records its exact source state in `provenance.json`; the 2026-10-11 preview was built before the initial Git commit and records uncommitted source hashes.

Run `npm.cmd run quality:gate` after the last code change. The gate checks source assets and complete runtime notices, unit tests, strict types/build, actual distributed samples/source/codec/license/worker files, hosting headers, development browser workflows and production offline behavior, then records input/build hashes. Run `npm.cmd run package:preview` after it passes. Packaging refuses changed implementation inputs/build files, verifies every ZIP entry against its input bytes, writes a SHA-256 companion and records individual source/build hashes and the source fingerprint in `provenance.json`. Documentation can be finalized after the gate and is included in source provenance. A package is not a published release.

Qualify the extracted ZIP's own server and app with `node scripts/run-e2e.mjs --production --release-preview tests/e2e/offline.spec.ts`. This bounded workflow extracts into a unique owned QA folder, runs the same offline/security-header/codec/backup checks, stops its exact processes and removes only that temporary extraction.

Extract the entire preview ZIP, open a terminal in its folder, and run `node preview.mjs` with Node.js 24 or newer. Open `http://127.0.0.1:5184`. The server logs its PID and stops with Ctrl+C; override its port with `VAFX_PREVIEW_PORT` if occupied. It binds only localhost, serves the production security headers and needs no npm installation. Direct `file:` opening does not support the microphone/worker workflow. For static hosting, publish the `app/` contents over HTTPS and apply `security-headers.json`; the source repository's Netlify configuration uses the same headers. Initial online loading is required for the offline shell; sample packs need explicit caching.

## Manual signoff still required

The extracted preview uses port 5184, which has separate browser storage from the development server on 5173. Transfer existing work with a portable `.vafx` backup.

Record browser/OS/device versions, the package SHA-256 and observed outcomes for each item. These are pending checks, not permission requirements for local implementation.

- Real microphones: permission approval/denial, device selection, repeated and paused takes, physical disconnect, tab hiding, headphone monitoring/feedback and latency, downloadable recovery after a failed save.
- Installed Chrome/Firefox/Edge: actual device capture, playback/export, worker/WASM support, offline refresh and storage behavior. Automated Chromium/Firefox do not certify installed applications; Edge was unavailable in this environment.
- Human listening: imported/recorded voices, transients, reversal, speed versus independent pitch, cleanup, effect order, automation and WAV/OGG/MP3 exports. Check pitch coloration, clipping/limiter artifacts, lossy padding and seamless-loop timing.
- Assistive technology: screen reader announcements, complete keyboard-only creation/export, focus order/return, 200% zoom and high contrast. Automated axe scans and keyboard checks cover selected states and do not establish full conformance.
- Real browser storage eviction/private mode and low-memory hardware: recover an important project from a downloaded `.vafx` backup and verify the original bytes. The automated deletion test uses disposable storage and simulates loss, not operating-system/browser-driven eviction.
- Broader malformed native audio codecs and sustained workloads. WAV/Vorbis/Opus declarations have pre-decode bounds; MP3/M4A/AAC/FLAC/WebM and other OGG codecs still use native decoding before decoded bounds. Container declarations cannot guarantee decoder robustness.

## Measured workload and limits

The automated synthetic workload renders 120 seconds at 48 kHz stereo, with 16 tracks and 128 clips sharing one original and one 15-second independently pitched prepared region. It exports/imports a 23,139,547-byte backup, verifies the original hash and cancellation, and measures main-thread timer gaps. It exercises the renderer/package pipeline; it does not populate 128 clips in the visible editor or certify every effect/source combination. Full-length unique regions and effect-heavy compositions can use more memory or hit the explicit 150 MiB source/prepared budgets.

On 2026-10-11, the profiled run rendered in 7,039 ms (Chromium) and 2,600 ms (Firefox), with maximum timer gaps of 95/113 ms. Composition buffers totaled 97,920,000 bytes (93.38 MiB). The Windows sampler followed only the owned runner's browser descendants, taking 43 snapshots over 21.5 seconds with a requested 250 ms interval plus enumeration overhead.

| Engine                   | Empty-editor private committed memory | Sampled peak private committed memory | Empty-editor working-set sum | Sampled peak working-set sum |
| ------------------------ | ------------------------------------: | ------------------------------------: | ---------------------------: | ---------------------------: |
| Chromium, four processes |                            279.80 MiB |                            509.26 MiB |                   437.35 MiB |                   657.97 MiB |
| Firefox, seven processes |                            708.41 MiB |                          1,008.52 MiB |                   772.43 MiB |                 1,057.63 MiB |

Private bytes measure committed private memory rather than physical RAM. Working-set sums can count shared pages more than once; sampling can miss short peaks. Empty-editor baselines include headless browser and development instrumentation. These are local measurements, not minimum device requirements or general production-memory guarantees. Reproduce on Windows with `node scripts/run-e2e.mjs --profile-memory tests/e2e/hardening.spec.ts -g "maximum project"`; the bounded sampler and runner stop their exact owned process trees. Raw evidence is in ignored `.qa/peak-memory-41648.json`.
