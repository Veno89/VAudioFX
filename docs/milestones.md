# Implementation milestones

## Milestone 1 — functional vertical slice

Implemented: strict React/TypeScript/Vite app; real licensed library; audio import; microphone capture/pause/device selection/level display/cleanup; persistent original takes; source waveforms; basic multitrack editing; positioning/trimming/gain/fades/filter; playback; actual WAV rendering/encoding; local saving/recovery; automated domain/storage/recording/audio/browser checks.

Additional coherent foundations implemented: undo/redo; track mute/solo/pan/reorder; clip split/duplicate/reverse/rate/pan; fixed DSP chain with reverb/distortion/echo; cached optional packs; three procedural templates; Creature voice preset; safe portable packages; explicit export settings and clipping handling; responsive dark UI.

## Milestone 2 — editing and processing

Implemented:

- Independent effect bypass/order/reset and locally persistent custom chain save/load/update/duplicate/delete.
- Three-band EQ, native compressor, optional explicit master hard peak limiter, linked stereo noise gate, quiet-edge trimming, and source-region normalization.
- Native audition-loop playback on the audio clock; exports retain the full timeline. Atomic repetitions, nearby boundary/playhead snapping, fit-to-view, 10/50 ms keyboard nudges, and dragging between layers.
- Keyboard clip actions, right-click/Shift+F10 dialog, accessible toggle states, strict version 2 contracts, and tested version 1 project/package migration.
- Expanded deterministic unit, Web Audio, and Chromium/Firefox workflows. Real assistive-technology and installed-browser qualification remain in product hardening.

## Milestone 3 — creative features

Implemented: all twelve requested templates with complete synthesized layers; seven local source generators; finite envelopes, amplitude pulsing, and seeded noise variations; Creature/Ghost/Impact/Magic characters; size/aggression/brightness/room macros; interactive Undead Gurgle, Fireball, and UI Feedback recipes; locally persistent generated original WAVs and portable recovery. Existing custom effect-chain save/edit/duplicate/reset workflows remain available. Voice textures are labeled as synthesized, and recipes use actual imported/recorded originals.

## Milestone 4 — advanced functionality

Implemented: bounded gain/pan/low-pass automation with curve editing and split preservation; independent one-octave WSOLA/Lanczos pitch processing; source DC-offset and 50/60 Hz hum/harmonic cleanup; genuine browser-local WAV/OGG/MP3 encoders; zoomable source navigation and exact seeking; worker preparation/mastering/encoding with abort/deadline cleanup; cancellation of pending preview/export work; source/prepared/mix allocation reporting and a measured 60-second stereo render; storage capacity estimates; production offline shell with bundled DSP/codec assets. Version 3 projects/packages explicitly migrate versions 1 and 2 without adding audible changes. Dependency licenses, pinned corresponding source, and integrity checks are distributed.

Native offline rendering has no close API: cancellation stops/disconnects its graph and retains the single-render lock until the bounded native job finishes. Compressed decoder padding and pitch artifacts are disclosed. Whole-process peak-memory, human listening and broader hardware qualification remain in Milestone 5; allocation counts are not a claim about total browser memory. Broader licensed sample packs and speech denoising remain optional extensions.

## Milestone 5 — product hardening

Implemented: worker-based portable packaging/import with cancellation and deadlines; full stored-ZIP directory/CRC/SHA and bounded provenance validation; pre-decode WAV/Vorbis/Opus declarations; atomic canceled imports and IndexedDB reconnection; recovery from simulated storage loss with unchanged originals; automated accessibility scans and keyboard focus fixes; a 120-second, 16-track, 128-clip render/backup stress workload; sampled browser-process memory with empty-editor baselines; complete runtime notices; consistent production security headers; offline MP3/OGG/package checks; build-content verification and a local preview ZIP with source and artifact hashes. See [validation](validation.md) and [release qualification](release.md) for evidence.

Manual release signoff remains: real microphone/monitoring hardware, installed Edge, human listening, assistive technology, real browser storage eviction and lower-memory devices. Native codec robustness beyond the bounded import checks is not fully qualified. All five milestones now have their implementation; Milestone 5 remains open for these manual checks. No release has been published.
