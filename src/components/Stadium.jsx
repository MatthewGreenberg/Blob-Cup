import { useLayoutEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { STADIUM_POS } from '../game/constants'
import { Crowd } from './Crowd'
import { Flag } from './Flag'
import { Game } from './Game'
import { GoalNet } from './GoalNet'
import { Jumbotron } from './Jumbotron'
import { Player } from './Player'

export function Stadium() {
  const { scene } = useGLTF('/pinalty_stadium3.glb')

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
      <GoalNet />
      <Crowd />
      <Flag />
      <Player />
      <Game />
      <Jumbotron />
    </group>
  )
}
