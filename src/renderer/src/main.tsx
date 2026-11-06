import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installBrowserShim } from './browserShim'
import './styles.css'

installBrowserShim()

// macOS traffic lights overlay the top-left corner — flag it for CSS
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  document.documentElement.classList.add('is-mac')
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
