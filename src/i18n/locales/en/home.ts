/** Strings of the "home" feature (the start page). Keep keys in sync with ../ru/home.ts (type-checked). */
const home = {
  tagline:
    'Edit, customize and optimize Lottie animations in your browser. Files stay on this device.',

  services: {
    edit: {
      description: 'Full control: layers, keyframes, easing, timing and the JSON.',
      action: 'Open file…',
      drop: 'Drop to edit',
      dropHint: 'Opens in the editor',
    },
    customize: {
      description: 'Put your logo, brand colors and texts into a ready-made animation.',
      action: 'Choose a Lottie…',
      drop: 'Drop to customize',
      dropHint: 'Opens in Customize',
    },
    optimize: {
      description: 'Make files smaller without visible changes, verified frame by frame.',
      action: 'Optimize files…',
      drop: 'Drop to optimize',
      dropHint: 'Adds them to the optimizer queue',
    },
  },

  /** Drop hint of the editor and Customize cards while an animation is open. */
  replaces: (name: string) => `Replaces “${name}”`,
  newAnimation: 'New animation',
  openUrl: 'Open from URL…',
  hint: 'Drop files on a card, or paste JSON or a link',

  current: {
    label: 'Open animation',
    continue: 'Continue editing',
    customize: 'Customize',
    optimize: 'Optimize',
  },

  /** Context menu items of recent files and samples. */
  menu: {
    customize: 'Open in Customize',
    optimize: 'Optimize',
  },
}

export default home
