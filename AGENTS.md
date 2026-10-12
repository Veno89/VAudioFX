# VAudioFX development

Follow the owner's global instructions. Keep this application independent from VVFX and game runtimes.

- Read `docs/architecture.md` and the nearby implementation before audio, persistence, or import changes.
- ProjectStore is the editing authority. Keep project commands independent from audio timing; use the Web Audio clock for playback.
- Preserve original audio. Clips store instructions, never destructive source edits.
- Preview and WAV export share the rendered audio buffer and `audio/graph.ts`. A preview-only effect must not ship.
- Never upload imported files or microphone audio. No external fonts, telemetry, accounts, or cloud processing.
- Bundle only verified redistributable assets, keeping the original license, source URL, and checksums in the manifest.
- Every enabled control must work. Do not use fake waveforms or progress, advertise missing codecs, or label playback-rate pitch as independent pitch shifting.
- Run `npm run quality:gate` after material code changes. The E2E runner tracks its server and browser-runner PIDs and cleans up exact owned processes.
- Do not commit, push, or deploy without explicit owner authorization.
