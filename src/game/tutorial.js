// First-visit tutorial state shared between the DOM <Tutorial /> and the
// Canvas components' useFrames. Module scope (like sound.js's muted flag) so
// Game/Player can read the freeze without prop drilling through the Canvas.
// freeze = true stops gameplay time: power meter, hold timer, player run-up
// and both actors' animation mixers all hold still until the step is done.
// slow = true halves the power ping-pong (release step only) so first-timers
// can read the meter before the real-speed pressure kicks in.
export const TUTORIAL = { freeze: false, slow: false }

const KEY = 'stadium:tutorial'
export const tutorialDone = () => localStorage.getItem(KEY) === 'done'
export const markTutorialDone = () => localStorage.setItem(KEY, 'done')
