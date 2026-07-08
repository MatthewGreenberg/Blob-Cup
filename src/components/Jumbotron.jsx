import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStadiumEvent } from '../game/events'

// The jumbotron screen is baked into the GLB (Scoreboard_Screen). We park a
// plane exactly over that baked face (same spot the old reverse-shot RT plane
// used) and feed it a live CanvasTexture laid out like a real stadium big
// screen: a full-bleed brand advert filling the top-left, the BLOBS vs BEARS
// score panel on the top-right, and a red "NEXT UP" ticker bar along the
// bottom. The adverts cycle, sliding out to the left as the next slides in.
// Updates come from the same window stadium:* events the HUD listens to.
const S = 2.1
const W = 9.4 * S
const H = 3.0 * S
const POS = [0, 13.4, -32]
const TILT = 0.175

const CW = 1024
const CH = 328
const BAND = 30 // bottom ticker bar height
const BOARD_H = CH - BAND
const ADW = 624 // advert region width (top-left)
const SCX = ADW // score panel starts here
const SCW = CW - ADW

const CYCLE = 5.5 // seconds each advert holds
const TRANS = 0.8 // slide in/out duration

// 4 cycling adverts, each a full-bleed banner (public/images/*)
const ADS = [
  { name: 'BEAR BET', tag: 'PICK. CHEER. WIN (MAYBE)!', src: '/images/bear-bet.webp' },
  { name: 'BLOB-AWAY GLP-1', tag: 'FEEL LIGHTER. PLAY BRIGHTER!', src: '/images/blob-away.webp' },
  { name: 'BLOBCOIN', tag: 'STACK LITTLE WINS — TO THE MOONISH!', src: '/images/blobcoin.webp' },
  { name: 'YOUR AD HERE', tag: 'SPONSOR THE SILLIEST SHOWDOWN IN TOWN!', src: '/images/your-ad-here.webp' },
]
for (const ad of ADS) {
  ad.img = new Image()
  ad.img.src = ad.src
}

// scrolling fake-news ticker about the two teams
const NEWS = [
  'BLOBS striker fined for excessive jiggling during celebration',
  'BEARS keeper caught napping in net, insists it was "tactical hibernation"',
  'BLOBS unveil new formation: the 4-4-2 puddle',
  'BEARS coach demands honey be classified as a performance drink',
  'BLOBS fan swallowed by own scarf, remains in good spirits',
  'BEARS win coin toss, immediately eat the coin',
  'BLOBS medical staff report squad is 98% water, 2% vibes',
  'BEARS training camp relocated after bees filed a complaint',
  'BLOBS captain rolls onto pitch 20 minutes late, blames gravity',
  'BEARS defender sent off for hugging the referee too hard',
]
const NEWS_LINE = NEWS.join('     ●     ') + '     ●     '

// module scope like GoalNet's geometry: useFrame mutates these every frame and
// the react-compiler immutability rule rejects mutating useMemo results
const canvas = document.createElement('canvas')
canvas.width = CW
canvas.height = CH
const ctx = canvas.getContext('2d')
const TEX = new THREE.CanvasTexture(canvas)
TEX.colorSpace = THREE.SRGBColorSpace
TEX.anisotropy = 4

// 3px LED dot-grid tile overlaid on the whole board
const led = document.createElement('canvas')
led.width = led.height = 3
const lctx = led.getContext('2d')
lctx.fillStyle = 'rgba(0,0,0,0.28)'
lctx.fillRect(2, 0, 1, 3)
lctx.fillRect(0, 2, 3, 1)
const LED_PATTERN = ctx.createPattern(led, 'repeat')

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)
// overshoot ease for the goal banner pop
const backOut = (p) => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2)
const FLASH_DUR = 2.4 // must match flashLeft seed

// draw an image to cover x,y,w,h (crop to fill), shifted horizontally by dx
function drawCover(c, img, x, y, w, h, dx) {
  if (!img.complete || !img.naturalWidth) return
  const ir = img.naturalWidth / img.naturalHeight
  let dw, dh
  if (ir > w / h) { dh = h; dw = h * ir } else { dw = w; dh = w / ir }
  c.drawImage(img, x + dx + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

function draw(st, t) {
  // backdrop
  ctx.fillStyle = '#0e1524'
  ctx.fillRect(0, 0, CW, CH)

  // ── cycling advert, top-left ──
  const pos = t / CYCLE
  const idx = Math.floor(pos) % ADS.length
  const next = (idx + 1) % ADS.length
  const into = (pos % 1) * CYCLE
  let curDx = 0, nextDx = ADW, showNext = false
  if (into > CYCLE - TRANS) {
    const tp = ease((into - (CYCLE - TRANS)) / TRANS)
    curDx = -ADW * tp
    nextDx = ADW * (1 - tp)
    showNext = true
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, ADW, BOARD_H)
  ctx.clip()
  drawCover(ctx, ADS[idx].img, 0, 0, ADW, BOARD_H, curDx)
  if (showNext) drawCover(ctx, ADS[next].img, 0, 0, ADW, BOARD_H, nextDx)
  ctx.restore()

  // ── score panel, top-right: blue-vs-tinted split mirroring the HUD ──
  const mid = SCX + SCW / 2
  const half = SCW / 2
  const FOOT = 56 // clock/shots strip at the panel bottom
  const sh = BOARD_H - FOOT
  // team-colour halves
  ctx.fillStyle = st.homeColor
  ctx.fillRect(SCX, 0, half, sh)
  ctx.fillStyle = st.awayColor
  ctx.fillRect(mid, 0, half, sh)
  // darken the lower portion of each half so the big number reads
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(SCX, sh * 0.42, SCW, sh * 0.58)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // team names — shrink to fit each half so long names (GREEN BLOBS) don't clip
  const fitName = (text, cx) => {
    let px = 30
    ctx.font = `900 ${px}px Arial`
    while (ctx.measureText(text).width > half - 30 && px > 14) {
      px -= 1
      ctx.font = `900 ${px}px Arial`
    }
    ctx.fillText(text, cx, 46)
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  fitName(st.home, SCX + half / 2)
  fitName(st.away, mid + half / 2)
  // big scores
  ctx.font = '900 96px Arial'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(`${st.goals}`, SCX + half / 2, sh * 0.66)
  ctx.fillText(`${st.saves}`, mid + half / 2, sh * 0.66)
  // centre VS badge
  ctx.fillStyle = '#0b1a22'
  ctx.beginPath()
  ctx.arc(mid, sh / 2, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = '900 24px Arial'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText('VS', mid, sh / 2 + 1)

  // clock · shots · streak footer strip
  ctx.fillStyle = '#0b1a22'
  ctx.fillRect(SCX, sh, SCW, FOOT)
  const minute = Math.floor(t / 1.5) % 94
  const streak = st.streak >= 2 ? `  ·  🔥×${st.streak}` : ''
  ctx.font = '900 24px Arial'
  ctx.fillStyle = '#3ecf8e'
  ctx.fillText(`${minute}'  ·  SHOTS ${st.shots}${streak}`, SCX + SCW / 2, sh + FOOT / 2 + 1)

  // ── bottom ticker: scrolling fake-news marquee ──
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, BOARD_H, CW, BAND)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, BOARD_H, CW, BAND)
  ctx.clip()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#111111'
  ctx.font = '900 20px Arial'
  const lw = ctx.measureText(NEWS_LINE).width
  const my = BOARD_H + BAND / 2 + 1
  let mx = -((t * 90) % lw) // scroll left, wrap by one label width
  while (mx < CW) { ctx.fillText(NEWS_LINE, mx, my); mx += lw }
  ctx.restore()

  // event flash — designed takeover: bg fades in, a highlight bar sweeps
  // across, the word pops in with an overshoot and floats, then it all fades.
  if (st.flash && st.flashLeft > 0) {
    const p = Math.min(1, (FLASH_DUR - st.flashLeft) / FLASH_DUR) // 0→1
    const inA = Math.min(1, p / 0.06) // fast fade in
    const outA = Math.min(1, st.flashLeft / 0.35) // fade out at the tail
    const alpha = inA * outA
    ctx.save()
    // backdrop
    ctx.globalAlpha = alpha
    ctx.fillStyle = st.flash.bg
    ctx.fillRect(0, 0, CW, CH)
    // one-shot highlight sweep left→right behind the text
    const sweep = ease(Math.min(1, p / 0.55))
    const sx = -CW * 0.4 + sweep * CW * 1.4
    const grad = ctx.createLinearGradient(sx - 160, 0, sx + 160, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.28)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, CW, CH)
    // word: back-ease scale pop that settles, plus a gentle float
    const scale = 0.55 + 0.45 * backOut(Math.min(1, p / 0.34))
    const floatY = Math.sin(p * Math.PI * 3) * 5 * (1 - p)
    ctx.globalAlpha = alpha
    ctx.translate(CW / 2, CH / 2 + floatY)
    ctx.scale(scale, scale)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 118px Arial'
    ctx.fillStyle = st.flash.fg
    ctx.fillText(st.flash.text, 0, 0)
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // LED dot grid over everything — reads as a real big screen
  ctx.fillStyle = LED_PATTERN
  ctx.fillRect(0, 0, CW, CH)
}

export function Jumbotron() {
  const stRef = useRef(null)
  useLayoutEffect(() => {
    stRef.current = {
      goals: 0,
      saves: 0,
      shots: 0,
      streak: 0,
      flash: null,
      flashLeft: 0,
      home: 'PLAYER 1',
      homeColor: '#2f6fe0',
      away: 'BEARS',
      awayColor: '#b23636',
    }
  }, [])

  // Each match reseeds the score panel with the current matchup and zeroes it.
  useStadiumEvent('stadium:matchstart', (event) => {
    const st = stRef.current
    if (!st) return
    st.goals = 0
    st.saves = 0
    st.shots = 0
    st.streak = 0
    st.flash = null
    st.flashLeft = 0
    st.away = event.detail.away.toUpperCase()
    st.homeColor = event.detail.homeColor || '#2f6fe0'
    st.awayColor = event.detail.awayColor || '#b23636'
  })

  const flash = (text, bg, fg) => {
    const st = stRef.current
    if (!st) return
    st.flash = { text, bg, fg }
    st.flashLeft = FLASH_DUR
  }

  useStadiumEvent('stadium:kick', () => stRef.current && stRef.current.shots++)
  useStadiumEvent('stadium:goal', () => {
    const st = stRef.current
    if (!st) return
    st.goals++
    st.streak++
    flash('GOOOAL!', '#ffb800', '#20242e')
  })
  useStadiumEvent('stadium:save', () => {
    const st = stRef.current
    if (!st) return
    st.saves++
    st.streak = 0
    flash('SAVED!', '#1f7ae0', '#ffffff')
  })
  useStadiumEvent('stadium:perfect', () => flash('PERFECT!', '#ffffff', '#e0355c'))

  useFrame((state, delta) => {
    const st = stRef.current
    if (!st) return
    if (st.flashLeft > 0) st.flashLeft -= delta
    draw(st, state.clock.elapsedTime)
    TEX.needsUpdate = true
  })

  return (
    <mesh position={POS} rotation={[TILT, 0, 0]}>
      <planeGeometry args={[W, H]} />
      <meshBasicMaterial map={TEX} toneMapped={false} />
    </mesh>
  )
}
