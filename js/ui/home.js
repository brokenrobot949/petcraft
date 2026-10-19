// Home tab: the homestead scene on a PixiJS canvas.
import { el } from './dom.js';

export const id = 'home';
export const label = 'Home';
export const icon = 'assets/ui/tab-home.png';
export const canvas = true;

let scene = null;
let visible = false;

export function mount(container, app) {
  const caption = el('div.home-caption.panel.small', {},
    el('p', {}, 'Meet the cast'),
    el('p.muted', {}, 'Your hero and the four starter pets. Your homestead grows here in later phases.'));
  container.append(caption);
  // PixiJS is large, so it loads only when Home is first shown.
  import('../render/homeScene.js')
    .then(({ createHomeScene }) => createHomeScene(container, app.game.data))
    .then((s) => {
      scene = s;
      container.append(caption); // keep the caption above the canvas
      if (visible) scene.start();
      else scene.stop();
    })
    .catch((err) => {
      console.error(err);
      caption.append(el('p', {}, 'The scene could not start on this device.'));
    });
}

export function show() {
  visible = true;
  scene?.start();
}

export function hide() {
  visible = false;
  scene?.stop();
}
