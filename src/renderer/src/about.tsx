import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AboutApp } from './AboutApp'
// Same font set the main window loads — the About window is its own document
// and inherits none of the main window's styles.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/observatory.css'

// Apply the persisted theme before mount so there is no dark flash for
// light-theme users. Done inline, reading the same localStorage key as
// state/theme.ts (STORAGE_KEY), to keep the main app's theme module — and the
// graph painter it imports — out of this window's bundle. The About window is a
// snapshot: it reads the theme once and does not live-follow a later toggle.
try {
  if (localStorage.getItem('galileo.theme') === 'light') {
    document.documentElement.dataset.theme = 'light'
  }
} catch {
  // Default dark.
}

createRoot(document.getElementById('about-root')!).render(
  <StrictMode>
    <AboutApp />
  </StrictMode>,
)
