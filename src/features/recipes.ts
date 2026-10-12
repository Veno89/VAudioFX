export type RecipeAction =
  | 'use-voice'
  | 'creature'
  | 'bubble'
  | 'space'
  | 'fireball'
  | 'impact'
  | 'ui'
  | 'brighten'
  | 'repeat';
interface RecipeStep {
  title: string;
  explanation: string;
  action?: RecipeAction;
  button?: string;
}
export interface Recipe {
  id: string;
  name: string;
  description: string;
  steps: RecipeStep[];
}
export const recipes: Recipe[] = [
  {
    id: 'undead',
    name: 'Create an Undead Gurgle',
    description: 'Turn your own voice into a layered creature sound.',
    steps: [
      {
        title: 'Start with your voice',
        explanation:
          'Record a low gurgle, or import a take and add it to the timeline. Select that clip. The original recording stays unchanged.',
        action: 'use-voice',
        button: 'Use selected voice clip',
      },
      {
        title: 'Give it depth and grit',
        explanation:
          'Creature voice lowers pitch and speed, removes harsh high frequencies, and adds mild saturation. The clip becomes deeper and longer.',
        action: 'creature',
        button: 'Apply Creature voice to recipe clip',
      },
      {
        title: 'Blend a bubbling layer',
        explanation:
          'A quiet, pulsing low tone adds a wet texture on a separate layer. Both layers remain editable; lower its gain if it masks your voice.',
        action: 'bubble',
        button: 'Add bubbling texture',
      },
      {
        title: 'Put the creature in a room',
        explanation:
          'A little room reverb and echo help the layers belong together. Select either clip to adjust its character in the inspector.',
        action: 'space',
        button: 'Add a little space',
      },
      {
        title: 'Listen, adjust, and export',
        explanation:
          'Preview at a comfortable volume. Adjust depth, dirt, or the texture mix, then export the full timeline. A 2.2-second tail preserves room and echo.',
      },
    ],
  },
  {
    id: 'fireball',
    name: 'Build a Fireball',
    description: 'Shape a launch, impact, and rumble into one spell.',
    steps: [
      {
        title: 'Start with three editable layers',
        explanation:
          'Open the Fireball template. Your current project is saved first. The rush leads into an impact and low rumble.',
        action: 'fireball',
        button: 'Open Fireball for this recipe',
      },
      {
        title: 'Give the impact weight',
        explanation:
          'Focus the impact crack and add bass weight, grit, and compression. Its playback becomes slightly deeper and longer.',
        action: 'impact',
        button: 'Shape the impact',
      },
      {
        title: 'Join the layers with space',
        explanation:
          'A restrained room and echo soften the impact into the rumble. Drag the clips to explore different launch-to-impact timings.',
        action: 'space',
        button: 'Add a little space',
      },
      {
        title: 'Audition and export',
        explanation:
          'Preview all three layers, adjust their balance, and export the complete spell with a 2.2-second tail.',
      },
    ],
  },
  {
    id: 'ui',
    name: 'Make UI Feedback',
    description: 'Build a clean, short cue with a paired tone.',
    steps: [
      {
        title: 'Start with a compact click',
        explanation:
          'Open a clean tone and crisp contact tick. Your current project is saved first. Short sources keep UI feedback responsive.',
        action: 'ui',
        button: 'Open UI Click for this recipe',
      },
      {
        title: 'Make the tone clearer',
        explanation:
          'Open the low-pass filter and add a little upper EQ so the cue stays distinct at a low listening level.',
        action: 'brighten',
        button: 'Brighten the tone',
      },
      {
        title: 'Try a paired cue',
        explanation:
          'Repeat the tone once, immediately after the first. This is one undoable edit; move either clip to change the rhythm.',
        action: 'repeat',
        button: 'Repeat the tone',
      },
      {
        title: 'Listen and export',
        explanation:
          'Preview the paired cue. Use mono WAV for a small game asset, and shorten the export tail if you do not add room or echo.',
      },
    ],
  },
];
