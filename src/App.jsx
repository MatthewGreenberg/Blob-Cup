import { useEffect, useState } from 'react'
import { Leva } from 'leva'
import './App.css'
import './game/preloadAssets'
import { Hud } from './components/Hud'
import { Loading } from './components/Loading'
import { Scene } from './components/Scene'
import { Tutorial } from './components/Tutorial'
import { Ui } from './components/Ui'
import { PRACTICE_CFG, ROUNDS } from './game/constants'
import { playCheer, playKick, toggleSound, unlockSound } from './game/sound'

function SoundToggle() {
  const [on, setOn] = useState(true) // the sound preference boots ON
  // the engine listens for pointerup on WINDOW (serve release / shots) — keep
  // every pointer event on this button from ever reaching it
  const stop = (e) => e.stopPropagation()
  return (
    <button
      className={`sound-btn ${on ? '' : 'muted'}`}
      onClick={(e) => {
        e.stopPropagation()
        setOn(toggleSound())
      }}
      onPointerDown={stop}
      onPointerUp={stop}
      aria-label={on ? 'turn sound off' : 'turn sound on'}
      title={on ? 'sound off' : 'sound on'}
    >
      <svg viewBox="0 0 30 14">
        <path
          className="sw-wave"
          d="M-7 7 Q -5 1, -3 7 T 1 7 T 5 7 T 9 7 T 13 7 T 17 7 T 21 7 T 25 7 T 29 7 T 33 7 T 37 7 T 41 7"
        />
        <path className="sw-flat" d="M1 7 L 29 7" />
      </svg>
    </button>
  )
}

const DEBUG = new URLSearchParams(window.location.search).has('debug')

function App() {
  // screen: menu | about | bracket | match | result | champion
  const [screen, setScreen] = useState('menu')
  const [mode, setMode] = useState('practice')
  const [round, setRound] = useState(0)
  const cfg = mode === 'tournament' ? ROUNDS[round] : PRACTICE_CFG
  // weather rides the round config (clear → rain → snow); the envelopes in
  // <Weather /> cross-fade, so it changes on the bracket screen before the match
  const weather = cfg.weather

  // Unlock audio on the first click; play the kick on foot-on-ball (stadium:launch).
  useEffect(() => {
    const unlock = () => unlockSound()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('stadium:launch', playKick)
    window.addEventListener('stadium:goal', playCheer)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('stadium:launch', playKick)
      window.removeEventListener('stadium:goal', playCheer)
    }
  }, [])

  return (
    <main className="app-shell">
      <Leva hidden={!DEBUG} />
      <Scene cfg={cfg} screen={screen} weather={weather} />
      {screen === 'match' && <Hud mode={mode} cfg={cfg} />}
      {screen === 'match' && <Tutorial />}
      <Ui screen={screen} setScreen={setScreen} mode={mode} setMode={setMode} round={round} setRound={setRound} />
      <SoundToggle />
      <Loading />
    </main>
  )
}

export default App
