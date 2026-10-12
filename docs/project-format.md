# Portable VAudioFX format, version 3

Extension: `.vafx`. MIME: `application/x-vaudiofx`. Container: ordinary ZIP, using **stored/uncompressed entries**. Audio is already compressed or PCM; stored entries permit bounded import without a decompression-bomb attack. Imports reject compression, encryption, data descriptors, duplicate paths, unexpected entries, path traversal, and excess sizes. Recompressing a package externally is not supported.

The importer validates local headers against every central-directory entry and the end record, checks CRC-32 and source SHA-256, rejects truncated/trailing data, and bounds the manifest to 1 MiB before parsing fatal UTF-8. ZIP64, split archives and unsupported flags are rejected. Package work runs in a cancelable worker with a two-minute deadline. Original author/license/pack/source URL, tags and generation verification metadata survive repeated backups with explicit length limits. Imported URLs remain inert metadata and are never fetched.

Contents:

```text
manifest.json
audio/0.bin
audio/1.bin
...
```

The JSON envelope has `format: "VAudioFX"`, `version: 3`, `project`, and `assets`. Project retains metadata, grid/zoom settings (5–400 px/s), ordered tracks/clips and source IDs, trims, position, gain, pan, playback rate, independent pitch, automation, reversal, fades, effects, cleanup, audition loop, and export settings. Each source contains original filename, metadata, path, byte size, and SHA-256. Binary entries retain the original encoded audio, not rendered or processed copies.

Each `effects` object stores an `order` permutation of `highpass`, `lowpass`, `eq`, `distortion`, `compressor`, `reverb`, and `echo`; `bypassed` is a unique subset of these IDs. Overall `enabled` remains independent. EQ gains are −12…12 dB; compressor values retain explicit threshold/ratio/knee/attackMs/releaseMs. `cleanup` stores gateEnabled, thresholdDb (−80…−6), attackMs (0.1…100), releaseMs (1…1000), and normalize. Project `loop` stores enabled/start/end with a minimum 50 ms region inside 0…130 s. Playback also checks that the region fits the actual rendered buffer. Export `limiter` is an explicit boolean.

Validation reconstructs typed project objects and ignores unknown fields. It requires finite, bounded numbers, valid IDs/colors/flags, unique track/clip/source IDs, correct source relationships, positive trims within declared source duration, supported MIME types, and matching SHA-256/byte lengths. Encoded audio is capped at 150 MiB total and 30 MiB per source; the manifest has a separate 1 MiB cap. The whole archive, including ZIP directory overhead, must fit within 151 MiB. Export and import use the same budgets, and export rejects excessive metadata rather than producing an unrecoverable backup. Every referenced source is decoded before the imported project is accepted in the app; declared durations must match decoded audio. Imported contents are never executed or turned into URLs.

On import, source IDs and project ID are replaced with fresh local IDs. An imported project cannot overwrite an existing source with a matching ID. Import saves originals and project in one IndexedDB transaction. Original license information remains in exported metadata; the current imported-library UI simplifies categories/tags and does not claim a new license for third-party imported audio.

Version 1 migration retains the original effect order and parameters, adds neutral EQ and bypassed compression, and disables cleanup/loop/limiter. Versions 1 and 2 migrate to version 3 with zero independent pitch, empty automation, DC/hum cleanup disabled, and WAV export. Source references and original bytes are preserved. New saves/exports use version 3. Unknown future versions fail rather than dropping settings. The local IndexedDB schema remains independently numbered at 1. Custom preset collections are browser settings and are not embedded in a project package; applied clip effect settings are embedded.

Version 3 stores `pitchSemitones` (−12…12), `automation` with gain/pan/lowpass lanes, cleanup `dcRemove` and `humHz` (0/50/60), and export `format` (wav/ogg/mp3). Each lane has at most 32 finite, strictly increasing `{time,value}` points. Time is a fraction of the played region (0…1). Gain is a 0…2 multiplier on static gain/fades, pan is −1…1, and low-pass is 20…20000 Hz. Edges hold the nearest point; ramps are linear. Trimming/rate changes rescale the curve. Reversal changes source audio, while automation continues in playback order. Splitting interpolates new boundaries without exceeding the point cap. Effect bypass also bypasses low-pass automation. Format changes do not change the preview mix.

Generated sources remain ordinary original WAV blobs with local-generation provenance. Templates and macros become ordinary clip/track/effect instructions; backups need no generator runtime or network samples to reopen them. Guided-recipe progress is session UI state and is not embedded; applied edits and originals are embedded normally.
