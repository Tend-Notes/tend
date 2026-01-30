// SPDX-License-Identifier: MIT WITH Commons-Clause
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'

// iOS-specific: prevent auto-zoom on input focus without breaking Android accessibility
// See: https://weblog.west-wind.com/posts/2023/Apr/17/Preventing-iOS-Textbox-Auto-Zooming-and-ViewPort-Sizing
if (navigator.userAgent.indexOf('iPhone') > -1) {
  const viewport = document.querySelector('[name=viewport]')
  if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no, viewport-fit=cover')
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
