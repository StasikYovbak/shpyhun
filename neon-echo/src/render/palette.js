/**
 * Власний фрагментний шейдер: кольорова LUT-палітра локації.
 * Тіні тонуються у бік кольору теми, світло злегка фарбується, насиченість
 * керована. Між рівнями палітра плавно перетікає (uMix 0..1).
 */
import { Filter, GlProgram, defaultFilterVert } from 'pixi.js';

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uGradeA;
uniform vec3 uGradeB;
uniform float uMix;
uniform float uSat;
uniform float uFlash;
uniform float uTint;

void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 grade = mix(uGradeA, uGradeB, clamp(uMix, 0.0, 1.0));
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 col = mix(vec3(lum), c.rgb, uSat);          // насиченість
  // Тонування тільки тіней і дуже помірно: раніше тут стояло 0.5 і 0.45,
  // через що весь кадр заливало однією пеленою кольору локації.
  col += grade * (1.0 - lum) * uTint;
  col *= vec3(1.0) + grade * uTint * 0.5;
  col += vec3(uFlash);                             // спалах (смерть боса / шкода)
  finalColor = vec4(clamp(col, 0.0, 1.0) * c.a, c.a);
}
`;

export class PaletteFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'palette-filter' }),
      resources: {
        paletteUniforms: {
          uGradeA: { value: new Float32Array([0.1, 0.02, 0.18]), type: 'vec3<f32>' },
          uGradeB: { value: new Float32Array([0.1, 0.02, 0.18]), type: 'vec3<f32>' },
          uMix: { value: 1, type: 'f32' },
          uSat: { value: 1.0, type: 'f32' },
          uFlash: { value: 0, type: 'f32' },
          uTint: { value: 0.18, type: 'f32' }
        }
      }
    });
  }
  get u() { return this.resources.paletteUniforms.uniforms; }
  /** Плавний перехід між палітрами двох локацій. */
  setGrade(from, to, mix) {
    const a = this.u.uGradeA, b = this.u.uGradeB;
    a[0] = from[0]; a[1] = from[1]; a[2] = from[2];
    b[0] = to[0]; b[1] = to[1]; b[2] = to[2];
    this.u.uMix = mix;
  }
  set flash(v) { this.u.uFlash = v; }
  set saturation(v) { this.u.uSat = v; }
  set tint(v) { this.u.uTint = v; }
}
