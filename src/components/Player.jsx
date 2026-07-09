import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { button, useControls } from 'leva'
import * as THREE from 'three'
import { PLAYER_KICK_Z, PLAYER_POS, PLAYER_RETURN_TIME, RUN_UP_TIME } from '../game/constants'
import { useStadiumEvent } from '../game/events'
import { TUTORIAL } from '../game/tutorial'
import { makePlayerShadowTexture } from '../utils/textures'

const PLAYER_GOAL_YAW = Math.PI / 2
const PLAYER_CAMERA_YAW = -Math.PI / 2

// Mouth-morph targets live at module scope (Player is a singleton) so leva
// button closures created in render don't touch a ref (react-hooks/refs).
const EMOTION = { happy: 0, sad: 0 }
const setEmotion = (happy, sad) => {
  EMOTION.happy = happy
  EMOTION.sad = sad
}

// public/player.glb: rigged kicker with Kick/Celebrate/Idle/Walk/Run clips and
// MouthHappy/MouthSad morph targets. Model faces +X, so yaw +90deg points him
// down the lane at the tunnel (-z).
export function Player() {
  const { scene, animations } = useGLTF('/player.glb')
  const group = useRef(null)
  const [targetYaw, setTargetYaw] = useState(PLAYER_GOAL_YAW)
  const { actions, mixer } = useAnimations(animations, group)
  // useFrame writes timeScale (tutorial freeze); mutating the hook's return
  // directly trips react-hooks/immutability, so it goes through a ref.
  const mixerRef = useRef(null)
  useLayoutEffect(() => {
    mixerRef.current = mixer
  }, [mixer])

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

  // Mouth morphs: faceRef holds the skinned mesh + morph indices; useFrame
  // damps its morphTargetInfluences toward EMOTION (smooth emotion fades).
  const faceRef = useRef(null)
  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (faceRef.current || !object.isMesh || object.morphTargetDictionary?.MouthHappy === undefined) return
      faceRef.current = {
        mesh: object,
        happy: object.morphTargetDictionary.MouthHappy,
        sad: object.morphTargetDictionary.MouthSad,
      }
    })
  }, [scene])

  const celebrate = () => {
    setTargetYaw(PLAYER_CAMERA_YAW)
    setEmotion(1, 0)
    return play('Celebrate', true)
  }

  const { playerScale, shadowEnabled, shadowColor, shadowOpacity, shadowY, shadowScaleX, shadowScaleZ } =
    useControls('player', {
      playerScale: { value: 2.8, min: 0.5, max: 8, step: 0.1, label: 'scale' },
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
      run: button(() => {
        faceGoal()
        play('Run')
      }),
      idle: button(() => {
        faceGoal()
        play('Idle')
      }),
      happy: button(() => setEmotion(1, 0)),
      sad: button(() => setEmotion(0, 1)),
      neutral: button(() => setEmotion(0, 0)),
    })

  // Run-up / walk-back: a single timed walk that ends in either the Kick
  // (run-up to the ball) or Idle (trotting back to the mark, facing camera).
  const walkRef = useRef(null)

  useLayoutEffect(() => {
    walkRef.current ??= { active: false, t: 0, fromZ: PLAYER_POS[2], toZ: PLAYER_KICK_Z, dur: RUN_UP_TIME, arrive: 'kick', celebrating: false }
  }, [])

  useLayoutEffect(() => {
    actions.Idle?.play()
    // A faded-out LoopOnce clip (e.g. Celebrate cut short by the walk-back)
    // still runs to its end and fires 'finished' — don't let it stomp an
    // active Walk with Idle. While a match win is being celebrated, chain
    // Celebrate one-shots (reset+fadeIn smooths the loop point) instead.
    const onFinished = () => {
      const walk = walkRef.current
      if (walk?.celebrating) play('Celebrate', true)
      else if (!walk?.active) play('Idle')
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  })

  const startWalk = (toZ, dur, arrive, timeScale, clip = 'Walk') => {
    const walk = walkRef.current
    if (!walk || !group.current) return
    play(clip).timeScale = timeScale
    walk.active = true
    walk.t = 0
    walk.fromZ = group.current.position.z
    walk.toZ = toZ
    walk.dur = dur
    walk.arrive = arrive
  }

  useStadiumEvent('stadium:windup', () => {
    // Holding charges AND runs him up to the ball; he idles there if the
    // hold outlasts the approach. Run loop is 20f/24fps = 0.83s, ~one full
    // stride cycle over RUN_UP_TIME.
    faceGoal()
    startWalk(PLAYER_KICK_Z, RUN_UP_TIME, 'idle', 1, 'Run')
  })

  useStadiumEvent('stadium:kick', () => {
    const walk = walkRef.current
    faceGoal()
    if (walk?.active) walk.arrive = 'kick' // finish the approach, then strike
    else play('Kick', true)
  })

  useStadiumEvent('stadium:goal', celebrate)

  useStadiumEvent('stadium:save', () => setEmotion(0, 1))

  useStadiumEvent('stadium:reset', () => {
    if (walkRef.current?.celebrating) return // won the match — hold the party, no walk-back
    setEmotion(0, 0)
    setTargetYaw(PLAYER_CAMERA_YAW)
    startWalk(PLAYER_POS[2], PLAYER_RETURN_TIME, 'idle', 1.2)
  })

  // Match won: cancel any walk-back and celebrate at the camera until the
  // next match starts (onFinished re-chains the one-shot Celebrate clip).
  // Order-safe vs stadium:reset either way — the flag skips a later walk-back,
  // and cancelling walk.active kills an earlier one.
  useStadiumEvent('stadium:matchend', (event) => {
    const walk = walkRef.current
    if (!event.detail?.win || !walk) return
    walk.active = false
    walk.celebrating = true
    celebrate()
  })

  useStadiumEvent('stadium:matchstart', () => {
    const walk = walkRef.current
    if (!walk?.celebrating) return
    walk.celebrating = false
    // The win skipped the walk-back; snap to the mark while the camera is
    // away on the bracket/menu screens.
    if (group.current) group.current.position.z = PLAYER_POS[2]
    setEmotion(0, 0)
    faceGoal()
    play('Idle')
  })

  useFrame((state, delta) => {
    const face = faceRef.current
    if (face) {
      const influences = face.mesh.morphTargetInfluences
      influences[face.happy] = THREE.MathUtils.damp(influences[face.happy], EMOTION.happy, 6, delta)
      influences[face.sad] = THREE.MathUtils.damp(influences[face.sad], EMOTION.sad, 6, delta)
    }
    // Tutorial freeze: the run-up statues mid-stride (clip and translation
    // both hold) until the step is done — gameplay time is stopped.
    if (mixerRef.current) mixerRef.current.timeScale = TUTORIAL.freeze ? 0 : 1
    const walk = walkRef.current
    if (walk?.active && group.current && !TUTORIAL.freeze) {
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
      // Facing the goal, he leans his stance toward the pointer (screen-right
      // = world +X = yaw below PLAYER_GOAL_YAW) — telegraphs the aim side.
      const aimLean = targetYaw === PLAYER_GOAL_YAW ? -state.pointer.x * 0.22 : 0
      group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, targetYaw + aimLean, 7, delta)
    }
  })

  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (!object.isMesh) return
      const old = object.material
      const mat = new THREE.MeshPhysicalMaterial({
        map: old.map,
        color: old.color,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.3,
        sheen: 0.5,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color('#b9c4ff'),
      })
      // The GLB is one mesh/one texture (no material slots), so uniform
      // clearcoat plastic made him read as a Lego minifig. Split materials
      // per-fragment by basecolor instead: blue kit → matte fabric w/ sheen,
      // skin → soft semi-matte, hair/boots stay glossy toy plastic.
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_physical_fragment>',
          /* glsl */ `#include <lights_physical_fragment>
          {
            vec3 pc = diffuseColor.rgb;
            float lum = dot(pc, vec3(0.299, 0.587, 0.114));
            float cloth = smoothstep(0.03, 0.15, pc.b - max(pc.r, pc.g));
            float skin = (1.0 - cloth) * smoothstep(0.06, 0.2, pc.r - pc.b) * smoothstep(0.3, 0.48, lum);
            material.roughness = mix(material.roughness, 0.78, cloth);
            material.roughness = mix(material.roughness, 0.55, skin);
            material.clearcoat *= 1.0 - cloth * 0.92 - skin * 0.65;
            material.sheenColor *= cloth;
          }`,
        )
      }
      object.material = mat
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
