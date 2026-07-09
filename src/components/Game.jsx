import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Trail, useAnimations, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import {
  AIM_HIT,
  BALL_R,
  BALL_START,
  BEND_MAX,
  BEND_SCALE,
  CHARGE_TIME,
  FAN_SHADOW_Y_OFFSET,
  FIRE_POOL,
  FLIGHT_TIME_FAST,
  FLIGHT_TIME_SLOW,
  GOAL_HALF_W,
  GOAL_PLANE,
  GOAL_TOP,
  GOAL_Z,
  KEEPER_BEND_FOOL,
  KEEPER_BEND_GOOD,
  KEEPER_DIVE_X,
  KEEPER_SHADE,
  KEEPER_SHADE_MAX,
  KEEPER_Z,
  KICK_CONTACT,
  NET_BACK_Z,
  NET_HALF_W,
  netRoofY,
  PRACTICE_CFG,
  PERFECT_MAX,
  PERFECT_MIN,
  POWER_TRIES,
  RUN_UP_TIME,
  STADIUM_POS,
} from '../game/constants'
import { emitStadiumEvent } from '../game/events'
import { TUTORIAL } from '../game/tutorial'
import { makePlayerShadowTexture } from '../utils/textures'

// Keeper (goalie bear) resting scale.
const KEEPER_SX = 2.3
const KEEPER_SY = 2.7
// Blob keeper (tournament rounds 1-2) resting scale: the fan blob is ~1.5u
// tall, this puts him in the bear's height class.
const BLOB_SX = 3.0
const BLOB_SY = 3.3

// Curl preview: chunky glowing dots flowing along the exact flight path (same
// lerp+sin math as the flying phase) from the ball to the locked aim. Dots
// instead of a THREE.Line because line width is capped at 1px on most GPUs.
// Built at module scope so the useFrame matrix writes don't touch
// render-scoped values (same react-compiler immutability rule as GoalNet).
// Additive blending: per-instance color brightness doubles as per-dot opacity
// (InstancedMesh has no per-instance alpha), so the path can shimmer/fade.
const PREVIEW_N = 40
const previewDots = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 12, 12),
  new THREE.MeshBasicMaterial({
    color: '#ffffff',
    toneMapped: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // depthTest stays ON: the player must occlude the path start, otherwise
    // the dots draw over him and read as coming from behind.
  }),
  PREVIEW_N,
)
previewDots.frustumCulled = false
previewDots.renderOrder = 2
previewDots.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
const previewDummy = new THREE.Object3D()
// Scratch NDC for the pointerdown aim raycast (touch has no hover).
const POINTER_NDC = new THREE.Vector2()
const previewBase = new THREE.Color()
const previewColor = new THREE.Color()
for (let i = 0; i < PREVIEW_N; i++) previewDots.setColorAt(i, previewColor) // allocate instanceColor

// Penalty game: phase machine 'aim' -> 'charging' -> 'windup' -> 'flying' ->
// 'goal' | 'rebound' -> 'aim'. All motion runs in refs inside useFrame; React
// state only carries phase changes that affect mounted visuals.
export function Game({ cfg = PRACTICE_CFG }) {
  const { scene: keeperScene, animations: keeperClips } = useGLTF('/goalie.glb')
  const { scene: blobScene } = useGLTF('/fan_blob.glb')
  const [phase, setPhase] = useState('aim')
  const [shotPower, setShotPower] = useState(1)
  const [perfect, setPerfect] = useState(false)
  const phaseRef = useRef(phase)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const ballRef = useRef(null)
  const keeperRef = useRef(null)
  const reticleRef = useRef(null)
  const shotRef = useRef(null)

  // Keeper clips (baked in goalie.glb by src/goalie_anim_blender_script.py):
  // Idle loop, DiveL/DiveR/SaveCenter one-shots keyed to the commit direction,
  // then Cheer (save) or Dejected (goal) once the dive recovers.
  const { actions: keeperActions, mixer: keeperMixer } = useAnimations(keeperClips, keeperRef)
  // useFrame writes timeScale (tutorial freeze); mutating the hook's return
  // directly trips react-hooks/immutability, so it goes through a ref.
  const keeperMixerRef = useRef(null)
  useLayoutEffect(() => {
    keeperMixerRef.current = keeperMixer
  }, [keeperMixer])

  const playKeeper = (name, once) => {
    Object.values(keeperActions).forEach((action) => action.fadeOut(0.2))
    const action = keeperActions[name].reset().fadeIn(0.15).play()
    if (once) {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
    return action
  }

  useLayoutEffect(() => {
    keeperActions.Idle?.play()
    const onFinished = (event) => {
      const clip = event.action.getClip().name
      if (clip === 'Catch') return // clamped hug holds the ball until reset
      const reacting = clip === 'DiveL' || clip === 'DiveR' || clip === 'SaveCenter'
      const reaction = phaseRef.current === 'rebound' ? 'Cheer' : phaseRef.current === 'goal' ? 'Dejected' : 'Idle'
      playKeeper(reacting ? reaction : 'Idle', reacting && reaction !== 'Idle')
    }
    keeperMixer.addEventListener('finished', onFinished)
    return () => keeperMixer.removeEventListener('finished', onFinished)
  })

  useEffect(() => {
    // Dive starts in useFrame after shot.diveDelay (reaction beat), not here.
    if (phase === 'aim') {
      playKeeper('Idle')
    }
    // playKeeper identity is per-render; phase is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

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
      dove: false,
      diveDelay: 0,
      bend: 0,
      bendPingedL: false,
      bendPingedR: false,
      downX: 0,
      crossX: 0,
      windupWait: KICK_CONTACT,
      perfect: false,
      over: false,
      cycles: 0,
      saved: false,
      caught: false,
      netHit: false,
      vel: new THREE.Vector3(),
    }
  }, [])

  // Soccer-ball GLB, sized to BALL_R and given the player's glossy-plastic
  // sheen (keep map/color, roughness 0.35 + clearcoat). Emissive is kept on the
  // swapped materials so the in-flight fire glow still works; mats are driven by
  // the effect below.
  // soccer-ball.glb ships KTX2-compressed textures, so its loader needs a
  // basis transcoder (served from public/basis/) wired in.
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const raycaster = useThree((state) => state.raycaster)
  const ballScene = useGLTF('/soccer-ball.glb', true, true, (loader) => {
    loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(gl))
  }).scene
  const ballModel = useMemo(() => {
    const root = ballScene.clone(true)
    const mats = []
    root.traverse((o) => {
      if (!o.isMesh) return
      o.material = new THREE.MeshPhysicalMaterial({
        map: o.material.map,
        color: o.material.color,
        roughness: 0.35,
        clearcoat: 1,
        clearcoatRoughness: 0.3,
        emissive: new THREE.Color('#ff6b1a'),
        emissiveIntensity: 0,
      })
      mats.push(o.material)
    })
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    root.scale.setScalar((BALL_R * 2) / Math.max(size.x, size.y, size.z))
    root.position.copy(center.multiplyScalar(-root.scale.x))
    return { root, mats }
  }, [ballScene])

  const keeperShadowTex = useMemo(() => makePlayerShadowTexture(), [])
  const ballShadowRef = useRef(null)

  // Blob goalie for the early tournament rounds: one giant tinted fan blob.
  // No rig — dives are procedural in useFrame (the keeper group slides to
  // diveX; the blob leans/squashes on top). The bear stays mounted but hidden
  // so its animation bindings/mixer keep working untouched.
  const blobKeeper = useMemo(() => {
    const src = blobScene.getObjectByName('FanBlob')
    const mesh = new THREE.Mesh(
      src.geometry,
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.35,
        clearcoat: 1,
        clearcoatRoughness: 0.3,
      }),
    )
    mesh.scale.set(BLOB_SX, BLOB_SY, BLOB_SX)
    return mesh
  }, [blobScene])
  const blobRef = useRef(null)

  useLayoutEffect(() => {
    blobKeeper.material.color.set(cfg.tint || '#ffffff')
  }, [blobKeeper, cfg])

  // Same glossy plastic treatment as the player: keep map/color, add clearcoat.
  useLayoutEffect(() => {
    keeperScene.traverse((object) => {
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
  }, [keeperScene])

  const fireControls = useControls('ball fire trail', {
    enabled: { value: true },
    outerWidth: { value: 0.65, min: 0, max: 8, step: 0.05, label: 'outer width' },
    outerPowerWidth: { value: 0.35, min: 0, max: 8, step: 0.05, label: 'outer power width' },
    outerPerfectWidth: { value: 0.2, min: 0, max: 6, step: 0.05, label: 'outer perfect width' },
    outerLength: { value: 5, min: 0.5, max: 16, step: 0.1, label: 'outer length' },
    outerPowerLength: { value: 2.5, min: 0, max: 12, step: 0.1, label: 'outer power length' },
    outerPerfectLength: { value: 1.5, min: 0, max: 8, step: 0.1, label: 'outer perfect length' },
    outerDecay: { value: 1.5, min: 0.1, max: 8, step: 0.05, label: 'outer decay' },
    outerColor: { value: '#d67e4f', label: 'outer color' },
    innerWidth: { value: 0.2, min: 0, max: 6, step: 0.05, label: 'inner width' },
    innerPowerWidth: { value: 0.2, min: 0, max: 6, step: 0.05, label: 'inner power width' },
    innerPerfectWidth: { value: 0.12, min: 0, max: 5, step: 0.05, label: 'inner perfect width' },
    innerLength: { value: 2.4, min: 0.5, max: 14, step: 0.1, label: 'inner length' },
    innerPowerLength: { value: 2, min: 0, max: 10, step: 0.1, label: 'inner power length' },
    innerDecay: { value: 3.8, min: 0.1, max: 8, step: 0.05, label: 'inner decay' },
    innerColor: { value: '#ffe45e', label: 'inner color' },
    perfectColor: { value: '#ffffff', label: 'perfect color' },
    attenuationPower: { value: 2, min: 0.5, max: 6, step: 0.1, label: 'attenuation power' },
    puffCount: { value: 2, min: 0, max: 8, step: 1, label: 'puffs' },
    puffPowerCount: { value: 1, min: 0, max: 6, step: 1, label: 'power puffs' },
    puffPerfectCount: { value: 1, min: 0, max: 8, step: 1, label: 'perfect puffs' },
    puffLife: { value: 0.26, min: 0.05, max: 1.5, step: 0.01, label: 'puff life' },
    puffLifeRandom: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'life random' },
    puffSize: { value: 0.2, min: 0, max: 1.5, step: 0.01, label: 'puff size' },
    puffSizeRandom: { value: 0.18, min: 0, max: 1.5, step: 0.01, label: 'size random' },
    puffPowerScale: { value: 0.75, min: 0, max: 2, step: 0.01, label: 'power scale' },
    puffPerfectScale: { value: 1.35, min: 0, max: 3, step: 0.01, label: 'perfect scale' },
    puffSpread: { value: 1.15, min: 0, max: 3, step: 0.05, label: 'spread' },
    puffVelocity: { value: 0.9, min: 0, max: 8, step: 0.05, label: 'side velocity' },
    puffLift: { value: 0.35, min: -2, max: 5, step: 0.05, label: 'lift' },
    puffLiftRandom: { value: 0.9, min: 0, max: 6, step: 0.05, label: 'lift random' },
    puffDriftZ: { value: 3.2, min: -8, max: 8, step: 0.05, label: 'z drift' },
    emissiveIntensity: { value: 0.4, min: 0, max: 5, step: 0.05, label: 'emissive' },
    perfectEmissiveIntensity: { value: 1.2, min: 0, max: 8, step: 0.05, label: 'perfect emissive' },
  })

  const { scale: keeperScale } = useControls('keeper', {
    scale: { value: 1.9, min: 0.3, max: 3, step: 0.05, label: 'scale' },
  })

  const fire = useMemo(() => {
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 10),
      // Additive glow so overlapping puffs blend into flame instead of reading
      // as solid orange balls; depthWrite off keeps them from cutting the trail.
      // opacity < 1 keeps stacked puffs under the bloom threshold so the trail
      // stays a readable orange streak instead of a blown-out white smear.
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
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

    // Starts amber, not near-white: the additive stack near the ball is what
    // was tripping bloom into an illegible flare.
    const ramp = ['#ffe9b0', '#ffbe45', '#ff7a1f', '#b8371f'].map((value) => new THREE.Color(value))
    return { mesh, puffs, cursor: 0, dummy, color, ramp }
  }, [])

  const fireRef = useRef(null)

  useLayoutEffect(() => {
    fireRef.current = fire
  }, [fire])

  useEffect(() => {
    const el = gl.domElement

    const onDown = (event) => {
      const shot = shotRef.current
      if (event.button !== 0 || !shot || phaseRef.current !== 'aim' || !reticleRef.current) return

      shot.power = 0.15
      shot.powerDir = 1
      shot.cycles = 0
      shot.t = 0 // hold time doubles as the player's walk-up progress
      // Touch has no hover, so aim from the actual press point (same raycast
      // as the useFrame reticle follow) instead of wherever the reticle was
      // left; the reticle snaps there so the lock reads correctly.
      POINTER_NDC.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1,
      )
      raycaster.setFromCamera(POINTER_NDC, camera)
      if (raycaster.ray.intersectPlane(GOAL_PLANE, AIM_HIT)) {
        reticleRef.current.position.x = THREE.MathUtils.clamp(AIM_HIT.x, -GOAL_HALF_W, GOAL_HALF_W)
        reticleRef.current.position.y = THREE.MathUtils.clamp(AIM_HIT.y - STADIUM_POS[1], 0.6, GOAL_TOP)
      }
      // Press locks the aim; dragging sideways while charging draws the curl.
      shot.aim.copy(reticleRef.current.position)
      shot.bend = 0
      shot.bendPingedL = false
      shot.bendPingedR = false
      shot.downX = (event.clientX / window.innerWidth) * 2 - 1
      setPhase('charging')
      emitStadiumEvent('stadium:windup')
    }

    const onUp = () => {
      const shot = shotRef.current
      if (!shot || phaseRef.current !== 'charging') return

      // Tutorial bend step: reversing the drag direction makes accidental
      // lifts easy, and a release here would fire a weak kick right past the
      // lesson — cancel back to aim instead (reset walks the player back;
      // unfreeze first or the walk-back itself would be frozen).
      if (TUTORIAL.freeze) {
        TUTORIAL.freeze = false
        setPhase('aim')
        emitStadiumEvent('stadium:reset')
        return
      }

      const power = shot.power
      shot.from.copy(BALL_START)
      shot.flightTime = THREE.MathUtils.lerp(FLIGHT_TIME_SLOW, FLIGHT_TIME_FAST, power)
      shot.arc = Math.max(0.35, 1.4 - shot.aim.y * 0.3) * THREE.MathUtils.lerp(1.5, 0.8, power)

      shot.perfect = power >= (cfg.perfectMin ?? PERFECT_MIN) && power <= (cfg.perfectMax ?? PERFECT_MAX)
      // Overcharged past the gold band: the shot balloons over the bar — the
      // raised aim carries the ball above GOAL_TOP so it visibly sails over.
      shot.over = power > (cfg.perfectMax ?? PERFECT_MAX)
      if (shot.over) {
        shot.aim.y = GOAL_TOP + 2.4
        shot.arc = Math.max(0.35, 1.4 - shot.aim.y * 0.3) * THREE.MathUtils.lerp(1.5, 0.8, power)
      }

      // Where the ball actually crosses the keeper's plane (curl included).
      const kK = (KEEPER_Z + 0.9 - shot.from.z) / (GOAL_Z - shot.from.z)
      const sK = Math.sin(kK * Math.PI)
      shot.crossX = THREE.MathUtils.lerp(shot.from.x, shot.aim.x, kK) + shot.bend * sK
      const crossY = THREE.MathUtils.lerp(shot.from.y, shot.aim.y, kK) + sK * shot.arc

      // He reads the ball's TRUE crossing point, so mild bend never fools him.
      // Only the excess past KEEPER_BEND_GOOD (late curl he can't track) drags
      // his dive the wrong way, and raw pace blurs his read (noise ~ power²).
      // Beat him with a good bend, real power to a corner, the perfect band,
      // or the rare wild guess — everything else is a save.
      const read = Math.random() < cfg.keeper.readChance
      const excess = Math.max(0, Math.abs(shot.bend) - KEEPER_BEND_GOOD)
      const fool = -Math.sign(shot.bend) * excess * KEEPER_BEND_FOOL
      const noise = (Math.random() - 0.5) * power * power * 1.6
      const predicted = read
        ? shot.crossX + fool + noise
        : (Math.floor(Math.random() * 3) - 1) * KEEPER_DIVE_X
      shot.diveX = THREE.MathUtils.clamp(predicted, -KEEPER_DIVE_X, KEEPER_DIVE_X)

      const reachX = cfg.keeper.reachX + (1 - power) * 1.0
      const reachY = cfg.keeper.reachY + (1 - power) * 0.6
      shot.saved = !shot.perfect && !shot.over && Math.abs(shot.crossX - shot.diveX) < reachX && crossY < reachY
      shot.caught = shot.saved && Math.abs(shot.diveX) < 1 // central block: he hugs it
      // He dives a beat after contact — reacting to the ball, not the release.
      shot.dove = false
      shot.diveDelay = cfg.keeper.react + (1 - power) * 0.08
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
  }, [gl, camera, raycaster, cfg])

  useFrame((state, delta) => {
    const shot = shotRef.current
    const ball = ballRef.current
    const keeper = keeperRef.current
    const reticle = reticleRef.current
    if (!shot || !ball || !keeper) return

    const t = state.clock.elapsedTime
    // Tutorial freeze stops gameplay time: the hold clock (shot.t doubles as
    // the run-up/windup timer) and the keeper's animation hold still. Only
    // ever true during 'charging', so no flight math is affected.
    if (!TUTORIAL.freeze) shot.t += delta
    if (keeperMixerRef.current) keeperMixerRef.current.timeScale = TUTORIAL.freeze ? 0 : 1

    // Contact shadow tracks the ball on the ground, shrinking/fading with height.
    const bShadow = ballShadowRef.current
    if (bShadow) {
      bShadow.position.x = ball.position.x
      bShadow.position.z = ball.position.z
      const k = 1 / (1 + Math.max(0, ball.position.y - BALL_R) * 0.55)
      bShadow.scale.setScalar(BALL_R * 3 * (0.55 + 0.45 * k))
      bShadow.material.opacity = 0.55 * k
    }

    // Reticle follows the pointer only while aiming — pressing locks it, so
    // the charging drag is free to draw the curl instead.
    if (phase === 'aim' && reticle) {
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
      // Drag sideways from the press point to bend the shot.
      const bendTarget = THREE.MathUtils.clamp((state.pointer.x - shot.downX) * BEND_SCALE, -BEND_MAX, BEND_MAX)
      shot.bend = THREE.MathUtils.damp(shot.bend, bendTarget, 12, delta)
      // Tutorial hook: once per charge per direction, ping when the drag
      // crosses into keeper-beating bend territory (detail = ±1).
      if (!shot.bendPingedR && shot.bend >= KEEPER_BEND_GOOD) {
        shot.bendPingedR = true
        emitStadiumEvent('stadium:bend', 1)
      }
      if (!shot.bendPingedL && shot.bend <= -KEEPER_BEND_GOOD) {
        shot.bendPingedL = true
        emitStadiumEvent('stadium:bend', -1)
      }
      // Tutorial's bend step freezes the meter mid-charge so first-timers
      // learn the drag before the release pressure kicks in.
      if (!TUTORIAL.freeze) {
        shot.power +=
          (shot.powerDir * delta) / ((cfg.charge ?? CHARGE_TIME) * (TUTORIAL.slow ? 2 : 1))
        if (shot.power >= 1) {
          shot.power = 1
          shot.powerDir = -1
        } else if (shot.power <= 0.15) {
          shot.power = 0.15
          shot.powerDir = 1
          // Out of tries: auto-fire the soft shot. The synthetic pointerup
          // reuses onUp so the whole release path stays in one place.
          if (++shot.cycles >= POWER_TRIES) window.dispatchEvent(new Event('pointerup'))
        }
      }

      emitStadiumEvent('stadium:power', shot.power)
      if (reticle) reticle.scale.setScalar(1 + shot.power * 0.5 + Math.sin(t * 12) * 0.06 * shot.power)
    }

    // The drawn flight path: same math the flying phase runs, sampled along k,
    // breathing with the power ping-pong; frozen during the windup run-up.
    // Dots drift toward the goal (flow offset) and go white-hot in the
    // perfect band.
    if (phase === 'charging' || phase === 'windup') {
      const arc = Math.max(0.35, 1.4 - shot.aim.y * 0.3) * THREE.MathUtils.lerp(1.5, 0.8, shot.power)
      const flow = (t * 1.4) % 1
      previewBase.set(
        shot.power >= (cfg.perfectMin ?? PERFECT_MIN) && shot.power <= (cfg.perfectMax ?? PERFECT_MAX)
          ? '#ffffff'
          : '#ffe14d',
      )
      for (let i = 0; i < PREVIEW_N; i++) {
        // k starts past the ball so no dot spawns on/behind it.
        const k = 0.12 + (0.88 * (i + flow)) / PREVIEW_N
        const s = Math.sin(k * Math.PI)
        previewDummy.position.set(
          THREE.MathUtils.lerp(shot.from.x, shot.aim.x, k) + shot.bend * s,
          THREE.MathUtils.lerp(shot.from.y, shot.aim.y, k) + s * arc,
          THREE.MathUtils.lerp(shot.from.z, GOAL_Z, k),
        )
        previewDummy.scale.setScalar((0.065 + 0.035 * (1 - k)) * (0.8 + shot.power * 0.5))
        previewDummy.updateMatrix()
        previewDots.setMatrixAt(i, previewDummy.matrix)
        // Traveling shimmer that brightens toward the goal (dim = transparent
        // under additive blending).
        const glow = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(k * 14 - t * 7))) * (0.45 + 0.55 * k)
        previewDots.setColorAt(i, previewColor.copy(previewBase).multiplyScalar(glow))
      }
      previewDots.instanceMatrix.needsUpdate = true
      previewDots.instanceColor.needsUpdate = true
    }

    if (phase === 'windup' && shot.t >= shot.windupWait) {
      shot.t = 0
      shot.netHit = false
      setPhase('flying')
      // Foot-on-ball moment (stadium:kick fires at release, before contact).
      emitStadiumEvent('stadium:launch', shot.power)
    }

    if (phase === 'flying') {
      // Reaction beat: the dive anim fires shot.diveDelay into the flight.
      // diveX is continuous; small commits stay on his feet (center block).
      if (!shot.dove && shot.t >= shot.diveDelay) {
        shot.dove = true
        playKeeper(
          Math.abs(shot.diveX) < 1 ? (shot.saved ? 'Catch' : 'SaveCenter') : shot.diveX > 0 ? 'DiveR' : 'DiveL',
          true,
        )
      }
      // Saved shots resolve where the keeper stands, not on the goal line.
      const kEnd = shot.saved ? (KEEPER_Z + 0.9 - shot.from.z) / (GOAL_Z - shot.from.z) : 1
      const k = Math.min(shot.t / shot.flightTime, kEnd)
      ball.position.x = THREE.MathUtils.lerp(shot.from.x, shot.aim.x, k) + shot.bend * Math.sin(k * Math.PI)
      ball.position.z = THREE.MathUtils.lerp(shot.from.z, GOAL_Z, k)
      ball.position.y = THREE.MathUtils.lerp(shot.from.y, shot.aim.y, k) + Math.sin(k * Math.PI) * shot.arc
      ball.rotation.x -= delta * 30

      if (k >= kEnd) {
        shot.t = 0
        if (shot.saved) {
          if (shot.caught) shot.vel.set(0, 0, 0)
          else shot.vel.set(Math.sign(shot.crossX - shot.diveX || 1) * 5, 6, 14).multiplyScalar(0.6 + shot.power * 0.7)
          setPhase('rebound')
          emitStadiumEvent('stadium:save')
        } else if (shot.over) {
          // Sailed over the bar: keep carrying past the net (rebound phase
          // skips the net collision) and land behind the goal. Counts as a
          // missed shot — 'over' detail swaps the SAVED! banner for OVER!.
          shot.vel.set(
            ((shot.aim.x - shot.from.x) / shot.flightTime) * 0.35,
            2.2,
            ((GOAL_Z - shot.from.z) / shot.flightTime) * 0.6,
          )
          setPhase('rebound')
          emitStadiumEvent('stadium:save', 'over')
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
      if (shot.caught && phase === 'rebound') {
        // Caught: the ball nestles between the hugging paws.
        ball.position.x = THREE.MathUtils.damp(ball.position.x, keeper.position.x, 14, delta)
        ball.position.y = THREE.MathUtils.damp(ball.position.y, 2.3, 14, delta)
        ball.position.z = THREE.MathUtils.damp(ball.position.z, KEEPER_Z + 1.15, 14, delta)
      } else {
        shot.vel.y -= 26 * delta
        ball.position.addScaledVector(shot.vel, delta)
        // Roll with actual speed (ω = v/r, capped) so the ball stops spinning as it settles.
        ball.rotation.x -= delta * Math.min(shot.vel.length() / BALL_R, 24)

        if (ball.position.y < BALL_R) {
          ball.position.y = BALL_R
          shot.vel.y *= -0.45
          shot.vel.x *= 0.75
          shot.vel.z *= 0.75
        }

        // Scored balls catch in the net: clamp against the back sheet, the
        // sloped roof and the sides, bleed velocity, and ping GoalNet's ripple.
        if (phase === 'goal' && ball.position.z < GOAL_Z) {
          let hit = false
          if (ball.position.z < NET_BACK_Z + BALL_R) {
            ball.position.z = NET_BACK_Z + BALL_R
            shot.vel.z *= -0.2
            shot.vel.x *= 0.5
            hit = true
          }
          if (ball.position.y > netRoofY(ball.position.z) - BALL_R * 0.6) {
            ball.position.y = netRoofY(ball.position.z) - BALL_R * 0.6
            if (shot.vel.y > 0) shot.vel.y *= -0.25
            hit = true
          }
          if (Math.abs(ball.position.x) > NET_HALF_W - BALL_R) {
            ball.position.x = Math.sign(ball.position.x) * (NET_HALF_W - BALL_R)
            shot.vel.x *= -0.3
            hit = true
          }
          if (hit) {
            shot.vel.multiplyScalar(0.92) // cord drag
            if (!shot.netHit) {
              shot.netHit = true
              emitStadiumEvent('stadium:netHit', {
                x: ball.position.x,
                y: ball.position.y,
                z: ball.position.z,
                power: shot.power,
              })
            }
          }
        }
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

    const diving = (phase === 'flying' && shot.dove) || phase === 'goal' || phase === 'rebound'
    shot.diveP = THREE.MathUtils.damp(shot.diveP, diving ? 1 : 0, diving ? 10 : 5, delta)

    // He plants a step off his line, swivels to face your reticle and shades
    // toward your aim side — the "I see where you're aiming" tell (and it
    // squeezes the near post). Dives slide him from the shaded X to the
    // committed X.
    const shadeX = reticle
      ? THREE.MathUtils.clamp(reticle.position.x * KEEPER_SHADE, -KEEPER_SHADE_MAX, KEEPER_SHADE_MAX)
      : 0
    keeper.position.x = THREE.MathUtils.lerp(
      THREE.MathUtils.damp(keeper.position.x, shadeX, 3, delta),
      shot.diveX,
      shot.diveP,
    )
    const tracking = (phase === 'aim' || phase === 'charging' || phase === 'windup') && reticle
    // In flight he turns with the ball — paired with the reaction delay it
    // reads as watching the shot, not the mouse.
    const targetYaw = tracking
      ? (reticle.position.x - keeper.position.x) * 0.12
      : phase === 'flying'
        ? (ball.position.x - keeper.position.x) * 0.1
        : 0
    keeper.rotation.y = THREE.MathUtils.damp(keeper.rotation.y, targetYaw, 8, delta)

    // Blob keeper (no rig): idle bounce, then a topple-lean toward the dive
    // side and a squash on central blocks — the group's position.x slide above
    // carries him to diveX like the bear.
    const blob = blobRef.current
    if (blob) {
      const center = Math.abs(shot.diveX) < 1
      const lean = center ? 0 : -Math.sign(shot.diveX) * 0.9
      blob.rotation.z = THREE.MathUtils.damp(blob.rotation.z, lean * shot.diveP, 12, delta)
      const squash = 1 - shot.diveP * (center ? 0.3 : 0.12)
      const s = cfg.keeper.scale
      blob.scale.set(BLOB_SX * s * (1 + (1 - squash) * 0.8), BLOB_SY * s * squash, BLOB_SX * s)
      // Idle bounce parks during the tutorial freeze so the whole world stops.
      blob.position.y = TUTORIAL.freeze ? 0 : Math.abs(Math.sin(t * 3.2)) * 0.14 * (1 - shot.diveP)
    }
  })

  const inFlight = phase === 'flying' || phase === 'goal' || phase === 'rebound'

  useEffect(() => {
    const glow =
      fireControls.enabled && inFlight ? (perfect ? fireControls.perfectEmissiveIntensity : fireControls.emissiveIntensity) : 0
    ballModel.mats.forEach((m) => (m.emissiveIntensity = glow))
  }, [ballModel, inFlight, perfect, fireControls])

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

      <primitive object={previewDots} visible={phase === 'charging' || phase === 'windup'} />

      <group ref={ballRef} position={BALL_START.toArray()}>
        <primitive object={ballModel.root} />
      </group>

      <mesh
        ref={ballShadowRef}
        position={[BALL_START.x, FAN_SHADOW_Y_OFFSET, BALL_START.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={1}
      >
        <planeGeometry />
        <meshBasicMaterial
          color="#000000"
          map={keeperShadowTex}
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group ref={keeperRef} position={[0, 0, KEEPER_Z]}>
        {/* bear model's front is +X; yaw -90deg turns him to face +Z (the shooter) */}
        <primitive
          object={keeperScene}
          visible={cfg.goalie === 'bear'}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[
            KEEPER_SX * keeperScale * cfg.keeper.scale,
            KEEPER_SY * keeperScale * cfg.keeper.scale,
            KEEPER_SX * keeperScale * cfg.keeper.scale,
          ]}
        />
        {/* blob's face is on GLB +Z, already toward the shooter */}
        {cfg.goalie === 'blob' && <primitive ref={blobRef} object={blobKeeper} />}
        <mesh
          position={[0, FAN_SHADOW_Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[3.4, 2.6, 1]}
          renderOrder={1}
        >
          <planeGeometry />
          <meshBasicMaterial
            color="#000000"
            map={keeperShadowTex}
            transparent
            opacity={0.9}
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
