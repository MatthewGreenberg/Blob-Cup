import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// Single shared KTX2 transcoder — three warns (and wastes memory) if multiple
// live at once. Both the soccer ball (Game) and trophy load KTX2 textures.
// detectSupport needs the renderer, so wire it once on first use.
let ktx2
export function wireKTX2(loader, gl) {
  ktx2 ??= new KTX2Loader().setTranscoderPath('/basis/').detectSupport(gl)
  loader.setKTX2Loader(ktx2)
}
