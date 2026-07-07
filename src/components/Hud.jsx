import { useEffect, useRef, useState } from 'react'
import { PERFECT_MAX, PERFECT_MIN } from '../game/constants'
import { useStadiumEvent } from '../game/events'

// DOM overlay outside the Canvas: running score, streak, GOAL/SAVED/PERFECT
// banner, aim hint, and the power bar with its gold perfect zone.
export function Hud() {
  const [score, setScore] = useState({ goals: 0, shots: 0 })
  const [streak, setStreak] = useState(0)
  const [banner, setBanner] = useState(null)
  const [charging, setCharging] = useState(false)
  const bannerTimer = useRef(null)
  const powerRef = useRef(null)
  const streakRef = useRef(0)

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
    streakRef.current += 1
    setStreak(streakRef.current)
    setScore((value) => ({ ...value, goals: value.goals + 1 }))
    flash('goal', streakRef.current >= 3 ? `GOOOAL! ×${streakRef.current}` : 'GOOOAL!')
  })
  useStadiumEvent('stadium:save', () => {
    streakRef.current = 0
    setStreak(0)
    flash('save', 'SAVED!')
  })
  useEffect(() => () => clearTimeout(bannerTimer.current), [])

  return (
    <div className="game-hud">
      <div className="game-score">
        ⚽ {score.goals} <span>/ {score.shots}</span>
        {streak >= 2 && <em className="game-streak">🔥×{streak}</em>}
      </div>
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
            style={{ left: `${PERFECT_MIN * 100}%`, width: `${(PERFECT_MAX - PERFECT_MIN) * 100}%` }}
          />
        </div>
      )}
      <div className="game-hint">watch the keeper · hold to run up &amp; charge · gold zone = perfect</div>
    </div>
  )
}
