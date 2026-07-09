import { useEffect, useRef, useState } from 'react'
import { useStadiumEvent } from '../game/events'
import { markTutorialDone, TUTORIAL, tutorialDone } from '../game/tutorial'

// First-visit walkthrough of the bend mechanic. Each step waits on the real
// game event for its action, and the game itself stops at each beat: 'aim'
// waits for the press, 'bend' freezes the power meter (TUTORIAL.freeze,
// read by Game's charging useFrame) until the drag crosses the bend threshold
// (stadium:bend) — then lingers BEND_DWELL (meter still frozen) so the tip
// gets read — 'release' waits for pointerup, and a 'done' beat hangs around
// after the kick. Kicking without bending restarts on the next ball.
const BEND_DWELL = 1600
const DONE_LINGER = 2400

const STEPS = {
  aim: { n: 1, text: 'Press & hold the goal to aim and charge your shot' },
  bend: {
    n: 2,
    text: 'Keep holding — drag left and right to bend the shot',
    sub: 'Bending makes it much harder for the goalie to save',
  },
  release: { n: 3, text: 'Release to shoot! The gold zone is a perfect strike' },
  done: { n: 3, text: 'You got it! Bend it around the keeper to score' },
}

export function Tutorial() {
  const [step, setStep] = useState(() => (tutorialDone() ? null : 'aim'))
  const [bent, setBent] = useState({ left: false, right: false })
  const timer = useRef(null)

  const finish = () => {
    clearTimeout(timer.current)
    TUTORIAL.freeze = false
    TUTORIAL.slow = false
    markTutorialDone()
    setStep(null)
  }

  useStadiumEvent('stadium:windup', () => {
    if (step === 'aim') {
      TUTORIAL.freeze = true
      setBent({ left: false, right: false })
      setStep('bend')
    }
  })
  useStadiumEvent('stadium:bend', (event) => {
    if (step !== 'bend') return
    const next = { ...bent, [event.detail > 0 ? 'right' : 'left']: true }
    setBent(next)
    if (!next.left || !next.right) return
    // Both curls felt — linger with the meter still frozen so the goalie tip
    // gets read before the release pressure starts.
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      TUTORIAL.freeze = false
      // Half-speed meter for the first release so the gold zone can be read.
      TUTORIAL.slow = true
      setStep('release')
    }, BEND_DWELL)
  })
  useStadiumEvent('stadium:kick', () => {
    clearTimeout(timer.current)
    TUTORIAL.freeze = false
    TUTORIAL.slow = false
    if (step === 'release') {
      markTutorialDone()
      setStep('done')
      timer.current = setTimeout(() => setStep(null), DONE_LINGER)
    }
  })
  useStadiumEvent('stadium:reset', () => {
    if (step && step !== 'done') setStep('aim')
  })
  // Leaving the match mid-tutorial must never leave the meter frozen.
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      TUTORIAL.freeze = false
      TUTORIAL.slow = false
    },
    [],
  )

  if (!step) return null
  let { n, text, sub } = STEPS[step]
  if (step === 'bend') {
    if (bent.left && bent.right) text = 'Beautiful! That curl will beat the keeper'
    else if (bent.left || bent.right) text = `Nice — now bend it ${bent.left ? 'right' : 'left'}!`
    sub = `${sub} · ${bent.left ? '✓' : '◦'} left ${bent.right ? '✓' : '◦'} right`
  }
  const stop = (e) => e.stopPropagation()
  // Dim vignette on the stopped teaching beats (aim wait + bend freeze) so
  // "the game is paused, read this" is unmissable; release/done play live.
  const frozen = step === 'aim' || step === 'bend'
  return (
    <>
      {frozen && <div className="tutorial-dim" />}
      <div className="tutorial-card" key={step}>
      <span className="tutorial-step">{step === 'done' ? '✓' : `${n} / 3`}</span>
      <span className="tutorial-copy">
        <span className="tutorial-text">{text}</span>
        {sub && <span className="tutorial-sub">{sub}</span>}
      </span>
        {step !== 'done' && (
          <button className="tutorial-skip" onClick={finish} onPointerDown={stop} onPointerUp={stop}>
            skip
          </button>
        )}
      </div>
    </>
  )
}
