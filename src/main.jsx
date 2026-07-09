import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.jsx'

// drei's <Trail> (fire VFX) seeds its meshline with the ball position repeated
// on every mount, so meshline normalizes zero-length segments → one NaN frame
// per shot. Swallow only that exact warning (matched by MeshLine geometry) so
// genuine NaN geometry elsewhere still reports.
// ponytail: scoped console filter — drop if drei/meshline ever guards the init.
const origError = console.error
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('computeBoundingBox') && args[1]?.type === 'MeshLine') return
  origError(...args)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
)
