// Lighting/sky presets, selected by the round config's `weather` (game/constants.js).
export const WEATHER_OPTIONS = [
  {
    id: 'clear',
    skyStops: ['#05070f', '#0a1230', '#28405f', '#4a5f7a', '#c99a6a'],
    skyOpacity: 1,
    starOpacity: 1,
    hemisphere: ['#e9dcc9', '#77836e'],
    hemisphereIntensity: 0.32,
    ambientIntensity: 0.2,
    key: ['#ffd9a8', 2.4],
    fill: ['#9fb8d6', 0.65],
    ground: '#cdb59b',
  },
  {
    id: 'rain',
    skyStops: ['#080d18', '#15243a', '#30465a', '#526575', '#78858a'],
    skyOpacity: 1,
    starOpacity: 0.08,
    hemisphere: ['#b9c8d5', '#3b4d56'],
    hemisphereIntensity: 0.36,
    ambientIntensity: 0.26,
    key: ['#b9d7ef', 1.7],
    fill: ['#7899b9', 0.9],
    ground: '#6f7d86',
  },
  {
    id: 'snow',
    skyStops: ['#182331', '#34485a', '#63788a', '#9cadb8', '#d4c8b3'],
    skyOpacity: 1,
    starOpacity: 0.02,
    hemisphere: ['#e8eef1', '#71808a'],
    hemisphereIntensity: 0.48,
    ambientIntensity: 0.34,
    key: ['#eff7ff', 1.9],
    fill: ['#b7cce1', 0.85],
    ground: '#aebbc1',
  },
]

export const WEATHER_BY_ID = Object.fromEntries(WEATHER_OPTIONS.map((option) => [option.id, option]))
