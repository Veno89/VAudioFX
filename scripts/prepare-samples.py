"""Import verified Kenney archives; never extract archive paths verbatim."""
import hashlib
import json
import re
import struct
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manifest = []
for pack, source in [('impact', 'impact-sounds'), ('rpg', 'rpg-audio')]:
    archive = zipfile.ZipFile(root / '.asset-downloads' / f'{pack}.zip')
    license_text = archive.read('License.txt').decode('utf-8-sig')
    assert 'CC0' in license_text
    (root / 'public/licenses' / f'kenney-{pack}.txt').write_text(license_text, encoding='utf-8')
    folder = root / 'public/samples' / pack
    folder.mkdir(parents=True, exist_ok=True)
    for name in sorted(archive.namelist()):
        if not name.startswith('Audio/') or not name.endswith('.ogg'):
            continue
        data = archive.read(name)
        filename = Path(name).name
        rate = struct.unpack_from('<I', data, data.index(b'\x01vorbis') + 12)[0]
        page = 0
        granule = 0
        while page < len(data):
            assert data[page:page + 4] == b'OggS'
            position = struct.unpack_from('<Q', data, page + 6)[0]
            if position != 0xffffffffffffffff:
                granule = max(granule, position)
            segments = data[page + 26]
            page += 27 + segments + sum(data[page + 27:page + 27 + segments])
        base = filename[:-4]
        words = re.sub(r'([a-z])([A-Z])', r'\1 \2', base).replace('_', ' ')
        category = 'Movement' if 'footstep' in base.lower() else 'Impacts'
        if pack == 'rpg':
            category = 'Combat' if any(w in base.lower() for w in ['knife', 'sword', 'chop', 'metal']) else 'Foley'
        (folder / filename).write_bytes(data)
        manifest.append(dict(id=f'kenney-{pack}-{base}', name=words.capitalize(), kind='builtin', category=category,
                             tags=list(dict.fromkeys([pack] + re.sub(r'\d+', '', words.lower()).split())),
                             duration=round(granule / rate, 6), size=len(data), mime='audio/ogg', originalFilename=filename,
                             url=f'/samples/{pack}/{filename}', pack=pack, author='Kenney', license='CC0-1.0',
                             sourceUrl=f'https://kenney.nl/assets/{source}', verification=f'/licenses/kenney-{pack}.txt',
                             verifiedOn='2026-10-11', checksum=hashlib.sha256(data).hexdigest()))
(root / 'src/features/sample-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'Prepared {len(manifest)} verified audio files ({sum(a["size"] for a in manifest):,} bytes).')
