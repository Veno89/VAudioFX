import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { LocalDatabase } from '../src/storage/database';
import { newProject, type Asset } from '../src/domain/model';
import { cleanEffects } from '../src/domain/model';
import { loadPresets, savePresets } from '../src/storage/presets';

describe('local atomic persistence', () => {
  it('reopens storage after a forced close while preserving committed data', async () => {
    const db = new LocalDatabase(),
      project = newProject('Survives connection close');
    const nativeOpen = indexedDB.open.bind(indexedDB);
    let connection!: IDBDatabase;
    const open = vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
      const request = nativeOpen(...args);
      request.addEventListener('success', () => {
        connection = request.result;
      });
      return request;
    });
    try {
      await db.saveProject(project, []);
      // The installed test library incorrectly types this instance parameter as its constructor.
      (forceCloseDatabase as unknown as (db: IDBDatabase) => void)(connection);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await db.get('projects', project.id)).toEqual(project);
      expect(open).toHaveBeenCalledTimes(2);
    } finally {
      open.mockRestore();
    }
  });
  it('atomically rolls back project, original and activation when canceled during writes', async () => {
    const db = new LocalDatabase(),
      original = newProject('Prior active'),
      next = newProject('Canceled import');
    await db.saveProject(original, []);
    const controller = new AbortController(),
      put = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const result = put.call(this, value, key);
      if (this.name === 'assets') controller.abort();
      return result;
    });
    const asset = { id: 'canceled-original', blob: new Blob(['audio']) } as Asset;
    try {
      await expect(db.saveProject(next, [asset], true, controller.signal)).rejects.toThrow();
    } finally {
      failure.mockRestore();
    }
    expect(await db.get('projects', next.id)).toBeUndefined();
    expect(await db.get('assets', asset.id)).toBeUndefined();
    expect(await db.get('settings', 'activeProject')).toBe(original.id);
  });
  it('stages generated templates without changing the active project', async () => {
    const db = new LocalDatabase(),
      original = newProject('Working project'),
      generated = newProject('Prepared template');
    await db.saveProject(original, []);
    await db.saveProject(generated, [], false);
    expect(await db.get('settings', 'activeProject')).toBe(original.id);
    expect(await db.get('projects', generated.id)).toEqual(generated);
  });
  it('persists custom chains and retains the last preset after storage failure', async () => {
    const original = [
      {
        id: 'custom-chain',
        name: 'Weight',
        effects: { ...cleanEffects(), eq: { low: 6, mid: 0, high: -3 } },
      },
    ];
    await savePresets(original);
    expect(await loadPresets()).toEqual(original);
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    try {
      await expect(savePresets([])).rejects.toThrow('Storage full');
    } finally {
      failure.mockRestore();
    }
    expect(await loadPresets()).toEqual(original);
  });
  it('persists original blobs and project edits across database instances', async () => {
    const db = new LocalDatabase(),
      p = newProject('Saved voice');
    const asset: Asset = {
      id: 'stored-voice',
      name: 'Take',
      kind: 'recording',
      category: 'Recordings',
      tags: [],
      duration: 1,
      size: 3,
      mime: 'audio/wav',
      originalFilename: 'take.wav',
      blob: new Blob(['abc']),
    };
    await db.saveProject(p, [asset]);
    const next = new LocalDatabase();
    expect(await next.get('projects', p.id)).toEqual(p);
    expect((await next.get<Asset>('assets', asset.id))?.blob?.size).toBe(3);
    expect(await next.get('settings', 'activeProject')).toBe(p.id);
  });
  it('keeps the previous saved project when a save aborts', async () => {
    const db = new LocalDatabase(),
      p = newProject('Recoverable');
    await db.saveProject(p, []);
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    await expect(db.saveProject({ ...p, name: 'Lost edit' }, [])).rejects.toThrow();
    failure.mockRestore();
    expect((await db.get<typeof p>('projects', p.id))?.name).toBe('Recoverable');
  });
});
