/**
 * Пули спрайтів: у циклі рендеру не має бути жодної алокації.
 * begin() скидає лічильник, get() віддає готовий спрайт, end() ховає зайві.
 */
import { Sprite, Container } from 'pixi.js';

export class SpritePool {
  constructor(parent, blend = 'normal') {
    this.parent = parent instanceof Container ? parent : new Container();
    this.items = [];
    this.n = 0;
    this.blend = blend;
  }
  begin() { this.n = 0; }
  get(texture) {
    let s = this.items[this.n];
    if (!s) {
      s = new Sprite(texture);
      s.blendMode = this.blend;
      this.items.push(s);
      this.parent.addChild(s);
    } else if (s.texture !== texture) {
      s.texture = texture;
    }
    this.n++;
    s.visible = true;
    s.alpha = 1; s.tint = 0xffffff; s.rotation = 0;
    s.anchor.set(0, 0);
    s.scale.set(1, 1);
    return s;
  }
  /** Прямокутник кольором — з білого пікселя 1x1, без Graphics. */
  rect(px, x, y, w, h, color, alpha = 1) {
    const s = this.get(px);
    s.x = x; s.y = y; s.width = w; s.height = h;
    s.tint = color; s.alpha = alpha;
    return s;
  }
  end() {
    for (let i = this.n; i < this.items.length; i++) this.items[i].visible = false;
  }
}
