import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Post chain on the gameplay camera: Render -> Bloom (high tier) -> Grade -> Output (ACES + sRGB).
 * Grade: dusk split-toning (cool shadows / warm highlights), gentle contrast & saturation, vignette,
 * subtle grain, and combat pulses (chromatic split + radial push on parry/heavy hits).
 */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uShadowTint: { value: new THREE.Color(0.84, 0.95, 1.1) },
    uHighTint: { value: new THREE.Color(1.1, 0.99, 0.86) },
    uContrast: { value: 1.08 },
    uSaturation: { value: 1.0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.025 },
    uCA: { value: 0 },
    uRadial: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0.7, 0.9, 1.0) },
    uDanger: { value: 0 },
    uDesat: { value: 0 },
    uEnabled: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uContrast, uSaturation, uVignette, uGrain, uCA, uRadial, uFlash, uDanger, uDesat, uEnabled;
    uniform vec3 uShadowTint, uHighTint, uFlashColor; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5;
      vec3 col;
      if (uRadial > 0.001) {
        vec3 acc = vec3(0.0);
        for (int i=0;i<6;i++){ float k = float(i)/6.0 * uRadial * 0.06; acc += texture2D(tDiffuse, uv - c*k).rgb; }
        col = acc/6.0;
      } else col = texture2D(tDiffuse, uv).rgb;
      if (uCA > 0.001) {
        col.r = texture2D(tDiffuse, uv + c*uCA*0.012).r;
        col.b = texture2D(tDiffuse, uv - c*uCA*0.012).b;
      }
      if (uEnabled > 0.5) {
        float l = dot(col, vec3(0.2126,0.7152,0.0722));
        col *= mix(uShadowTint, uHighTint, smoothstep(0.05, 0.9, l));
        col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
        col = (col - 0.18) * uContrast + 0.18;
        col = max(col, 0.0);
        float v = smoothstep(0.85, 0.25, length(c*vec2(1.25,1.0)));
        col *= mix(1.0 - uVignette, 1.0, v);
        col = mix(col, col*vec3(1.25,0.55,0.5), uDanger * (1.0 - v) * 0.8);
        col += (h(uv*1000.0 + uTime) - 0.5) * uGrain * (0.4 + l);
      }
      col = mix(col, uFlashColor*1.6, uFlash * (1.0 - length(c)));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass | null = null;
  grade: ShaderPass;
  render: RenderPass;
  sanitize: ShaderPass;
  enabled = true;
  pulses = { ca: 0, radial: 0, flash: 0 };

  constructor(public renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: 'high' | 'low') {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camera);
    this.composer.addPass(this.render);
    // guard the HDR chain: a single NaN/Inf texel would otherwise smear across the separable bloom blur
    this.sanitize = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uMax: { value: 48 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv);
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = vec4(clamp(c.rgb, 0.0, uMax), 1.0); }`,
    });
    this.composer.addPass(this.sanitize);
    if (quality === 'high') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.55, 0.82);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  pulse(kind: 'parry' | 'heavy' | 'hurt') {
    if (kind === 'parry') {
      this.pulses.ca = 1.6;
      this.pulses.flash = 0.22;
      this.pulses.radial = 0.6;
      this.grade.uniforms.uFlashColor.value.setRGB(0.65, 0.9, 1.0);
    } else if (kind === 'heavy') {
      this.pulses.radial = 1.0;
      this.pulses.ca = 0.6;
    } else {
      this.pulses.ca = 0.9;
      this.pulses.flash = 0.12;
      this.grade.uniforms.uFlashColor.value.setRGB(1.0, 0.35, 0.3);
    }
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  update(dt: number, danger: number, desat: number, reduced: boolean) {
    const u = this.grade.uniforms;
    u.uTime.value += dt;
    const k = reduced ? 0.35 : 1;
    this.pulses.ca = Math.max(0, this.pulses.ca - dt * 6);
    this.pulses.radial = Math.max(0, this.pulses.radial - dt * 5);
    this.pulses.flash = Math.max(0, this.pulses.flash - dt * 2.2);
    u.uCA.value = this.pulses.ca * k;
    u.uRadial.value = this.pulses.radial * k;
    u.uFlash.value = this.pulses.flash * k;
    u.uDanger.value = danger;
    u.uDesat.value = desat;
    u.uEnabled.value = this.enabled ? 1 : 0;
    if (this.bloom) this.bloom.enabled = this.enabled;
  }

  renderFrame() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
    this.bloom?.dispose();
  }
}
