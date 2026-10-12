# VAudioFX

A free, local-first game sound effects editor. Record a voice, layer real sounds, change their character, and export WAV, OGG or MP3. No accounts, AI services, or audio uploads.

## Run

Requires Node.js 24 or newer.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`. Microphone access requires localhost or HTTPS.

## Create an undead sound

1. Click **Record**, choose a microphone, and record a gurgle. Stop to save the original take locally and place it on the timeline.
2. Close the recording dialog. Select the clip and apply **Creature voice**. Adjust depth, darkness, dirt, and room ambience.
3. Use **Trim quiet edges** and the noise gate to reduce noise between sounds. Adjust the threshold to retain quieter details. Drag clip edges or use exact source-in/out values; add a second sound onto another layer.
4. Press Space to preview. Click the ruler to seek or use **Loop selected clip** to audition a region. Use the preview-volume slider for listening level.
5. Export WAV. The default is 48 kHz, stereo, 16-bit PCM, with explicit peak normalization. A Phaser preset selects mono and includes a 2.2-second effect tail.

Source waveforms represent original decoded audio, including trims and reversal. Effects are heard in preview; they do not redraw a processed waveform. Depth/speed changes pitch and duration together. Independent pitch shifts up to one octave while retaining clip length; large shifts can soften transients and color voices.

## Included now

- 181 actual Kenney CC0 samples: 130 impacts/footsteps and 51 RPG foley files, verified against the supplied archives. Search, category/tag filters, preview, favorites, recent sounds, and optional local pack caching.
- Audio import and multiple microphone takes, device selection, pause/resume, input peak meter, optional headphone monitoring, and cleanup.
- Multitrack positioning and dragging between layers, source trimming, splits, duplication/repetition, fades, reversal, speed, gain, pan, track reorder/mute/solo, and undo/redo. Snap to nearby clip edges/playhead, fit the timeline, nudge with arrows, or open clip actions with right-click/Shift+F10.
- Ordered high-pass/low-pass filters, three-band EQ, saturation, compressor, deterministic room reverb, and three-tap echo, with independent bypass/reset. Save, load, edit, duplicate, and delete custom effect chains locally.
- Non-destructive quiet-edge trimming, linked stereo noise gating, source-region normalization, and audition loops. Gating reduces noise between sounds; it does not remove noise during speech.
- Source DC-offset removal and narrow 50/60 Hz hum/harmonic cleanup before pitch and speed processing. Editable gain, pan and low-pass automation ramps, preserved through splits. Zoomable source navigation with exact seeking and keyboard controls.
- Twelve working templates: Zombie / Undead Voice, Monster Growl, Fireball, Magic Projectile, Magical Impact, Explosion, Sword Impact, Footsteps, Ghostly Whisper, UI Click, Sci-Fi Laser, and Ambient Wind. Voice textures are synthesized; use your own recording for a personal voice.
- A local source generator for white/pink noise, sine/square/sawtooth tones, sweeps, and noise bursts, with finite duration, soft envelopes, pulsing, and repeatable noise variations. Each generated original is saved as WAV and included in portable backups.
- Creature, Ghost, Heavy impact, and Magical spark presets, plus character size, aggression, brightness, and room macros. Guided Undead Gurgle, Fireball, and UI Feedback recipes connect directly to recording, editing, layering, preview, and export.
- IndexedDB project autosave/recovery and library persistence. Local new/open/save/copy/rename/delete operations. Versioned portable `.vafx` packages with embedded originals and SHA-256 validation.
- Local rendering with 44.1/48 kHz, mono/stereo, tail duration, normalization, clipping checks, and explicit hard peak limiting to −1 dB. Workers encode real 16-bit PCM WAV, Ogg Vorbis quality 5 and 192 kbps MP3 from the preview mix. Lossy encoder/browser padding can alter playback length; use WAV for exact one-shots and seamless loops. Audition loops do not shorten exports.

The app and sound files can be served by a static host with the headers in `security-headers.json`; `netlify.toml` configures a Netlify build. No deployment has been performed by this implementation.

## Your files

Local projects and sources live in **this browser on this device**. Storage may be cleared or evicted. Download a portable `.vafx` backup from **Open project** for important work; it includes every referenced original audio file. Deleting an original used by a saved project is blocked. Deleting a project retains source audio in the library.

Storage is also scoped to the site address and port. Use a portable backup to transfer a project between the development server, extracted preview and a hosted version.

Built-in audio is fetched only on use or pack caching. Cached packs remain in IndexedDB. Production builds cache the app shell, pitch worker and codec binaries after a successful first online visit. Once the service worker activates, reloading offline supports local originals, generation, editing and export. Cache sample packs before disconnecting to use bundled sounds offline. Development mode requires its local server. Browser storage restrictions can prevent offline installation.

## Validation

```sh
npx playwright install chromium firefox
npm run quality:gate
```

The gate verifies bundled hashes/licenses and actual build contents, runs unit tests, typechecks/builds, and runs browser workflows, DSP and automated accessibility tests in Chromium and Firefox. It owns a temporary localhost server on QA port 5183 and stops its own processes after testing. The dev server can stay on 5173; choose another QA port with `VAFX_QA_PORT` if 5183 is occupied. See [testing](docs/testing.md) for coverage and untested hardware/platforms.

After a passing gate, `npm run package:preview` creates a verified local preview ZIP in `artifacts/`, with a standalone localhost server, runtime licenses, corresponding audio dependency source, SHA-256 and source provenance. See [release qualification](docs/release.md) for running it and the manual signoff checklist.

See [architecture](docs/architecture.md), [project format](docs/project-format.md), [asset provenance](docs/assets.md), [audio software licenses/source](public/third-party/index.html), [full runtime notices](public/licenses/runtime-software.txt), and [milestones](docs/milestones.md). Manual hardware/listening/accessibility qualification remains.
