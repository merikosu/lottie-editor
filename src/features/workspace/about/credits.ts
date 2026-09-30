/**
 * Open-source projects shipped with the app (runtime dependencies and the UI font), with their
 * licenses as declared in their package.json files.
 */
export interface Credit {
  name: string
  license: string
  url: string
}

export const CREDITS: readonly Credit[] = [
  { name: 'lottie-web', license: 'MIT', url: 'https://github.com/airbnb/lottie-web' },
  { name: 'React', license: 'MIT', url: 'https://react.dev' },
  { name: 'Radix UI', license: 'MIT', url: 'https://www.radix-ui.com' },
  { name: 'CodeMirror', license: 'MIT', url: 'https://codemirror.net' },
  { name: 'cmdk', license: 'MIT', url: 'https://github.com/pacocoursey/cmdk' },
  { name: 'Mediabunny', license: 'MPL-2.0', url: 'https://mediabunny.dev' },
  { name: 'gifenc', license: 'MIT', url: 'https://github.com/mattdesl/gifenc' },
  { name: 'fflate', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
  { name: 'Zustand', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'Immer', license: 'MIT', url: 'https://github.com/immerjs/immer' },
  {
    name: 'react-resizable-panels',
    license: 'MIT',
    url: 'https://github.com/bvaughn/react-resizable-panels',
  },
  { name: 'react-colorful', license: 'MIT', url: 'https://github.com/omgovich/react-colorful' },
  { name: 'Sonner', license: 'MIT', url: 'https://github.com/emilkowalski/sonner' },
  { name: 'idb-keyval', license: 'Apache-2.0', url: 'https://github.com/jakearchibald/idb-keyval' },
  { name: 'Lucide', license: 'ISC', url: 'https://lucide.dev' },
  { name: 'Tailwind CSS', license: 'MIT', url: 'https://tailwindcss.com' },
  { name: 'tailwind-merge', license: 'MIT', url: 'https://github.com/dcastil/tailwind-merge' },
  { name: 'clsx', license: 'MIT', url: 'https://github.com/lukeed/clsx' },
  { name: 'Inter', license: 'OFL-1.1', url: 'https://rsms.me/inter' },
]

export const REPOSITORY_URL = 'https://github.com/merikosu/lottie-editor'
export const ISSUES_URL = `${REPOSITORY_URL}/issues`
