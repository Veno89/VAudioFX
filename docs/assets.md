# Sound provenance

The per-file license/metadata manifest is [`src/features/sample-manifest.json`](../src/features/sample-manifest.json). It records IDs, names, categories, tags, original filenames, author, source, license reference, format, duration, size, verification date, and SHA-256.

| Collection           | Files actually retrieved | Source and verification                                                                                                         |
| -------------------- | -----------------------: | ------------------------------------------------------------------------------------------------------------------------------- |
| Kenney Impact Sounds |                      130 | [Publisher CC0 page](https://kenney.nl/assets/impact-sounds), [original included license](../public/licenses/kenney-impact.txt) |
| Kenney RPG Audio     |                       51 | [Publisher CC0 page](https://kenney.nl/assets/rpg-audio), [original included license](../public/licenses/kenney-rpg.txt)        |

Verified 2026-10-11. The RPG publisher page advertises 50; the downloaded official archive actually contains 51 files under `Audio/`. Its separate `Preview.ogg` is not included. No previews, branding images, URL shortcuts, or unknown-license files are distributed as samples.

`scripts/prepare-samples.py` builds the manifest from the official archives, preserves the included licenses, computes Vorbis duration from identification headers/final OGG granule positions, and copies only basename audio paths. `scripts/check-assets.mjs` validates the distributed files and their licenses. Browser tests decode **all 181** and check actual audio durations. Optional pack caching verifies hash and size before storing each source.

Twelve procedural templates and the source generator create noise, tones, sweeps, and bursts locally and encode them to original WAVs. Seeded white/pink noise is repeatable; native oscillator rendering can vary slightly by browser. VAudioFX dedicates its generated source signals to [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Each original carries its source settings and local-generation provenance. Creature and whisper textures are described as synthesized effects, not human speech or authentic field recordings. Imported and recorded audio retains the user's source rights. The generator adds no downloaded third-party audio or DSP dependency.

Other requested collections (UI, Interface, Digital, Sci-Fi, Creature, Ambient recordings) are not bundled in this milestone. No assets with unverified rights are used.
