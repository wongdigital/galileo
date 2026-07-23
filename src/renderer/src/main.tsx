import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './state/theme'
// IBM Plex, bundled (no network fetch): only the weights the UI actually
// sets — sans 400/it/500/600/700, mono 400/500 (badges are mono medium).
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/400-italic.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/observatory.css'

async function mount(): Promise<void> {
  // Durable settings are async on every platform. Wait before mounting so
  // application content never paints in the wrong theme.
  await initTheme()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void mount()
