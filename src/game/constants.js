import * as THREE from 'three'

// Layout mirrors src/stadium_blender_script.py (LANE_W=18, LANE_L=46, tiers at
// x=side*(12+2.4t), tier-top z=1.4+1.1t). Blender is Z-up and the GLB is
// exported Y-up, so a Blender (x, y, z) lands at three (x, z, -y).

// Penalty shootout: aim with the pointer, hold to charge power, release to
// shoot. The Kick clip winds up and freezes at the cocked pose while charging.
export const STADIUM_POS = [0, 0.3, 3.0]
// The GLB ships a real goal frame at blender y=12.82 -> GLB z=-12.82; the game
// plays on its line, not the tunnel mouth. The frame is built with posts ±4.8 /
// bar 3.9 then scaled ×1.415 in the Blender script, so in-scene the posts sit
// at ±~6.8 and the bar at ~4.0. Aim box hugs just inside that: ball center max
// ±6.1 (ball radius keeps it off the post), top 3.9 under the bar.
export const GOAL_Z = -12.82
export const GOAL_HALF_W = 6.1
export const GOAL_TOP = 3.9
export const BALL_R = 0.39
export const BALL_START = new THREE.Vector3(0.6, BALL_R, 17.9)
// Run-up: holding to charge also walks the player (Walk clip) from his mark
// at PLAYER_POS to PLAYER_KICK_Z over RUN_UP_TIME; releasing kicks — if he's
// still mid-approach he finishes the walk first, so the ball launches
// max(0, RUN_UP_TIME - holdTime) + KICK_CONTACT after release (KICK_CONTACT =
// foot-on-ball, frame 16 @ 24fps in the Kick clip). After each shot resolves
// he trots back to the mark.
export const PLAYER_POS = [0, 0, 24]
export const PLAYER_KICK_Z = 20
export const RUN_UP_TIME = 0.85
export const PLAYER_RETURN_TIME = 1.1
export const KICK_CONTACT = 0.66
export const CHARGE_TIME = 0.9
export const FLIGHT_TIME_SLOW = 1.1
export const FLIGHT_TIME_FAST = 0.5
export const KEEPER_DIVE_X = 4.6
// Base fingertip reach at full power; weak shots add up to +1.0 / +0.6.
export const KEEPER_REACH_X = 1.7
export const KEEPER_REACH_Y = 3.3
// Keeper stands a step off his line, swivels to face your reticle and shades
// a step toward your aim side while you charge (clamped so near-post stays
// honest); releasing in the gold band is a 'perfect' strike he can never save.
export const KEEPER_Z = GOAL_Z + 1.6
export const KEEPER_SHADE = 0.22
export const KEEPER_SHADE_MAX = 1.4
// Chance the keeper reads your locked aim instead of guessing a zone.
export const KEEPER_READ_CHANCE = 0.95
// Below this power EVERY keeper reads the true crossing point perfectly and
// the save is guaranteed — a lazy click never scores, even aimed at a corner.
// Rounds can raise the floor via keeper.safePower (the bear demands real pace).
export const KEEPER_WEAK_POWER = 0.45
// He reads the ball's true crossing point. Bend below BEND_GOOD is tracked
// cleanly; only the excess (a genuinely good bend, i.e. late curl) drags his
// dive the wrong way by excess * BEND_FOOL.
export const KEEPER_BEND_GOOD = 1.5
export const KEEPER_BEND_FOOL = 1.1
// Beat of reaction time after the ball is struck before he dives — he reacts
// to the ball, not your mouse release. Slow shots give him longer to read
// (delay = KEEPER_REACT + (1 - power) * 0.08).
export const KEEPER_REACT = 0.08
// Curl: press locks the aim, dragging sideways while charging bends the shot.
// bend = lateral flight offset peaking mid-flight (x += bend * sin(k*pi)).
export const BEND_MAX = 4
export const BEND_SCALE = 9
export const PERFECT_MIN = 0.87
export const PERFECT_MAX = 0.96
// The meter only ping-pongs this many full swings before auto-firing the soft
// shot; overshooting past the gold band balloons the ball over the bar.
export const POWER_TRIES = 2

// Tournament: three scripted rounds, keeper harder each time. Rounds 1-2 swap
// the bear for a giant tinted fan blob (procedural dive lean in Game); the
// final boss is the animated bear at max difficulty. Practice = current tuning.
// keeper: readChance/reachX/reachY/react override the KEEPER_* baselines,
// scale multiplies the keeper's resting size. charge/perfectMin/perfectMax
// override the power-bar tuning: later rounds ping-pong faster and shrink the
// gold zone (default to the CHARGE_TIME / PERFECT_* baselines when omitted).
// weather (clear → rain → snow) rides the round too: the tournament walks you
// from a calm night into a storm and then a freeze.
export const ROUNDS = [
  {
    name: 'Red Blobs',
    tint: '#ff5a4d',
    goalie: 'blob',
    weather: 'clear',
    keeper: { readChance: 0.55, reachX: 1.1, reachY: 2.7, react: 0.26, scale: 0.95, safePower: 0.45 },
    charge: 0.9,
    perfectMin: 0.87,
    perfectMax: 0.96,
  },
  {
    name: 'Green Blobs',
    tint: '#43d96b',
    goalie: 'blob',
    weather: 'rain',
    keeper: { readChance: 0.68, reachX: 1.28, reachY: 2.9, react: 0.2, scale: 1.05, safePower: 0.5 },
    charge: 0.8,
    perfectMin: 0.875,
    perfectMax: 0.95,
  },
  {
    // Final boss: near-perfect read, longest reach, fastest react, tightest gold
    // zone. safePower 0.62 = anything short of a genuinely strong kick is caught,
    // and bendGood 2.1 means only a REALLY good bend drags his dive — so he only
    // concedes to the perfect band, a powerful corner ball, or big bend + pace.
    name: 'Bears',
    tint: null,
    goalie: 'bear',
    weather: 'snow',
    // reachX stays under the corner gap (aim ±6.1 − dive clamp ±4.6 = 1.5) or a
    // full-power corner ball could never score.
    keeper: { readChance: 0.95, reachX: 1.35, reachY: 3.4, react: 0.1, scale: 1.1, safePower: 0.62, bendGood: 2.1 },
    charge: 0.72,
    perfectMin: 0.875,
    perfectMax: 0.95,
  },
]
export const MATCH_SHOTS = 5
export const MATCH_GOALS_TO_WIN = 3
// Practice = the easiest keeper (Red Blobs), so newcomers can score.
export const PRACTICE_CFG = {
  name: 'Practice',
  tint: '#ff5a4d',
  goalie: 'blob',
  weather: 'clear',
  keeper: { readChance: 0.55, reachX: 1.1, reachY: 2.7, react: 0.26, scale: 0.95, safePower: 0.45 },
}
export const FIRE_POOL = 56
export const FAN_SHADOW_Y_OFFSET = 0.06

// Goal net box: roof slopes from the crossbar down to a low back frame (real
// net silhouette). Shared by GoalNet (geometry) and Game (ball-vs-net collision).
export const NET_HALF_W = GOAL_HALF_W + 0.7 // reach the scaled post centers (±6.8)
export const NET_FRONT_Z = GOAL_Z - 0.12
export const NET_DEPTH = 3.0
export const NET_BACK_Z = NET_FRONT_Z - NET_DEPTH
export const NET_BACK_H = 2.0
// Net roof height at depth z (clamped lerp crossbar -> back frame).
export const netRoofY = (z) =>
  THREE.MathUtils.lerp(GOAL_TOP, NET_BACK_H, THREE.MathUtils.clamp((NET_FRONT_Z - z) / NET_DEPTH, 0, 1))

// World-space goal plane for pointer-ray aiming (local GOAL_Z + group z offset).
export const GOAL_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(GOAL_Z + STADIUM_POS[2]))
export const AIM_HIT = new THREE.Vector3()
