import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/registerSW.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker after the React tree mounts.
// We intentionally do NOT auto-update to avoid interrupting an active sync.
// The app can pass callbacks here when it gains an update-notification UI.
registerServiceWorker().catch(console.error)
