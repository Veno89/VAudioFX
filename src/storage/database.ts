import type { Asset, Project } from '../domain/model';

export interface Preferences {
  favorites: string[];
  recent: string[];
  installed: string[];
}
export class LocalDatabase {
  private opened?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (!this.opened) {
      const opened: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(
            new Error('Browser storage is unavailable. Download a portable backup before leaving.'),
          );
          return;
        }
        const request = indexedDB.open('vaudiofx', 1);
        request.onupgradeneeded = () => {
          for (const name of ['projects', 'assets', 'settings'])
            if (!request.result.objectStoreNames.contains(name))
              request.result.createObjectStore(name);
        };
        request.onsuccess = () => {
          const db = request.result;
          const release = () => {
            if (this.opened === opened) this.opened = undefined;
          };
          db.onversionchange = () => {
            db.close();
            release();
          };
          db.onclose = release;
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
        request.onblocked = () =>
          reject(new Error('Close other VAudioFX tabs to update local storage.'));
      }).catch((error) => {
        if (this.opened === opened) this.opened = undefined;
        throw error;
      });
      this.opened = opened;
    }
    return this.opened;
  }
  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    action: (tx: IDBTransaction, done: (value: T) => void) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const db = await this.open();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      const abort = () => {
        try {
          tx.abort();
        } catch {
          /* The transaction already finished. */
        }
      };
      const release = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      tx.oncomplete = () => {
        release();
        resolve(value);
      };
      tx.onabort = () => {
        release();
        reject(
          signal?.aborted
            ? signal.reason
            : (tx.error ?? new Error('Local save failed. The previous saved project is safe.')),
        );
      };
      tx.onerror = () => {
        release();
        reject(
          tx.error ??
            new Error('Local storage is full or unavailable. Download a portable backup.'),
        );
      };
      try {
        action(tx, (result) => {
          value = result;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  async saveProject(
    project: Project,
    assets: Asset[],
    activate = true,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.transaction<void>(
      ['projects', 'assets', 'settings'],
      'readwrite',
      (tx) => {
        tx.objectStore('projects').put(project, project.id);
        for (const asset of assets) if (asset.blob) tx.objectStore('assets').put(asset, asset.id);
        if (activate) tx.objectStore('settings').put(project.id, 'activeProject');
      },
      signal,
    );
  }
  async saveAsset(asset: Asset): Promise<void> {
    await this.transaction<void>(['assets'], 'readwrite', (tx) => {
      tx.objectStore('assets').put(asset, asset.id);
    });
  }
  async deleteAsset(id: string): Promise<void> {
    await this.transaction<void>(['assets'], 'readwrite', (tx) => {
      tx.objectStore('assets').delete(id);
    });
  }
  async deleteProject(id: string): Promise<void> {
    await this.transaction<void>(['projects', 'settings'], 'readwrite', (tx) => {
      tx.objectStore('projects').delete(id);
      const request = tx.objectStore('settings').get('activeProject');
      request.onsuccess = () => {
        if (request.result === id) tx.objectStore('settings').delete('activeProject');
      };
    });
  }
  async all<T>(store: string): Promise<T[]> {
    return this.transaction<T[]>([store], 'readonly', (tx, done) => {
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => done(request.result as T[]);
    });
  }
  async get<T>(store: string, key: string): Promise<T | undefined> {
    return this.transaction<T | undefined>([store], 'readonly', (tx, done) => {
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => done(request.result as T | undefined);
    });
  }
  async setting(key: string, value: unknown): Promise<void> {
    await this.transaction<void>(['settings'], 'readwrite', (tx) => {
      tx.objectStore('settings').put(value, key);
    });
  }
  async close(): Promise<void> {
    const opened = this.opened;
    this.opened = undefined;
    if (opened) (await opened).close();
  }
}
export const database = new LocalDatabase();
