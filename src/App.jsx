import './App.css'
import './game/preloadAssets'
import { Hud } from './components/Hud'
import { Scene } from './components/Scene'

function App() {
  return (
    <main className="app-shell">
      <Scene />
      <Hud />
    </main>
  )
}

export default App
