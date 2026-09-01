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
  // When a new service worker takes over, reload once so the tab actually runs the new
  // code. Without this the worker updates underneath a page that carries on executing the
  // old bundle from memory — which is why shipped fixes kept looking like they hadn't
  // worked until the tab was closed entirely.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

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
