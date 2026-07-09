import { useEffect, useRef, useState } from 'react'
import { PERFECT_MAX, PERFECT_MIN } from '../game/constants'
import { useStadiumEvent } from '../game/events'
import { tutorialDone } from '../game/tutorial'

// DOM overlay outside the Canvas: running score, GOAL/SAVED/PERFECT
// banner, aim hint, and the power bar with its gold perfect zone.
export function Hud({ mode, cfg }) {
  const perfectMin = cfg?.perfectMin ?? PERFECT_MIN
  const perfectMax = cfg?.perfectMax ?? PERFECT_MAX
  const [score, setScore] = useState({ goals: 0, shots: 0 })
  const [banner, setBanner] = useState(null)
  const [charging, setCharging] = useState(false)
  const bannerTimer = useRef(null)
  const powerRef = useRef(null)

  const flash = (kind, text) => {
    setBanner({ kind, text, id: Date.now() })
    clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 1600)
  }

  useStadiumEvent('stadium:windup', () => setCharging(true))
  useStadiumEvent('stadium:power', (event) => powerRef.current?.style.setProperty('--p', event.detail))
  useStadiumEvent('stadium:kick', () => {
    setCharging(false)
    setScore((value) => ({ ...value, shots: value.shots + 1 }))
  })
  useStadiumEvent('stadium:perfect', () => flash('perfect', 'PERFECT!'))
  useStadiumEvent('stadium:goal', () => {
    setScore((value) => ({ ...value, goals: value.goals + 1 }))
    flash('goal', 'GOOOAL!')
  })
  useStadiumEvent('stadium:save', (event) => flash('save', event.detail === 'over' ? 'OVER!' : 'SAVED!'))
  // A tutorial-canceled release resets without ever kicking — drop the bar.
  useStadiumEvent('stadium:reset', () => setCharging(false))
  useEffect(() => () => clearTimeout(bannerTimer.current), [])

  return (
    <div className="game-hud">
      {mode !== 'tournament' && (
        <div className="game-score">
          ⚽ {score.goals} <span>/ {score.shots}</span>
        </div>
      )}
      {banner && (
        <div key={banner.id} className={`game-banner game-banner--${banner.kind}`}>
          {banner.text}
        </div>
      )}
      {charging && (
        <div className="game-power" ref={powerRef}>
          <div className="game-power-fill" />
          <div
            className="game-power-zone"
            style={{ left: `${perfectMin * 100}%`, width: `${(perfectMax - perfectMin) * 100}%` }}
          />
        </div>
      )}
      {mode !== 'tournament' && tutorialDone() && (
        <div className="game-hint">watch the keeper · hold to run up &amp; charge · gold zone = perfect</div>
      )}
    </div>
  )
}
