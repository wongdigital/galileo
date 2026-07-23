import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AboutApp } from './AboutApp'
import { applyThemeAttribute, loadThemePreference } from './state/themePreference'
// Same font set the main window loads — the About window is its own document
// and inherits none of the main window's styles.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/observatory.css'

async function mount(): Promise<void> {
  // Keep the graph-aware theme module out of this small bundle, but use the
  // same durable setting as the main window. The bounded read falls back to
  // dark if the platform adapter is unavailable or unresponsive.
  applyThemeAttribute(await loadThemePreference())
  createRoot(document.getElementById('about-root')!).render(
    <StrictMode>
      <AboutApp />
    </StrictMode>,
  )
}

void mount()
