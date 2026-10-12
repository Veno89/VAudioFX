import { useState } from 'react';
import {
  Search,
  Upload,
  Play,
  Plus,
  Star,
  Package,
  AudioLines,
  Mic,
  Check,
  Download,
  Trash2,
  Pencil,
} from 'lucide-react';
import type { Asset } from '../domain/model';
import { Button } from './ui';
import { PACKS, starterIds } from '../features/library';
import { templates } from '../features/templates';
import { recipes } from '../features/recipes';
import type { Preferences } from '../storage/database';

export function Library({
  assets,
  preferences,
  onAdd,
  onPreview,
  onImport,
  onRecord,
  onFavorite,
  onPack,
  onTemplate,
  onRecipe,
  onGenerate,
  creativeBusy,
  onLicenses,
  onRename,
  onDelete,
  downloading,
}: {
  assets: Asset[];
  preferences: Preferences;
  onAdd: (asset: Asset) => void;
  onPreview: (asset: Asset) => void;
  onImport: () => void;
  onRecord: () => void;
  onFavorite: (id: string) => void;
  onPack: (id: string) => void;
  onTemplate: (id: string) => void;
  onRecipe: (id: string) => void;
  onGenerate: () => void;
  creativeBusy: boolean;
  onLicenses: () => void;
  onRename: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
  downloading: string;
}) {
  const [tab, setTab] = useState('sounds'),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState('All sounds'),
    [tag, setTag] = useState('');
  const categories = [
    'All sounds',
    'Starter selection',
    'Favorites',
    'Recent',
    'Recordings',
    'Imported',
    ...new Set(assets.filter((a) => a.kind === 'builtin').map((a) => a.category)),
  ];
  let visible = assets.filter(
    (a) =>
      category === 'All sounds' ||
      (category === 'Starter selection' && starterIds.includes(a.id)) ||
      (category === 'Favorites' && preferences.favorites.includes(a.id)) ||
      (category === 'Recent' && preferences.recent.includes(a.id)) ||
      a.category === category,
  );
  const tags = [...new Set(visible.flatMap((a) => a.tags))].sort();
  visible = visible.filter(
    (a) =>
      (!tag || a.tags.includes(tag)) &&
      `${a.name} ${a.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  );
  if (category === 'Recent')
    visible.sort((a, b) => preferences.recent.indexOf(a.id) - preferences.recent.indexOf(b.id));
  return (
    <aside className="library panel" aria-label="Sound library">
      <div className="panel-heading">
        <h2>Sound library</h2>
        <span className="count">{assets.length}</span>
      </div>
      <div className="tabs">
        <button className={tab === 'sounds' ? 'selected' : ''} onClick={() => setTab('sounds')}>
          Sounds
        </button>
        <button
          className={tab === 'templates' ? 'selected' : ''}
          onClick={() => setTab('templates')}
        >
          Templates
        </button>
        <button className={tab === 'packs' ? 'selected' : ''} onClick={() => setTab('packs')}>
          Packs
        </button>
        <button className={tab === 'recipes' ? 'selected' : ''} onClick={() => setTab('recipes')}>
          Recipes
        </button>
      </div>
      {tab === 'sounds' && (
        <>
          <div className="library-tools">
            <label className="search">
              <Search size={15} />
              <input
                aria-label="Search sounds"
                placeholder="Find a sound…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Sound category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setTag('');
              }}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select aria-label="Sound tag" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <div className="library-actions">
              <Button onClick={onImport}>
                <Upload size={14} /> Import audio
              </Button>
              <Button onClick={onRecord}>
                <Mic size={14} /> Record
              </Button>
              <Button onClick={onGenerate} disabled={creativeBusy}>
                Generate sound
              </Button>
            </div>
          </div>
          <div className="sound-list">
            <div className="list-caption">
              {visible.length} SOUNDS <span>PREVIEW · ADD</span>
            </div>
            {visible.map((asset) => (
              <div
                key={asset.id}
                className="sound-row"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-vaudiofx-asset', asset.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <div className="sound-icon">
                  <AudioLines size={17} />
                </div>
                <div className="sound-info">
                  <strong title={asset.name}>{asset.name}</strong>
                  <small>
                    {asset.duration.toFixed(2)}s <span>· {asset.category}</span>
                  </small>
                </div>
                <Button
                  label={`Favorite ${asset.name}`}
                  active={preferences.favorites.includes(asset.id)}
                  onClick={() => onFavorite(asset.id)}
                >
                  <Star
                    size={12}
                    fill={preferences.favorites.includes(asset.id) ? 'currentColor' : 'none'}
                  />
                </Button>
                <Button label={`Preview ${asset.name}`} onClick={() => onPreview(asset)}>
                  <Play size={14} />
                </Button>
                <Button label={`Add ${asset.name}`} onClick={() => onAdd(asset)}>
                  <Plus size={16} />
                </Button>
                {(asset.kind !== 'builtin' ||
                  (asset.category === 'Synthesis' && asset.tags.includes('procedural'))) && (
                  <details className="asset-menu">
                    <summary aria-label={`Manage ${asset.name}`}>⋯</summary>
                    <div>
                      <Button onClick={() => onRename(asset)}>
                        <Pencil size={12} /> Rename
                      </Button>
                      <Button onClick={() => onDelete(asset)}>
                        <Trash2 size={12} /> Delete
                      </Button>
                    </div>
                  </details>
                )}
              </div>
            ))}
            {!visible.length && (
              <div className="small-empty">
                <Search size={24} />
                <strong>No sounds here yet</strong>
                <p>Try another search, import a file, or record a take.</p>
              </div>
            )}
          </div>
        </>
      )}
      {tab === 'templates' && (
        <div className="cards">
          <p className="help">
            Twelve starting sounds, generated locally. Voice textures are synthesized; layer your
            own recording for a personal character. Every layer is editable.
          </p>
          <Button onClick={onGenerate} disabled={creativeBusy}>
            Generate sound
          </Button>
          {templates.map((t) => (
            <button
              className="template-card"
              key={t.id}
              onClick={() => onTemplate(t.id)}
              disabled={creativeBusy}
            >
              <span className="template-symbol">
                <AudioLines size={22} />
              </span>
              <strong>{t.name}</strong>
              <p>{t.description}</p>
              <small>
                {t.category} · {t.type} <span>Open template →</span>
              </small>
            </button>
          ))}
        </div>
      )}
      {tab === 'recipes' && (
        <div className="cards">
          <p className="help">
            Follow a short guide that changes real clips and layers. You can pause the guide and
            edit freely.
          </p>
          {recipes.map((r) => (
            <div className="recipe" key={r.id}>
              <h3>{r.name}</h3>
              <p>{r.description}</p>
              <Button onClick={() => onRecipe(r.id)} disabled={creativeBusy}>
                Start {r.name}
              </Button>
            </div>
          ))}
        </div>
      )}
      {tab === 'packs' && (
        <div className="cards">
          <p className="help">
            All bundled samples are available on demand. Cache a pack for reuse without fetching its
            audio again.
          </p>
          {PACKS.map((pack) => (
            <div className="pack-card" key={pack.id}>
              <Package size={22} />
              <h3>{pack.name}</h3>
              <p>{pack.description}</p>
              <small>{assets.filter((a) => a.pack === pack.id).length} sounds · Kenney · CC0</small>
              <Button
                disabled={!!downloading || preferences.installed.includes(pack.id)}
                onClick={() => onPack(pack.id)}
              >
                {preferences.installed.includes(pack.id) ? (
                  <Check size={14} />
                ) : (
                  <Download size={14} />
                )}
                {preferences.installed.includes(pack.id)
                  ? 'Cached locally'
                  : downloading.startsWith(pack.id)
                    ? downloading.slice(pack.id.length + 1)
                    : 'Cache pack'}
              </Button>
            </div>
          ))}
        </div>
      )}
      <footer>
        <span className="local-dot" /> Audio stays on your device{' '}
        <button onClick={onLicenses}>Licenses ↗</button>
      </footer>
    </aside>
  );
}
