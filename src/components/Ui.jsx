import { useEffect, useRef, useState } from 'react'
import { MATCH_GOALS_TO_WIN, MATCH_SHOTS, ROUNDS } from '../game/constants'
import { emitStadiumEvent, useStadiumEvent } from '../game/events'

// DOM overlays outside the Canvas: home menu, about, animated tournament
// bracket, in-match chip, round result and champion screens. Overlays have
// pointer-events so they also block the game's canvas input while shown.
// Tournament flow: menu -> bracket -> match -> result -> bracket ... -> champion.
// Match rule: first to MATCH_GOALS_TO_WIN goals out of MATCH_SHOTS shots.

// Scripted 8-team bracket — Player 1's road is fixed (Red Blobs, Green Blobs,
// Bears); the other matchups exist for flavor and their winners are scripted.
const STAGES = [
  {
    label: 'Quarter Final',
    matches: [
      ['Player 1', 'Red Blobs'],
      ['Green Blobs', 'Puddings'],
      ['Marshmallows', 'Wigglers'],
      ['Snackers', 'Bears'],
    ],
    winners: ['Player 1', 'Green Blobs', 'Marshmallows', 'Bears'],
  },
  {
    label: 'Semi Final',
    matches: [
      ['Player 1', 'Green Blobs'],
      ['Marshmallows', 'Bears'],
    ],
    winners: ['Player 1', 'Bears'],
  },
  {
    label: 'Final',
    matches: [['Player 1', 'Bears']],
    winners: ['Player 1'],
  },
]

// Opponent scoreboard tint per round (Red Blobs → red default, Green Blobs, Bears).
const OPP_THEME = ['', 'is-green', 'is-yellow']
// Solid team colours matching the HUD scoreboard gradients, shared with the jumbotron.
const HUD_BLUE = '#2f6fe0'
const OPP_COLOR = ['#b23636', '#2e9c4d', '#c48a1a']
// Opponent team icon per round (Red Blobs → Green Blobs → Bears).
const OPP_ICON = ['/images/red-blob.png', '/images/green-blob.png', '/images/bear.png']

function Bracket({ round }) {
  return (
    <div className="bracket">
      {STAGES.map((stage, si) => {
        // No spoilers: a stage's lineup is only known once you reach it, and
        // its winners only once you're past it — losers get struck round by round.
        const known = si <= round
        const decided = si < round
        return (
          <div className="bracket-col" key={stage.label} style={{ '--d': `${si * 0.18}s` }}>
            <div className="bracket-stage">{stage.label}</div>
            <div className="bracket-matches">
              {stage.matches.map((pair, mi) => {
                const teams = known ? pair : ['???', '???']
                const winner = decided ? stage.winners[mi] : null
                const current = si === round && pair.includes('Player 1')
                return (
                  <div
                    key={pair.join()}
                    className={`bracket-match${current ? ' is-current' : ''}${known ? '' : ' is-tbd'}`}
                  >
                    {teams.map((team, ti) => (
                      <div
                        key={ti}
                        className={`bracket-team${team === 'Player 1' ? ' is-you' : ''}${winner ? (winner === team ? ' is-winner' : ' is-out') : ''
                          }`}
                      >
                        {team}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <div className="bracket-col" style={{ '--d': '0.54s' }}>
        <div className="bracket-stage">Champion</div>
        <div className="bracket-matches">
          <div className="bracket-match bracket-cup">🏆</div>
        </div>
      </div>
    </div>
  )
}

export function Ui({ screen, setScreen, mode, setMode, round, setRound }) {
  const [match, setMatch] = useState({ goals: 0, saves: 0, log: [] })
  const [outcome, setOutcome] = useState(null)
  const [intro, setIntro] = useState(null)
  const [paused, setPaused] = useState(false)
  // Final win: hold the trophy/confetti close-up before the champion overlay.
  const [celebrating, setCelebrating] = useState(false)
  const countsRef = useRef({ goals: 0, saves: 0, outcome: null, log: [] })
  const introTimer = useRef(null)
  const celebrateTimer = useRef(null)
  const inMatch = screen === 'match' && mode === 'tournament'

  // Entrance: hold the menu back until the stadium is actually on screen
  // (stadium:loaded = Suspense resolved) and the loader overlay has faded,
  // then let the existing ui-pop/ui-rise stagger play over the arriving stadium.
  const [entered, setEntered] = useState(false)
  const enterTimer = useRef(null)
  useStadiumEvent('stadium:loaded', () => {
    clearTimeout(enterTimer.current)
    // 750ms = the loader's fade-out; the menu stagger starts the moment the
    // overlay is gone, popping over the camera fly-in.
    enterTimer.current = setTimeout(() => setEntered(true), 20)
  })
  useEffect(() => () => clearTimeout(enterTimer.current), [])

  // nextMode is explicit because the menu buttons set mode and start the match
  // in the same click (the mode prop would still be stale here).
  const startMatch = (nextMode) => {
    setPaused(false)
    countsRef.current = { goals: 0, saves: 0, outcome: null, log: [] }
    setMatch({ goals: 0, saves: 0, log: [] })
    setIntro(
      nextMode === 'practice'
        ? { stage: 'Practice', vs: 'Free shootout' }
        : { stage: STAGES[round].label, vs: `Player 1 vs ${ROUNDS[round].name}` },
    )
    // Tell the jumbotron who's playing so its score panel resets + relabels.
    emitStadiumEvent('stadium:matchstart', {
      away: nextMode === 'practice' ? 'Red Blobs' : ROUNDS[round].name,
      homeColor: HUD_BLUE,
      awayColor: nextMode === 'practice' ? '#ff5a4d' : OPP_COLOR[round],
    })
    clearTimeout(introTimer.current)
    introTimer.current = setTimeout(() => setIntro(null), 2600)
    setScreen('match')
  }

  useEffect(() => () => clearTimeout(introTimer.current), [])

  const resolve = (isGoal) => {
    const c = countsRef.current
    if (!inMatch || c.outcome) return
    if (isGoal) c.goals += 1
    else c.saves += 1
    c.log = [...c.log, isGoal ? 'goal' : 'save']
    setMatch({ goals: c.goals, saves: c.saves, log: c.log })
    if (c.goals >= MATCH_GOALS_TO_WIN) c.outcome = 'win'
    else if (c.saves > MATCH_SHOTS - MATCH_GOALS_TO_WIN) c.outcome = 'lose'
  }

  useStadiumEvent('stadium:goal', () => resolve(true))
  useStadiumEvent('stadium:save', () => resolve(false))
  // Show the result once the ball resets, so the celebration/dejection plays out.
  useStadiumEvent('stadium:reset', () => {
    const c = countsRef.current
    if (inMatch && c.outcome) {
      const final = round >= ROUNDS.length - 1
      // Camera, player, trophy and confetti react to this before the overlay lands.
      emitStadiumEvent('stadium:matchend', { win: c.outcome === 'win', final })
      setOutcome(c.outcome)
      if (c.outcome === 'win' && final) {
        // Winning the final holds the trophy close-up (screen stays 'match',
        // camera on the cupWin shot, confetti + spinning trophy) before the
        // camera zooms out to the champion shot and the overlay fades in.
        setCelebrating(true)
        clearTimeout(celebrateTimer.current)
        celebrateTimer.current = setTimeout(() => {
          setCelebrating(false)
          setScreen('champion')
        }, 4600)
      } else setScreen('result')
    }
  })
  useEffect(() => () => clearTimeout(celebrateTimer.current), [])

  if (screen === 'match') {
    // Celebration hold: hide the HUD and block canvas input (transparent,
    // pointer-events like the full overlays) while the trophy beat plays.
    if (celebrating) return <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'auto' }} />
    return (
      <>
        {intro && (
          <div className="ui-roundintro">
            <em>{intro.stage}</em>
            {intro.vs}
          </div>
        )}
        {mode === 'tournament' && (
          <div className="ui-hud-panel">
            <div className="ui-hud-panel-head">
              <span className="ui-hud-stage-label">{STAGES[round].label}</span>
              <span className="ui-hud-lead">
                {match.goals === match.saves
                  ? 'All square'
                  : `${match.goals > match.saves ? 'Player 1' : ROUNDS[round].name} leads`}
              </span>
            </div>

            <div className="ui-hud-score-row">
              <div className="ui-hud-team ui-hud-team--you">
                <span className="ui-hud-team-icon">
                  <img src="/images/player1.png" alt="" />
                </span>
                <span className="ui-hud-team-name">Player 1</span>
                <span className="ui-hud-team-goals">{match.goals}</span>
              </div>
              <span className="ui-hud-vs">VS</span>
              <div className={`ui-hud-team ui-hud-team--opp ${OPP_THEME[round] || ''}`}>
                <span className="ui-hud-team-goals">{match.saves}</span>
                <span className="ui-hud-team-name">{ROUNDS[round].name}</span>
                <span className="ui-hud-team-icon">
                  <img src={OPP_ICON[round]} alt="" />
                </span>
              </div>
            </div>

            <div className="ui-hud-shots">
              <span className="ui-hud-shots-label">Shot</span>
              <div className="ui-hud-pills">
                {Array.from({ length: MATCH_SHOTS }, (_, i) => {
                  const result = match.log[i]
                  const taken = match.goals + match.saves
                  return (
                    <div
                      key={i}
                      className={`ui-pill${i === taken ? ' is-current' : ''}${result ? ` is-${result}` : ''}`}
                    >
                      <span className="ui-pill-num">{i + 1}</span>
                      <span className="ui-pill-mark">{result === 'goal' ? '✓' : result ? '✕' : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        <button type="button" className="ui-hud-menu" onClick={() => setPaused(true)}>
          <span className="ui-hud-menu-bars" aria-hidden="true" />
          Menu
        </button>
        {paused && (
          <div className="ui-overlay">
            <div className="ui-menu">
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                onClick={() => {
                  setPaused(false)
                  setScreen('menu')
                }}
              >
                Back to Main Menu
              </button>
              {mode === 'tournament' && (
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => {
                    setPaused(false)
                    setRound(0)
                    setScreen('bracket')
                  }}
                >
                  Restart Tournament
                </button>
              )}
              <button type="button" className="ui-btn" onClick={() => setPaused(false)}>
                Resume
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  // Boot: the loading overlay + camera fly-in own the screen until the entrance.
  if (!entered && screen === 'menu') return null

  return (
    // Champion: delay the fade/pops so the camera zoom-out plays first.
    <div className={`ui-overlay${screen === 'champion' ? ' ui-overlay--late' : ''}`}>
      {screen === 'menu' && (
        <>
          <div>
            <img className="ui-logo" src="/images/logo.webp" alt="Blob Cup" />
            <div className="ui-sub">Penalty Tournament</div>
          </div>
          <div className="ui-menu">
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={() => {
                setMode('tournament')
                setRound(0)
                setScreen('bracket')
              }}
            >
              <img className="ui-btn-icon" src="/images/trophy-icon.png" alt="" />
              Tournament
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                setMode('practice')
                startMatch('practice')
              }}
            >
              <img className="ui-btn-icon" src="/images/soccer-ball-icon.png" alt="" />
              Practice
            </button>
            <button type="button" className="ui-btn" onClick={() => setScreen('about')}>
              <img className="ui-btn-icon" src="/images/blob-icon.png" alt="" />
              About
            </button>
          </div>
          <div className="ui-foot">hold to charge · drag to curl</div>
        </>
      )}

      {screen === 'about' && (
        <>
          <div className="ui-title ui-title--small">ABOUT</div>
          <div className="ui-about">
            <p className="ui-about-lead">
              A webGL experiment by Matt Greenberg
            </p>

            <div className="ui-about-panel">
              <p className="ui-about-label">How to shoot</p>
              <ol className="ui-about-steps">
                <li><span><strong>Aim</strong> with the pointer.</span></li>
                <li><span><strong>Press and hold</strong> to lock aim and charge power.</span></li>
                <li><span><strong>Drag sideways</strong> to curl the shot.</span></li>
                <li><span><strong>Release</strong> to strike. Hit the gold zone for an unsaveable rocket.</span></li>
              </ol>
            </div>

            <div className="ui-about-panel ui-about-panel--rule">
              <p className="ui-about-label">Tournament</p>
              <p>
                Red Blobs, Green Blobs, then Bears. First to <strong>{MATCH_GOALS_TO_WIN}</strong> goals
                in <strong>{MATCH_SHOTS}</strong> shots takes the match.
              </p>
            </div>
          </div>
          <div className="ui-credit">
            <div className="ui-social">
              <a href="https://www.linkedin.com/in/mattcgreenberg/" target="_blank" rel="noreferrer" aria-label="LinkedIn">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                </svg>
              </a>
              <a href="https://x.com/McGreenBeats" target="_blank" rel="noreferrer" aria-label="X">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                  <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zm-1.29 19.5h2.04L6.48 3.24H4.29l13.32 17.4z" />
                </svg>
              </a>
            </div>
          </div>
          <button type="button" className="ui-btn" onClick={() => setScreen('menu')}>
            Back
          </button>
        </>
      )}

      {screen === 'bracket' && (
        <>
          <div className="ui-title ui-title--small">ROAD TO THE CUP</div>
          <Bracket round={round} />
          <div className="ui-next">
            {STAGES[round].label}: Player 1 vs {ROUNDS[round].name}
          </div>
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => startMatch('tournament')}>
            Kick Off ⚽
          </button>
        </>
      )}

      {screen === 'result' && (
        <>
          <div className={`ui-title ${outcome === 'win' ? 'ui-title--win' : 'ui-title--lose'}`}>
            {outcome === 'win' ? 'YOU ADVANCE!' : 'ELIMINATED'}
          </div>
          <div className="ui-scoreline">
            <span>Player 1</span>
            <strong>{match.goals}</strong>
            <i>—</i>
            <strong>{match.saves}</strong>
            <span>{ROUNDS[round].name}</span>
          </div>
          <div className="ui-menu">
            {outcome === 'win' ? (
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                onClick={() => {
                  if (round >= ROUNDS.length - 1) setScreen('champion')
                  else {
                    setRound(round + 1)
                    setScreen('bracket')
                  }
                }}
              >
                {round >= ROUNDS.length - 1 ? 'Lift the Cup 🏆' : 'Next Round →'}
              </button>
            ) : (
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => setScreen('bracket')}>
                Try Again
              </button>
            )}
            <button type="button" className="ui-btn" onClick={() => setScreen('menu')}>
              Menu
            </button>
          </div>
        </>
      )}

      {screen === 'champion' && (
        <>
          <div className="ui-cup">🏆</div>
          <div className="ui-title ui-title--win">CHAMPIONS!</div>
          <div className="ui-next">Player 1 wins the Blob Cup</div>
          <button type="button" className="ui-btn" onClick={() => setScreen('menu')}>
            Menu
          </button>
        </>
      )}
    </div>
  )
}
