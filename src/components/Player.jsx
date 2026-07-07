import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { button, useControls } from 'leva'
import * as THREE from 'three'
import { PLAYER_KICK_Z, PLAYER_POS, PLAYER_RETURN_TIME, RUN_UP_TIME } from '../game/constants'
import { useStadiumEvent } from '../game/events'
import { makePlayerShadowTexture } from '../utils/textures'

const PLAYER_GOAL_YAW = Math.PI / 2
const PLAYER_CAMERA_YAW = -Math.PI / 2

// public/player.glb: rigged kicker with 'Kick' and 'Celebrate' clips. Model
// faces +X, so yaw +90deg points him down the lane at the tunnel (-z).
export function Player() {
  const { scene, animations } = useGLTF('/player.glb')
  const group = useRef(null)
  const [targetYaw, setTargetYaw] = useState(PLAYER_GOAL_YAW)
  const { actions, mixer } = useAnimations(animations, group)

  const play = (name, once) => {
    Object.values(actions).forEach((action) => action.fadeOut(0.15))
    const action = actions[name].reset().fadeIn(0.1).play()
    action.timeScale = 1
    if (once) action.setLoop(THREE.LoopOnce, 1)
    return action
  }

  const faceGoal = () => {
    setTargetYaw(PLAYER_GOAL_YAW)
  }

  const celebrate = () => {
    setTargetYaw(PLAYER_CAMERA_YAW)
    return play('Celebrate', true)
  }

  const { playerScale, shadowEnabled, shadowColor, shadowOpacity, shadowY, shadowScaleX, shadowScaleZ } =
    useControls('player', {
      playerScale: { value: 3.5, min: 0.5, max: 8, step: 0.1, label: 'scale' },
      shadowEnabled: { value: true, label: 'shadow' },
      shadowColor: { value: '#000000', label: 'shadow color' },
      shadowOpacity: { value: 0.9, min: 0, max: 1, step: 0.01, label: 'shadow opacity' },
      shadowY: { value: 0.1, min: -0.05, max: 0.2, step: 0.005, label: 'shadow y' },
      shadowScaleX: { value: 1.45, min: 0.1, max: 3, step: 0.05, label: 'shadow width' },
      shadowScaleZ: { value: 1.1, min: 0.1, max: 3, step: 0.05, label: 'shadow depth' },
      kick: button(() => {
        faceGoal()
        play('Kick', true)
      }),
      celebrate: button(celebrate),
      walk: button(() => {
        faceGoal()
        play('Walk')
      }),
      idle: button(() => {
        faceGoal()
        play('Idle')
      }),
    })

  // Run-up / walk-back: a single timed walk that ends in either the Kick
  // (run-up to the ball) or Idle (trotting back to the mark, facing camera).
  const walkRef = useRef(null)

  useLayoutEffect(() => {
    walkRef.current ??= { active: false, t: 0, fromZ: PLAYER_POS[2], toZ: PLAYER_KICK_Z, dur: RUN_UP_TIME, arrive: 'kick' }
  }, [])

  useLayoutEffect(() => {
    actions.Idle?.play()
    // A faded-out LoopOnce clip (e.g. Celebrate cut short by the walk-back)
    // still runs to its end and fires 'finished' — don't let it stomp an
    // active Walk with Idle.
    const onFinished = () => {
      if (!walkRef.current?.active) play('Idle')
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  })

  const startWalk = (toZ, dur, arrive, timeScale) => {
    const walk = walkRef.current
    if (!walk || !group.current) return
    play('Walk').timeScale = timeScale
    walk.active = true
    walk.t = 0
    walk.fromZ = group.current.position.z
    walk.toZ = toZ
    walk.dur = dur
    walk.arrive = arrive
  }

  useStadiumEvent('stadium:windup', () => {
    // Holding charges AND walks him up to the ball; he idles there if the
    // hold outlasts the approach.
    faceGoal()
    startWalk(PLAYER_KICK_Z, RUN_UP_TIME, 'idle', 1.6)
  })

  useStadiumEvent('stadium:kick', () => {
    const walk = walkRef.current
    faceGoal()
    if (walk?.active) walk.arrive = 'kick' // finish the approach, then strike
    else play('Kick', true)
  })

  useStadiumEvent('stadium:goal', celebrate)

  useStadiumEvent('stadium:reset', () => {
    setTargetYaw(PLAYER_CAMERA_YAW)
    startWalk(PLAYER_POS[2], PLAYER_RETURN_TIME, 'idle', 1.2)
  })

  useFrame((_, delta) => {
    const walk = walkRef.current
    if (walk?.active && group.current) {
      walk.t += delta
      const k = Math.min(walk.t / walk.dur, 1)
      group.current.position.z = THREE.MathUtils.lerp(walk.fromZ, walk.toZ, k)
      if (k >= 1) {
        walk.active = false
        if (walk.arrive === 'kick') {
          play('Kick', true)
        } else {
          faceGoal()
          play('Idle')
        }
      }
    }
    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, targetYaw, 7, delta)
    }
  })

  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (!object.isMesh) return
      const old = object.material
      object.material = new THREE.MeshPhysicalMaterial({
        map: old.map,
        color: old.color,
        roughness: 0.35,
        clearcoat: 1,
        clearcoatRoughness: 0.3,
      })
    })
  }, [scene])

  const shadowTex = useMemo(() => makePlayerShadowTexture(), [])

  return (
    <group ref={group} position={PLAYER_POS} rotation={[0, PLAYER_GOAL_YAW, 0]} scale={playerScale}>
      <primitive object={scene} />
      <mesh
        position={[0, shadowY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[shadowScaleX, shadowScaleZ, 1]}
        renderOrder={1}
        visible={shadowEnabled}
      >
        <planeGeometry />
        <meshBasicMaterial
          color={shadowColor}
          map={shadowTex}
          transparent
          opacity={shadowOpacity}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
