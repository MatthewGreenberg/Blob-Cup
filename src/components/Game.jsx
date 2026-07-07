import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Trail, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import {
  AIM_HIT,
  BALL_R,
  BALL_START,
  CHARGE_TIME,
  FAN_SHADOW_Y_OFFSET,
  FIRE_POOL,
  FLIGHT_TIME_FAST,
  FLIGHT_TIME_SLOW,
  GOAL_HALF_W,
  GOAL_PLANE,
  GOAL_TOP,
  GOAL_Z,
  KEEPER_COMMIT_DEAD_ZONE,
  KEEPER_DIVE_X,
  KEEPER_REACH_X,
  KEEPER_REACH_Y,
  KEEPER_SHUFFLE_SPEED,
  KEEPER_SHUFFLE_X,
  KICK_CONTACT,
  PERFECT_MAX,
  PERFECT_MIN,
  RUN_UP_TIME,
  STADIUM_POS,
} from '../game/constants'
import { emitStadiumEvent } from '../game/events'
import { makeBallTexture, makeFanShadowTexture } from '../utils/textures'

// Penalty game: phase machine 'aim' -> 'charging' -> 'windup' -> 'flying' ->
// 'goal' | 'rebound' -> 'aim'. All motion runs in refs inside useFrame; React
// state only carries phase changes that affect mounted visuals.
export function Game() {
  const { scene } = useGLTF('/fan_blob.glb')
  const [phase, setPhase] = useState('aim')
  const [shotPower, setShotPower] = useState(1)
  const [perfect, setPerfect] = useState(false)
  const phaseRef = useRef(phase)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const ballRef = useRef(null)
  const keeperRef = useRef(null)
  const keeperMeshRef = useRef(null)
  const reticleRef = useRef(null)
  const shotRef = useRef(null)

  useLayoutEffect(() => {
    shotRef.current ??= {
      t: 0,
      from: BALL_START.clone(),
      aim: new THREE.Vector3(0, 2, GOAL_Z),
      arc: 1,
      power: 1,
      powerDir: 1,
      flightTime: FLIGHT_TIME_FAST,
      diveX: 0,
      diveP: 0,
      windupWait: KICK_CONTACT,
      keeperX: 0,
      perfect: false,
      saved: false,
      vel: new THREE.Vector3(),
    }
  }, [])

  const ballTex = useMemo(() => makeBallTexture(), [])
  const keeperGeo = scene.getObjectByName('FanBlob').geometry
  const keeperShadowTex = useMemo(() => makeFanShadowTexture(), [])

  const fireControls = useControls('ball fire trail', {
    enabled: { value: true },
    outerWidth: { value: 2.2, min: 0, max: 8, step: 0.05, label: 'outer width' },
    outerPowerWidth: { value: 2.8, min: 0, max: 8, step: 0.05, label: 'outer power width' },
    outerPerfectWidth: { value: 1.4, min: 0, max: 6, step: 0.05, label: 'outer perfect width' },
    outerLength: { value: 4, min: 0.5, max: 16, step: 0.1, label: 'outer length' },
    outerPowerLength: { value: 4, min: 0, max: 12, step: 0.1, label: 'outer power length' },
    outerPerfectLength: { value: 2, min: 0, max: 8, step: 0.1, label: 'outer perfect length' },
    outerDecay: { value: 2, min: 0.1, max: 8, step: 0.05, label: 'outer decay' },
    outerColor: { value: '#ff6b1a', label: 'outer color' },
    innerWidth: { value: 1, min: 0, max: 6, step: 0.05, label: 'inner width' },
    innerPowerWidth: { value: 1.4, min: 0, max: 6, step: 0.05, label: 'inner power width' },
    innerPerfectWidth: { value: 0.8, min: 0, max: 5, step: 0.05, label: 'inner perfect width' },
    innerLength: { value: 3, min: 0.5, max: 14, step: 0.1, label: 'inner length' },
    innerPowerLength: { value: 2.5, min: 0, max: 10, step: 0.1, label: 'inner power length' },
    innerDecay: { value: 2.6, min: 0.1, max: 8, step: 0.05, label: 'inner decay' },
    innerColor: { value: '#ffe45e', label: 'inner color' },
    perfectColor: { value: '#ffffff', label: 'perfect color' },
    attenuationPower: { value: 3, min: 0.5, max: 6, step: 0.1, label: 'attenuation power' },
    puffCount: { value: 2, min: 0, max: 8, step: 1, label: 'puffs' },
    puffPowerCount: { value: 1, min: 0, max: 6, step: 1, label: 'power puffs' },
    puffPerfectCount: { value: 1, min: 0, max: 8, step: 1, label: 'perfect puffs' },
    puffLife: { value: 0.3, min: 0.05, max: 1.5, step: 0.01, label: 'puff life' },
    puffLifeRandom: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'life random' },
    puffSize: { value: 0.28, min: 0, max: 1.5, step: 0.01, label: 'puff size' },
    puffSizeRandom: { value: 0.3, min: 0, max: 1.5, step: 0.01, label: 'size random' },
    puffPowerScale: { value: 0.75, min: 0, max: 2, step: 0.01, label: 'power scale' },
    puffPerfectScale: { value: 1.35, min: 0, max: 3, step: 0.01, label: 'perfect scale' },
    puffSpread: { value: 0.5, min: 0, max: 3, step: 0.05, label: 'spread' },
    puffVelocity: { value: 2.5, min: 0, max: 8, step: 0.05, label: 'side velocity' },
    puffLift: { value: 0.8, min: -2, max: 5, step: 0.05, label: 'lift' },
    puffLiftRandom: { value: 2, min: 0, max: 6, step: 0.05, label: 'lift random' },
    puffDriftZ: { value: 2.4, min: -8, max: 8, step: 0.05, label: 'z drift' },
    emissiveIntensity: { value: 1.1, min: 0, max: 5, step: 0.05, label: 'emissive' },
    perfectEmissiveIntensity: { value: 1.7, min: 0, max: 8, step: 0.05, label: 'perfect emissive' },
  })

  const fire = useMemo(() => {
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 10),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      FIRE_POOL,
    )
    mesh.frustumCulled = false
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    const dummy = new THREE.Object3D()
    dummy.scale.setScalar(0)
    dummy.updateMatrix()

    const color = new THREE.Color('#ffe45e')
    const puffs = []
    for (let i = 0; i < FIRE_POOL; i++) {
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, color)
      puffs.push({ age: 1e9, life: 1, size: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() })
    }

    const ramp = ['#fffbe9', '#ffe45e', '#ff8a1f', '#e04a2f'].map((value) => new THREE.Color(value))
    return { mesh, puffs, cursor: 0, dummy, color, ramp }
  }, [])

  const fireRef = useRef(null)

  useLayoutEffect(() => {
    fireRef.current = fire
  }, [fire])

  useLayoutEffect(() => keeperMeshRef.current?.updateMorphTargets(), [keeperGeo])

  const { gl } = useThree()

  useEffect(() => {
    const el = gl.domElement

    const onDown = (event) => {
      const shot = shotRef.current
      if (event.button !== 0 || !shot || phaseRef.current !== 'aim') return

      shot.power = 0.15
      shot.powerDir = 1
      shot.t = 0 // hold time doubles as the player's walk-up progress
      setPhase('charging')
      emitStadiumEvent('stadium:windup')
    }

    const onUp = () => {
      const shot = shotRef.current
      if (!shot || phaseRef.current !== 'charging' || !reticleRef.current) return

      const power = shot.power
      shot.aim.copy(reticleRef.current.position)
      shot.from.copy(BALL_START)
      shot.flightTime = THREE.MathUtils.lerp(FLIGHT_TIME_SLOW, FLIGHT_TIME_FAST, power)
      shot.arc = Math.max(0.35, 1.4 - shot.aim.y * 0.3) * THREE.MathUtils.lerp(1.5, 0.8, power)

      shot.perfect = power >= PERFECT_MIN && power <= PERFECT_MAX

      // 35% he reads your aim; otherwise he commits to his current lean, so
      // watching his shuffle and shooting the other way is the real skill.
      const zone =
        Math.random() < 0.35
          ? Math.abs(shot.aim.x) < KEEPER_REACH_X
            ? 0
            : Math.sign(shot.aim.x)
          : Math.abs(shot.keeperX) < KEEPER_COMMIT_DEAD_ZONE
            ? 0
            : Math.sign(shot.keeperX)

      shot.diveX = zone * KEEPER_DIVE_X
      const reachX = KEEPER_REACH_X * (1 + (1 - power) * 0.9)
      const reachY = KEEPER_REACH_Y + (1 - power) * 0.7
      shot.saved = !shot.perfect && Math.abs(shot.aim.x - shot.diveX) < reachX && shot.aim.y < reachY
      // Released mid-approach? The player finishes the walk before striking.
      shot.windupWait = Math.max(0, RUN_UP_TIME - shot.t) + KICK_CONTACT
      shot.t = 0
      setShotPower(power)
      setPerfect(shot.perfect)
      setPhase('windup')
      emitStadiumEvent('stadium:kick')
      if (shot.perfect) emitStadiumEvent('stadium:perfect')
    }

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [gl])

  useFrame((state, delta) => {
    const shot = shotRef.current
    const ball = ballRef.current
    const keeper = keeperRef.current
    const keeperMesh = keeperMeshRef.current
    const reticle = reticleRef.current
    if (!shot || !ball || !keeper || !keeperMesh) return

    const t = state.clock.elapsedTime
    shot.t += delta

    if ((phase === 'aim' || phase === 'charging') && reticle) {
      state.raycaster.setFromCamera(state.pointer, state.camera)
      if (state.raycaster.ray.intersectPlane(GOAL_PLANE, AIM_HIT)) {
        const aimX = THREE.MathUtils.clamp(AIM_HIT.x, -GOAL_HALF_W, GOAL_HALF_W)
        const aimY = THREE.MathUtils.clamp(AIM_HIT.y - STADIUM_POS[1], 0.6, GOAL_TOP)
        reticle.position.x = THREE.MathUtils.damp(reticle.position.x, aimX, 14, delta)
        reticle.position.y = THREE.MathUtils.damp(reticle.position.y, aimY, 14, delta)
      }
      reticle.scale.setScalar(1 + Math.sin(t * 5) * 0.12)
    }

    if (phase === 'charging') {
      shot.power += (shot.powerDir * delta) / CHARGE_TIME
      if (shot.power >= 1) {
        shot.power = 1
        shot.powerDir = -1
      } else if (shot.power <= 0.15) {
        shot.power = 0.15
        shot.powerDir = 1
      }

      emitStadiumEvent('stadium:power', shot.power)
      if (reticle) reticle.scale.setScalar(1 + shot.power * 0.5 + Math.sin(t * 12) * 0.06 * shot.power)
    }

    if (phase === 'windup' && shot.t >= shot.windupWait) {
      shot.t = 0
      setPhase('flying')
    }

    if (phase === 'flying') {
      const k = Math.min(shot.t / shot.flightTime, 1)
      ball.position.x = THREE.MathUtils.lerp(shot.from.x, shot.aim.x, k)
      ball.position.z = THREE.MathUtils.lerp(shot.from.z, GOAL_Z, k)
      ball.position.y = THREE.MathUtils.lerp(shot.from.y, shot.aim.y, k) + Math.sin(k * Math.PI) * shot.arc
      ball.rotation.x -= delta * 30

      if (k >= 1) {
        shot.t = 0
        if (shot.saved) {
          shot.vel.set(Math.sign(shot.aim.x - shot.diveX || 1) * 5, 6, 14).multiplyScalar(0.6 + shot.power * 0.7)
          setPhase('rebound')
          emitStadiumEvent('stadium:save')
        } else {
          shot.vel.set(
            ((shot.aim.x - shot.from.x) / shot.flightTime) * 0.35,
            1.5,
            ((GOAL_Z - shot.from.z) / shot.flightTime) * 0.35,
          )
          setPhase('goal')
          emitStadiumEvent('stadium:goal')
        }
      }
    }

    if (phase === 'goal' || phase === 'rebound') {
      shot.vel.y -= 26 * delta
      ball.position.addScaledVector(shot.vel, delta)
      ball.rotation.x -= delta * 14

      if (ball.position.y < BALL_R) {
        ball.position.y = BALL_R
        shot.vel.y *= -0.45
        shot.vel.x *= 0.75
        shot.vel.z *= 0.75
      }

      if (shot.t > (phase === 'goal' ? 2.4 : 1.6)) {
        shot.t = 0
        ball.position.copy(BALL_START)
        ball.rotation.set(0, 0, 0)
        setPhase('aim')
        emitStadiumEvent('stadium:reset')
      }
    }

    const activeFire = fireRef.current
    if (activeFire) {
      const loose = phase === 'goal' || phase === 'rebound'
      const blazing = fireControls.enabled && (phase === 'flying' || (loose && shot.vel.lengthSq() > 36))

      if (blazing) {
        const count = Math.min(
          FIRE_POOL,
          fireControls.puffCount +
            (shot.power > 0.6 ? fireControls.puffPowerCount : 0) +
            (shot.perfect ? fireControls.puffPerfectCount : 0),
        )
        for (let j = 0; j < count; j++) {
          const puff = activeFire.puffs[activeFire.cursor]
          activeFire.cursor = (activeFire.cursor + 1) % FIRE_POOL
          puff.age = 0
          puff.life = fireControls.puffLife + Math.random() * fireControls.puffLifeRandom
          puff.size =
            (fireControls.puffSize + Math.random() * fireControls.puffSizeRandom) *
            (0.55 + shot.power * fireControls.puffPowerScale) *
            (shot.perfect ? fireControls.puffPerfectScale : 1)
          puff.pos
            .copy(ball.position)
            .add(
              AIM_HIT.set(
                (Math.random() - 0.5) * fireControls.puffSpread,
                (Math.random() - 0.5) * fireControls.puffSpread,
                (Math.random() - 0.5) * fireControls.puffSpread,
              ),
            )
          puff.vel.set(
            (Math.random() - 0.5) * fireControls.puffVelocity,
            Math.random() * fireControls.puffLiftRandom + fireControls.puffLift,
            (Math.random() - 0.5) * fireControls.puffVelocity + fireControls.puffDriftZ,
          )
        }
      }

      for (let i = 0; i < FIRE_POOL; i++) {
        const puff = activeFire.puffs[i]
        puff.age += delta
        const k = puff.age / puff.life

        if (k >= 1) {
          activeFire.dummy.scale.setScalar(0)
        } else {
          puff.pos.addScaledVector(puff.vel, delta)
          activeFire.dummy.position.copy(puff.pos)
          activeFire.dummy.scale.setScalar(puff.size * (1 - k * k))
          const segment = Math.min(k * (activeFire.ramp.length - 1), activeFire.ramp.length - 1.001)
          activeFire.color.lerpColors(activeFire.ramp[segment | 0], activeFire.ramp[(segment | 0) + 1], segment % 1)
          activeFire.mesh.setColorAt(i, activeFire.color)
        }

        activeFire.dummy.updateMatrix()
        activeFire.mesh.setMatrixAt(i, activeFire.dummy.matrix)
      }

      activeFire.mesh.instanceMatrix.needsUpdate = true
      if (activeFire.mesh.instanceColor) activeFire.mesh.instanceColor.needsUpdate = true
    }

    const diving = phase === 'flying' || phase === 'goal' || phase === 'rebound'
    shot.diveP = THREE.MathUtils.damp(shot.diveP, diving ? 1 : 0, diving ? 10 : 5, delta)
    const progress = shot.diveP

    // Idle shuffle: the keeper patrols the line and leans into his movement —
    // the readable tell his commit dive follows.
    const shuffleX = Math.sin(t * KEEPER_SHUFFLE_SPEED) * KEEPER_SHUFFLE_X
    if (phase === 'aim' || phase === 'charging') shot.keeperX = shuffleX

    keeper.position.x = THREE.MathUtils.lerp(shuffleX, shot.diveX, progress)
    keeper.position.y = shot.diveX === 0 ? 0 : Math.sin(Math.min(progress, 1) * Math.PI) * 0.9
    keeper.rotation.z =
      -Math.sign(shot.diveX) * 1.05 * progress -
      Math.cos(t * KEEPER_SHUFFLE_SPEED) * 0.14 * (1 - progress)

    const bob = Math.sin(t * 3.1) * 0.035 * (1 - progress)
    const crouch = shot.diveX === 0 ? 1 - 0.3 * progress : 1
    keeperMesh.scale.set(1.54 * (1 - bob), 1.82 * (1 + bob) * crouch, 1.54 * (1 - bob))

    const influences = keeperMesh.morphTargetInfluences
    const dict = keeperMesh.morphTargetDictionary
    if (influences && dict) {
      const scoredOn = phase === 'goal'
      if (dict.MouthWide !== undefined) influences[dict.MouthWide] = scoredOn ? 0 : progress
      if (dict.MouthFrown !== undefined) influences[dict.MouthFrown] = scoredOn ? 1 : 0
      if (dict.MouthOpen !== undefined) {
        influences[dict.MouthOpen] = (0.1 + Math.sin(t * 2.6) * 0.08) * (1 - progress)
      }
    }
  })

  const inFlight = phase === 'flying' || phase === 'goal' || phase === 'rebound'

  return (
    <>
      {fireControls.enabled && inFlight && (
        <>
          <Trail
            width={fireControls.outerWidth + shotPower * fireControls.outerPowerWidth + (perfect ? fireControls.outerPerfectWidth : 0)}
            color={fireControls.outerColor}
            length={fireControls.outerLength + shotPower * fireControls.outerPowerLength + (perfect ? fireControls.outerPerfectLength : 0)}
            decay={fireControls.outerDecay}
            attenuation={(width) => Math.pow(width, fireControls.attenuationPower)}
            target={ballRef}
          />
          <Trail
            width={fireControls.innerWidth + shotPower * fireControls.innerPowerWidth + (perfect ? fireControls.innerPerfectWidth : 0)}
            color={perfect ? fireControls.perfectColor : fireControls.innerColor}
            length={fireControls.innerLength + shotPower * fireControls.innerPowerLength}
            decay={fireControls.innerDecay}
            attenuation={(width) => Math.pow(width, fireControls.attenuationPower)}
            target={ballRef}
          />
        </>
      )}

      <primitive object={fire.mesh} />

      <mesh ref={ballRef} position={BALL_START.toArray()}>
        <sphereGeometry args={[BALL_R, 24, 24]} />
        <meshPhysicalMaterial
          map={ballTex}
          roughness={0.3}
          clearcoat={1}
          clearcoatRoughness={0.25}
          emissive="#ff6b1a"
          emissiveIntensity={
            fireControls.enabled && inFlight
              ? perfect
                ? fireControls.perfectEmissiveIntensity
                : fireControls.emissiveIntensity
              : 0
          }
        />
      </mesh>

      <group ref={keeperRef} position={[0, 0, GOAL_Z]}>
        <mesh ref={keeperMeshRef} geometry={keeperGeo} scale={[1.54, 1.82, 1.54]}>
          <meshPhysicalMaterial
            vertexColors
            color="#3bdc6b"
            roughness={0.35}
            clearcoat={1}
            clearcoatRoughness={0.3}
          />
        </mesh>
        <mesh position={[0, FAN_SHADOW_Y_OFFSET, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={3.2} renderOrder={1}>
          <planeGeometry />
          <meshBasicMaterial
            color="#5c93d8"
            map={keeperShadowTex}
            transparent
            opacity={0.82}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      <group
        ref={reticleRef}
        position={[0, 2, GOAL_Z + 0.5]}
        visible={phase === 'aim' || phase === 'charging'}
        renderOrder={2}
      >
        <mesh renderOrder={2}>
          <ringGeometry args={[0.55, 0.8, 32]} />
          <meshBasicMaterial color="#ffe14d" toneMapped={false} transparent opacity={0.9} depthTest={false} />
        </mesh>
        <mesh renderOrder={2}>
          <circleGeometry args={[0.16, 16]} />
          <meshBasicMaterial color="#ffe14d" toneMapped={false} transparent opacity={0.9} depthTest={false} />
        </mesh>
      </group>
    </>
  )
}
