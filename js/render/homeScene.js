// Home scene (PixiJS). Phase 0 placeholder: proves the vendored PixiJS loads, draws crisp pixel art
// at a whole-number scale, and pauses when hidden. The real homestead arrives in Phase 5.
import { Application, Assets, Container, Graphics, Sprite, TextureSource } from '../../lib/pixi.mjs';

TextureSource.defaultOptions.scaleMode = 'nearest';

const GRASS = 0x5a8a3c;
const GRASS_DARK = 0x4a7432;
const PATH = 0xc7a26b;

export async function createHomeScene(host) {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: GRASS,
    antialias: false,
    roundPixels: true,
    resolution: Math.min(window.devicePixelRatio || 1, 3),
    autoDensity: true,
  });
  host.append(app.canvas);

  const ground = new Graphics();
  const world = new Container();
  app.stage.addChild(ground, world);

  const texture = await Assets.load('assets/ui/tab-home.png');
  const hoe = new Sprite(texture);
  hoe.anchor.set(0.5, 1);
  world.addChild(hoe);

  function layout() {
    const w = app.screen.width;
    const h = app.screen.height;
    const scale = w >= 500 ? 4 : 3; // whole-number pixel scale only
    ground.clear();
    // Checker of grass tiles at the pixel scale, plus a dirt path down the middle.
    const tile = 16 * scale;
    for (let y = 0; y < h; y += tile) {
      for (let x = 0; x < w; x += tile) {
        if (((x / tile) + (y / tile)) % 2 === 0) ground.rect(x, y, tile, tile).fill(GRASS_DARK);
      }
    }
    ground.rect(Math.floor(w / 2 / tile) * tile, 0, tile, h).fill(PATH);
    hoe.scale.set(scale);
    hoe.position.set(Math.round(w / 2), Math.round(h * 0.45));
  }
  layout();
  app.renderer.on('resize', layout);

  let t = 0;
  app.ticker.add((ticker) => {
    t += ticker.deltaMS;
    // A small hop so it's obvious the scene is alive (and that pausing works).
    const hop = Math.max(0, Math.sin(t / 250)) * 6 * hoe.scale.y;
    hoe.position.y = Math.round(app.screen.height * 0.45 - hop);
  });

  return {
    start: () => app.start(),
    stop: () => app.stop(),
  };
}
