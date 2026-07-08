// Shared mute state between the SoundToggle button and the game loop.
// Loops (bg/crowd) stay HTMLAudio — timing doesn't matter for beds.
// One-shots (kick/cheer) go through Web Audio: Safari's HTMLAudio.play() has
// 100-300ms latency + currentTime=0 stalls, buffer sources fire instantly.
const bg = new Audio('/audio/bg-loop.mp3')
bg.loop = true
bg.volume = 0.3
const crowd = new Audio('/audio/crowd-noise.mp3')
crowd.loop = true
crowd.volume = 0.2

const ctx = new AudioContext()
const buffers = {}
for (const name of ['kick', 'cheer']) {
  fetch(`/audio/${name}.mp3`)
    .then((r) => r.arrayBuffer())
    .then((b) => ctx.decodeAudioData(b))
    .then((buf) => { buffers[name] = buf })
    .catch(() => {})
}

let muted = false
let unlocked = false

export function unlockSound() {
  if (unlocked) return
  unlocked = true
  ctx.resume().catch(() => {})
  if (!muted) {
    bg.play().catch(() => {})
    crowd.play().catch(() => {})
  }
}

function playBuffer(name, volume, fade) {
  if (muted || !buffers[name]) return
  const src = ctx.createBufferSource()
  src.buffer = buffers[name]
  const gain = ctx.createGain()
  gain.gain.value = volume
  if (fade) {
    gain.gain.setValueAtTime(volume, ctx.currentTime + fade.start)
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade.start + fade.len)
  }
  src.connect(gain).connect(ctx.destination)
  src.start()
}

export function playKick() {
  playBuffer('kick', 1)
}

// cheer.mp3 is ~4.5s; fade the tail so it doesn't cut off abruptly.
export function playCheer() {
  playBuffer('cheer', 0.5, { start: 1.6, len: 1.8 })
}

// Flips mute; returns the new "on" state for the button.
export function toggleSound() {
  muted = !muted
  if (muted) {
    bg.pause()
    crowd.pause()
  } else if (unlocked) {
    bg.play().catch(() => {})
    crowd.play().catch(() => {})
  }
  return !muted
}
