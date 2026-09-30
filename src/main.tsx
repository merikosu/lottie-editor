import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './app/App'
import { ensureLanguage } from './i18n'
import { usePrefs } from './store/prefs'

if (import.meta.env.DEV) {
  void import('./app/devtools').then((m) => m.installDevtools())
}

// Load the UI language before the first paint so the interface never flashes in English.
void ensureLanguage(usePrefs.getState().language)
  .catch((err) => console.error('Could not load the UI language', err))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
