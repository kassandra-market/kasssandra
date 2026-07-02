import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Local fonts (offline-safe — no hotlinked Google Fonts CDN).
// Cormorant Garamond 300/400 (display serif), Inter 400/500 (body/UI),
// Roboto Mono 400 (code accents). Only the weights we use.
import '@fontsource/cormorant-garamond/300.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/roboto-mono/400.css'

import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
