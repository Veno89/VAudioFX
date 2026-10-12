import { expect, it, vi } from 'vitest';
import { assetRepository } from '../src/audio/assets';
import { renderProject } from '../src/audio/render';
import { makeClip, newProject, type Asset } from '../src/domain/model';

it('bounds concurrent renders and releases its lock after a failed decode', async () => {
  const asset: Asset = {
    id: 'render-source',
    name: 'Source',
    kind: 'import',
    category: 'Imported',
    tags: [],
    duration: 1,
    size: 1,
    mime: 'audio/wav',
    originalFilename: 'voice.wav',
  };
  const project = newProject();
  project.tracks[0].clips = [makeClip(asset)];
  let reject!: (error: Error) => void;
  const decode = vi.spyOn(assetRepository, 'decode').mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  try {
    const active = renderProject(project, [asset]);
    await expect(renderProject(project, [asset])).rejects.toThrow('still finishing');
    reject(new Error('Decode failed'));
    await expect(active).rejects.toThrow('Decode failed');
    await expect(renderProject(newProject(), [])).rejects.toThrow('Add a sound');
  } finally {
    decode.mockRestore();
  }
});

it('cancels after a held decode without starting native rendering and releases the lock', async () => {
  const asset = { id: 'held', name: 'Held', duration: 1 } as Asset;
  const p = newProject();
  p.tracks[0].clips = [makeClip(asset)];
  let release!: (buffer: AudioBuffer) => void;
  const decode = vi.spyOn(assetRepository, 'decode').mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const controller = new AbortController();
  try {
    const job = renderProject(p, [asset], controller.signal);
    controller.abort();
    release({} as AudioBuffer);
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await expect(renderProject(newProject(), [])).rejects.toThrow('Add a sound');
  } finally {
    decode.mockRestore();
  }
});
