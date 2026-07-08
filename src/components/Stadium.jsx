import { useEffect, useLayoutEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { emitStadiumEvent } from '../game/events'
import { PRACTICE_CFG, STADIUM_POS } from '../game/constants'
import { Atmosphere } from './Atmosphere'
import { Crowd } from './Crowd'
import { Flag } from './Flag'
import { Game } from './Game'
import { GoalNet } from './GoalNet'
import { GoalSweep } from './GoalSweep'
import { Jumbotron } from './Jumbotron'
import { PitchTurf } from './PitchTurf'
import { Player } from './Player'

// ?slowload=N holds Suspense N extra seconds (default 4) so the WebGL loading
// scene can be previewed on a warm local server. ponytail: dev knob, not prod.
const SLOW = new URLSearchParams(window.location.search).get('slowload')
let slowDone = false
const slowGate =
  SLOW !== null
    ? new Promise((resolve) =>
        setTimeout(() => {
          slowDone = true
          resolve()
        }, (Number(SLOW) || 4) * 1000),
      )
    : null

export function Stadium({ cfg }) {
  const { scene } = useGLTF('/pinalty_stadium3.glb')
  if (slowGate && !slowDone) throw slowGate

  // The real "assets on screen" signal — CameraRig starts the entrance fly-in
  // and Ui reveals the menu off this, not off useProgress (which hits 100%
  // before Suspense resolves).
  useEffect(() => emitStadiumEvent('stadium:loaded'), [])

  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (!object.isMesh) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (!material) return
        material.toneMapped = false
        material.needsUpdate = true
      })
    })
  }, [scene])

  // Fixed offset instead of <Center bottom>: Center re-measures on children
  // changes and animated rigs can report unstable bounds.
  return (
    <group position={STADIUM_POS}>
      <primitive object={scene} />
      <PitchTurf showLogo={cfg !== PRACTICE_CFG} />
      <GoalNet />
      <GoalSweep />
      <Crowd />
      <Flag />
      <Player />
      <Game cfg={cfg} />
      <Jumbotron />
      <Atmosphere />
    </group>
  )
}
