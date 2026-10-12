import { expect, it, vi } from 'vitest';
import { AssetRepository } from '../src/audio/assets';
import type { Asset } from '../src/domain/model';

it('retains ownership of a new decode context while the previous context finishes closing', async () => {
  let finishClose!: () => void;
  const contexts: FakeContext[] = [];
  class FakeContext {
    state = 'running';
    closeCount = 0;
    constructor() {
      contexts.push(this);
    }
    async decodeAudioData() {
      return { length: 1000, duration: 1, numberOfChannels: 1 };
    }
    close() {
      this.closeCount++;
      this.state = 'closed';
      return contexts[0] === this
        ? new Promise<void>((resolve) => {
            finishClose = resolve;
          })
        : Promise.resolve();
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  try {
    const repo = new AssetRepository(),
      asset = { id: 'first', name: 'Sound', blob: new Blob(['audio']) } as Asset;
    await repo.decode(asset);
    const closing = repo.dispose();
    await repo.decode({ ...asset, id: 'second' });
    expect(contexts).toHaveLength(2);
    finishClose();
    await closing;
    await repo.dispose();
    expect(contexts.map((context) => context.closeCount)).toEqual([1, 1]);
    await repo.dispose();
    expect(contexts.map((context) => context.closeCount)).toEqual([1, 1]);
  } finally {
    vi.unstubAllGlobals();
  }
});
