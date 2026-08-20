import './index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'

// Browsers only re-check a service worker for updates on navigation — an open SPA tab
// (no full-page navigations, just client-side routing) can otherwise sit on a stale
// build indefinitely after a deploy. Poll explicitly; registerType 'autoUpdate' takes
// it from there (installs + activates + reloads the page once a new version is found).
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => registration.update(), 60 * 1000)
    },
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
