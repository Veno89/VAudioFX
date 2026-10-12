import { Button } from './ui';
import type { Recipe } from '../features/recipes';

export function RecipeGuide({
  recipe,
  step,
  canAct,
  busy,
  hasClips,
  onAction,
  onStep,
  onRecord,
  onPreview,
  onExport,
  onClose,
}: {
  recipe: Recipe;
  step: number;
  canAct: boolean;
  busy: boolean;
  hasClips: boolean;
  onAction: () => void;
  onStep: (step: number) => void;
  onRecord: () => void;
  onPreview: () => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const current = recipe.steps[step];
  return (
    <section className="recipe-guide" aria-label="Guided recipe">
      <div className="recipe-heading">
        <div>
          <span className="eyebrow">
            GUIDED RECIPE · {step + 1} / {recipe.steps.length}
          </span>
          <h2>{recipe.name}</h2>
        </div>
        <Button label="Close recipe" onClick={onClose}>
          ×
        </Button>
      </div>
      <div aria-live="polite">
        <h3>{current.title}</h3>
        <p>{current.explanation}</p>
      </div>
      <div className="recipe-actions">
        {step > 0 && (
          <Button onClick={() => onStep(step - 1)} disabled={busy}>
            Previous step
          </Button>
        )}
        {recipe.id === 'undead' && step === 0 && (
          <Button onClick={onRecord} disabled={busy}>
            Record a voice take
          </Button>
        )}
        {current.action ? (
          <Button className="primary" onClick={onAction} disabled={!canAct || busy}>
            {current.button}
          </Button>
        ) : (
          <>
            <Button onClick={onPreview} disabled={!hasClips || busy}>
              Preview recipe sound
            </Button>
            <Button className="primary" onClick={onExport} disabled={!hasClips || busy}>
              Export recipe WAV
            </Button>
            <Button onClick={onClose}>Finish recipe</Button>
          </>
        )}
      </div>
      {current.action && !canAct && (
        <p className="help">
          {current.action === 'use-voice'
            ? 'Select a recorded or imported voice clip to continue.'
            : 'The recipe clip was removed. Restart the recipe from the Recipes tab.'}
        </p>
      )}
    </section>
  );
}
