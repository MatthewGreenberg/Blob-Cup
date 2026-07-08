import { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { useStadiumEvent } from '../game/events'

// DOM/CSS loading overlay. The main R3F canvas doesn't paint a single frame
// until its Suspense tree resolves, so this covers the boot. Pure CSS (no
// second WebGL canvas) — the compositor keeps the bounce smooth even while
// the main thread is busy parsing GLBs. Fades out on stadium:loaded (the
// real "stadium is on screen" signal) and unmounts.
export function Loading() {
  const { progress } = useProgress()
  const pct = Math.round(progress)
  // Display the running max: progress dips when late assets (the env map)
  // join the load queue, and a bar that moves backwards reads as broken.
  const [shown, setShown] = useState(0)
  if (pct > shown) setShown(pct)

  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  useStadiumEvent('stadium:loaded', () => setLeaving(true))
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setGone(true), 750) // matches the CSS fade
    return () => clearTimeout(t)
  }, [leaving])

  if (gone) return null
  return (
    <div className={`loader${leaving ? ' is-leaving' : ''}`}>
      <div className="loader-stage">
        <span className="loader-shadow" />
        <span className="loader-ball" />
      </div>
      <div className="loader-bar">
        <div className="loader-bar-fill" style={{ width: `${shown}%` }} />
      </div>
      <span className="loader-label">loading {shown}%</span>
    </div>
  )
}
