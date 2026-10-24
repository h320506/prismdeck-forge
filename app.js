import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
// Icons are inline data trees (icons.data.js) — zero sub-imports at runtime,
// so no ad/privacy blocker can kill the page by blocking an icon module.
import { ICON_TREES } from "./icons.data.js";
const icons = ICON_TREES;
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const media = matchMedia("(prefers-reduced-motion: reduce)");
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
camera.position.set(0, 0, 20);
const inverse = new THREE.Matrix4();
const reliefLayers = { subject: [], effects: [], text: [] };
let renderer,
  root,
  uniforms,
  config,
  shadow,
  lastTime = 0,
  elapsed = 0;
let auto = false,
  flipped = false,
  dragging = false,
  finish = "pearl",
  zoom = 1,
  centerOffsetY = 0;

function setCenterOffset(offset = 0) {
  centerOffsetY = offset;
  if (root) {
    root.position.y = centerOffsetY;
  }
  if (shadow) {
    shadow.position.y = -0.48 + centerOffsetY;
  }
}
let targetX = -0.035,
  targetY = -0.15,
  userRotX = -0.035,
  userRotY = -0.15,
  gyroDeltaX = 0,
  gyroDeltaY = 0,
  lastPointer = { x: 0, y: 0 },
  noticeTimer;

let gyroEnabled = false,
  neutralBeta = null,
  neutralGamma = null,
  autoRecenter = false;

function toggleAutoRecenter(forceState) {
  autoRecenter = typeof forceState === "boolean" ? forceState : !autoRecenter;
  if (autoRecenter) {
    const base = flipped ? Math.PI : 0;
    userRotY = base;
    userRotX = -0.02;
    targetY = userRotY + gyroDeltaY;
    targetX = userRotX + gyroDeltaX;
  }
  return autoRecenter;
}

function onDeviceOrientation(e) {
  if (!gyroEnabled || dragging) return;
  if (e.beta === null || e.gamma === null) return;

  if (neutralBeta === null) {
    neutralBeta = e.beta;
    neutralGamma = e.gamma;
  }

  neutralBeta = neutralBeta * 0.992 + 50 * 0.008;

  const dGamma = THREE.MathUtils.clamp(e.gamma - (neutralGamma || 0), -35, 35);
  const dBeta = THREE.MathUtils.clamp(e.beta - neutralBeta, -30, 30);

  // 陀螺仪产生相对的叠加倾角，不覆盖用户滑动停留的基础角度
  gyroDeltaY = (dGamma / 35) * 0.38;
  gyroDeltaX = (dBeta / 30) * 0.26;

  targetY = userRotY + gyroDeltaY;
  targetX = userRotX + gyroDeltaX;
}

async function toggleGyro(forceState) {
  const next = typeof forceState === "boolean" ? forceState : !gyroEnabled;
  if (next) {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response !== "granted") {
          notice("未获得设备重力感应权限");
          return false;
        }
      } catch (err) {
        console.warn("DeviceOrientation permission error:", err);
      }
    }
    gyroEnabled = true;
    neutralBeta = null;
    neutralGamma = null;
    setAuto(false);
    window.addEventListener("deviceorientation", onDeviceOrientation, true);
  } else {
    gyroEnabled = false;
    window.removeEventListener("deviceorientation", onDeviceOrientation, true);
    gyroDeltaX = 0;
    gyroDeltaY = 0;
    targetX = userRotX;
    targetY = userRotY;
  }
  return gyroEnabled;
}

function resetPose() {
  setAuto(false);
  flipped = false;
  userRotX = -0.02;
  userRotY = 0;
  gyroDeltaX = 0;
  gyroDeltaY = 0;
  targetX = userRotX;
  targetY = userRotY;
  neutralBeta = null;
  neutralGamma = null;
  faceLabels();
}
const settings = [
  ["foil", "uFoil"],
  ["scale", "uScale"],
  ["depth", "uDepth"],
  ["diff", "uDiff"],
  ["fx-depth", "uFxDepth"],
  ["bg-depth", "uBgDepth"],
];
const vertex = `
varying vec2 vUv;
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const common = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uFoil, uScale, uDepth, uBgDepth, uFinish, uHasLine, uRelief, uSafeScale, uFxDepth, uHasFx, uFxGlow, uDiff;
uniform vec2 uFit, uSafeOffset;
uniform vec3 uView;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float inside(vec2 p) { return step(0.,p.x)*step(0.,p.y)*step(p.x,1.)*step(p.y,1.); }
vec2 parallax(vec2 uv, float depth) {
  return uv + uView.xy / max(abs(uView.z), .4) * depth * uDiff * .10;
}
vec3 spectrum(float phase) {
  return .66 + .25 * cos(6.28318 * (phase + vec3(0., .33, .67)));
}
// uFinish: 0 pearl, 1 silver, 2 original, 3 gold, 4 matte, 5 gloss, 6 brushed, 7 holo
float strength() {
  if (abs(uFinish - 2.0) < 0.05) return 0.; // original
  if (abs(uFinish - 4.0) < 0.05) return uFoil * 0.35; // matte
  if (abs(uFinish - 5.0) < 0.05) return uFoil * 1.35; // gloss
  if (abs(uFinish - 6.0) < 0.05) return uFoil * 1.15; // brushed
  if (abs(uFinish - 7.0) < 0.05) return uFoil * 1.50; // holo
  return uFoil;
}
vec3 film(vec2 uv) {
  float phase = uv.x * .85 + uv.y * .55 + uView.x * 1.5 - uView.y * .9;
  if (abs(uFinish - 3.0) < 0.05) {
    // 烫金 (gold foil)
    float hi = 0.5 + 0.5 * sin(phase * 6.28318);
    float glint = 0.5 + 0.5 * cos((phase + 0.25) * 6.28318);
    vec3 deep = vec3(.72, .50, .20);
    vec3 bright = vec3(1.00, .90, .60);
    return mix(deep, bright, hi * .7 + glint * .3);
  }
  if (abs(uFinish - 4.0) < 0.05) {
    // 磨砂 (matte paper)
    return vec3(0.96, 0.95, 0.92);
  }
  if (abs(uFinish - 5.0) < 0.05) {
    // 清漆 (gloss clearcoat)
    vec3 spec = vec3(1.0, 1.0, 1.0);
    vec3 edgePrism = spectrum(phase * 0.5);
    return mix(spec, edgePrism, 0.18);
  }
  if (abs(uFinish - 6.0) < 0.05) {
    // 拉丝 (brushed metal)
    float hair = 0.5 + 0.5 * sin(uv.y * 360.0 + uView.x * 10.0);
    return mix(vec3(0.82, 0.88, 0.94), vec3(1.0, 0.98, 0.95), hair * 0.4);
  }
  if (abs(uFinish - 7.0) < 0.05) {
    // 光栅 (holo grating)
    float gratingPhase = phase * 2.4 + sin(uv.x * 20.0 + uView.x * 3.0) * 0.25;
    return spectrum(gratingPhase);
  }
  vec3 color = spectrum(phase);
  return mix(color, vec3(dot(color,vec3(.2126,.7152,.0722))), step(.5,uFinish));
}
float sweep(vec2 uv) {
  if (abs(uFinish - 5.0) < 0.05) {
    return pow(.5+.5*sin((uv.x*.72+uv.y*.45+uView.x*1.2+uView.y*.6)*6.283), 28.);
  }
  if (abs(uFinish - 4.0) < 0.05) {
    return pow(.5+.5*sin((uv.x*.72+uv.y*.45+uView.x*1.2+uView.y*.6)*6.283), 3.5);
  }
  if (abs(uFinish - 6.0) < 0.05) {
    float baseSweep = pow(.5+.5*sin((uv.x*.3+uv.y*.9+uView.x*1.4)*6.283), 8.);
    float microHair = .5 + .5 * sin(uv.y * 500.0);
    return baseSweep * (0.65 + 0.35 * microHair);
  }
  if (abs(uFinish - 7.0) < 0.05) {
    float b1 = pow(.5+.5*sin((uv.x*.72+uv.y*.45+uView.x*1.2+uView.y*.6)*6.283), 8.);
    float b2 = pow(.5+.5*sin((uv.x*.72+uv.y*.45+uView.x*1.2+uView.y*.6 + 0.3)*6.283), 14.);
    return b1 + b2 * 0.7;
  }
  return pow(.5+.5*sin((uv.x*.72+uv.y*.45+uView.x*1.2+uView.y*.6)*6.283), 10.);
}
`;
const frontFragment =
  common +
  `
uniform sampler2D tSubject, tBackground, tBackgroundBlur, tText, tLine, tEffects;
void main() {
  vec2 uv = vUv;
  vec2 su = ((parallax(uv,uDepth)-.5)*uScale/uFit+.5)*uSafeScale+uSafeOffset;
  vec4 subject = texture2D(tSubject,clamp(su,0.,1.));
  subject.a *= inside(su)*(1.-uRelief);

  // A+B 双层背景景深模型: 优雅外扩出血位 (Bleed Overscan 约 5%~8%) + Layer B 高斯氛围底衬
  float bgBleed = clamp(abs(uBgDepth) * uDiff * 0.075, 0.025, 0.085);
  vec2 buA = (parallax(uv, uBgDepth) - 0.5) * (1.0 / (1.0 + bgBleed * 2.0)) + 0.5;
  vec2 buB = parallax(uv, uBgDepth * 0.70);

  // Layer B 连续镜像空间映射 (完全保留高斯模糊底衬，极限转角呈现深邃氛围，杜绝拉丝)
  vec2 mirBuB = abs(fract(buB * 0.5 + 0.25) * 2.0 - 1.0);
  vec3 colB = texture2D(tBackgroundBlur, mirBuB).rgb;

  // Layer A 真实原画采样与边缘平滑融解
  float edgeDist = min(min(buA.x, 1.0 - buA.x), min(buA.y, 1.0 - buA.y));
  float insideA = smoothstep(-0.015, 0.015, edgeDist);
  vec3 colA = texture2D(tBackground, clamp(buA, 0.001, 0.999)).rgb;

  // 平视时呈现饱满清晰原图，视差倾斜时由出血位与高斯底衬双重无缝托底
  vec3 bg = mix(colB * 0.88, colA, insideA);
  vec3 col = mix(bg, subject.rgb, subject.a);
  if (abs(uFinish - 3.0) < 0.05) col = col * vec3(1.02, .95, .78) + vec3(.05, .012, 0.0);
  if (abs(uFinish - 4.0) < 0.05) {
    vec2 pCell = floor(uv * vec2(600., 900.));
    col += (hash(pCell) - 0.5) * 0.035;
  }
  if (abs(uFinish - 6.0) < 0.05) col *= 0.98;
  vec3 foil = film(uv);
  float amount = strength();
  float band = sweep(uv);

  // 注：全息卡面特效已由独立 3D 浮空网格 (fxMesh) 承载渲染，可自由突破卡牌外边缘实现破框悬浮
  float luminance = dot(col,vec3(.2126,.7152,.0722));
  // Laminate changes with the card-local viewing direction; black print stays readable.
  float goldBoost = abs(uFinish - 3.0) < 0.05 ? 1.7 : 1.0;
  if (abs(uFinish - 7.0) < 0.05) goldBoost = 1.45;
  if (abs(uFinish - 5.0) < 0.05) goldBoost = 1.60;
  if (abs(uFinish - 4.0) < 0.05) goldBoost = 0.50;
  col *= 1. - amount * .21 * (1.-foil) * (.2 + band*.8);
  col += foil * amount * band * goldBoost * (.065 + .11*(1.-luminance));
  float edge = 1.-smoothstep(.015,.06,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
  col = mix(col,foil*.75+.21,edge*amount*(abs(uFinish - 3.0) < 0.05 ? .42 : .3));
  vec2 cell = floor(uv*vec2(480.,720.));
  float flake = step(.994,hash(cell))*pow(.5+.5*sin(hash(cell+8.)*30.+uView.x*20.+uTime*.6),10.);
  col += foil*flake*amount*.13;
  float line = (1.-smoothstep(.06,.25,texture2D(tLine,clamp(su,0.,1.)).r))*uHasLine;
  col += line*inside(su)*subject.a*band*amount*.055;
  vec4 text = texture2D(tText,uv);
  col = mix(col,text.rgb,text.a*(1.-uRelief));
  gl_FragColor = vec4(pow(clamp(col,0.,1.),vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;
const edgeFragment =
  common +
  `
void main() {
  vec3 col = mix(vec3(.66,.69,.67),film(vUv)*.6+.35,strength()*.7);
  gl_FragColor=vec4(pow(col,vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;
const backFragment =
  common +
  `
uniform sampler2D tBack;
void main() {
  vec2 uv=vec2(1.-vUv.x,vUv.y);
  vec4 art=texture2D(tBack,uv);
  vec3 col=vec3(.956,.961,.946);
  col*=1.-strength()*.12*(1.-film(vUv));
  col+=film(vUv)*sweep(vUv)*strength()*.055;
  col=mix(col,art.rgb,art.a);
  gl_FragColor=vec4(pow(clamp(col,0.,1.),vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;

const subjectFragment = common + `
uniform sampler2D tSubject;
void main() {
  vec4 art=texture2D(tSubject,vUv);
  if(art.a<.06)discard;
  vec2 px=1./vec2(1024.,1630.);
  float inner=min(min(texture2D(tSubject,vUv+vec2(px.x*2.,0.)).a,texture2D(tSubject,vUv-vec2(px.x*2.,0.)).a),min(texture2D(tSubject,vUv+vec2(0.,px.y*2.)).a,texture2D(tSubject,vUv-vec2(0.,px.y*2.)).a));
  vec3 col=art.rgb;
  col+=film(vUv)*sweep(vUv)*strength()*.10;
  col=mix(col,vec3(.86,.72,.40),(1.-inner)*.22);
  gl_FragColor=vec4(pow(clamp(col,0.,1.),vec3(2.2)),art.a);
  #include <colorspace_fragment>
}
`;
const effectsFragment = common + `
uniform sampler2D tEffects;
void main() {
  vec2 eu = parallax(vUv, uFxDepth);
  vec4 art = texture2D(tEffects, clamp(eu, 0.0, 1.0));
  float alpha = art.a * inside(eu);
  if (alpha < 0.015 || uHasFx < 0.5) discard;
  vec3 col = art.rgb;
  vec3 foil = film(eu);
  float amount = strength();
  float band = sweep(eu);

  // 动态全息闪耀与辉光 (随卡面转动爆发出棱镜闪斑与全息扫光)
  float fxGlint = pow(0.5 + 0.5 * sin((eu.x * 2.5 + eu.y * 3.5 + uView.x * 4.0 + uView.y * 2.0) * 6.283), 6.0);
  vec3 fxPrism = mix(art.rgb, foil, 0.35);
  vec3 fxGleam = fxPrism * (1.2 + fxGlint * 1.8 + amount * 0.8);
  vec3 glowCol = art.rgb + fxGleam * (0.35 + 0.65 * band);

  col = mix(art.rgb, glowCol, clamp(uFxGlow, 0.0, 1.0));
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), alpha);
  #include <colorspace_fragment>
}
`;
const textFragment = common + `
uniform sampler2D tText;
void main(){vec4 art=texture2D(tText,vUv);if(art.a<.02)discard;gl_FragColor=vec4(pow(art.rgb,vec3(2.2)),art.a);
  #include <colorspace_fragment>
}
`;

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
function backTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1536;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "#aeb5aa";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(56, 56, 912, 1424);
  ctx.strokeRect(72, 72, 880, 1392);
  ctx.textAlign = "center";
  ctx.fillStyle = "#50594e";
  ctx.font = "500 420px Atelier, Georgia, serif";
  ctx.fillText((config.title || "A").slice(0, 1), 512, 846);
  ctx.font = "24px Arial";
  ctx.fillStyle = "#737b70";
  ctx.fillText(config.collection || "PRISMDECK", 512, 245);
  ctx.font = '34px "Songti SC", serif';
  ctx.fillText(config.subtitle || config.title, 512, 1020);
  ctx.font = "18px Arial";
  ctx.fillText(config.edition || "ART STUDY", 512, 1337);
  ctx.beginPath();
  ctx.moveTo(460, 1113);
  ctx.lineTo(564, 1113);
  ctx.stroke();
  return canvasTexture(c);
}
function addShadow() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
  grad.addColorStop(0, "rgba(29,35,25,0.13)");
  grad.addColorStop(0.4, "rgba(29,35,25,0.055)");
  grad.addColorStop(1, "rgba(29,35,25,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(8.8, 11.8),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(c),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(0.28, -0.48, -0.5);
  scene.add(shadow);
}
// Render a lucide node tree (["svg", attrs, [children]]) into an svg element.
function renderIconNode(node) {
  const [tag, attrs = {}, children = []] = node;
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  for (const child of children) el.appendChild(renderIconNode(child));
  return el;
}
function refreshIcons() {
  const overrides = { "stroke-width": 1.5 };
  // icons.data.js is keyed in PascalCase (Play, RotateCcw, SlidersHorizontal …) while
  // the markup uses lucide's hyphenated names (play, rotate-ccw, sliders-horizontal).
  // Looking the raw attribute up never matched, so no icon ever rendered.
  const pascal = (name) =>
    name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  document.querySelectorAll("[data-lucide]").forEach((el) => {
    const name = el.getAttribute("data-lucide");
    const tree = icons[name] || icons[pascal(name)];
    if (!tree) return;
    const [tag, defaults = {}, children = []] = tree;
    const svg = renderIconNode([tag, { ...defaults, ...overrides }, children]);
    el.replaceChildren(svg);
  });
}
function notice(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  clearTimeout(noticeTimer);
  const n = $("notice");
  if (!n) return;
  n.textContent = message;
  n.hidden = false;
  noticeTimer = setTimeout(() => (n.hidden = true), 2600);
}
async function init() {
  refreshIcons();
  const response = await fetch("./card-config.json");
  if (!response.ok) throw Error("作品配置未找到");
  config = await response.json();
  document.title = config.title + " · 全息卡牌";
  for (const [id, key] of [
    ["card-title", "title"],
    ["subtitle", "subtitle"],
    ["description", "description"],
    ["edition", "edition"],
    ["about-description", "description"],
    ["about-edition", "edition"],
  ])
    $(id).textContent = config[key] || "";
  $("about-title").textContent = [config.subtitle, config.title]
    .filter(Boolean)
    .join(" / ");
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        document.fonts.load("500 42px Atelier"),
        new Promise((resolve) => setTimeout(resolve, 1200))
      ]);
    }
  } catch (fontErr) {
    console.warn("Font pre-load skipped:", fontErr);
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "default",
        failIfMajorPerformanceCaveat: false,
      });
    } catch (retryError) {
      fallback3D(retryError);
      return;
    }
  }
  renderer.setClearColor(config.appearance?.background || "#fafafa", 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  stage.append(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");

  const textureLoader = new THREE.TextureLoader();
  // 彻底解除 Three.js 默认 crossOrigin = "anonymous" 对本地同源资源的 CORS 缓存锁死
  textureLoader.crossOrigin = undefined;

  const loadTextureSafe = async (url) => {
    if (!url) {
      const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      t.needsUpdate = true;
      return t;
    }
    try {
      return await textureLoader.loadAsync(url);
    } catch (e) {
      console.warn("Texture load failed, retrying with cache-buster:", url, e);
      const buster = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
      return await textureLoader.loadAsync(buster);
    }
  };

  const textures = await Promise.all(
    ["subject", "background", "text"].map((name) =>
      loadTextureSafe(config.assets[name]),
    ),
  );
  const line = config.assets.lineart
    ? await loadTextureSafe(config.assets.lineart)
    : new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  line.needsUpdate = true;

  const hasFx = !!config.assets.effects;
  const effects = hasFx
    ? await loadTextureSafe(config.assets.effects)
    : new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  effects.colorSpace = THREE.NoColorSpace;
  if (!hasFx) effects.needsUpdate = true;
  const back = config.assets.back
    ? await loadTextureSafe(config.assets.back)
    : backTexture();
  back.colorSpace = THREE.NoColorSpace;
  [...textures, line, effects, back].forEach((t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  });
  // 背景纹理开启镜像包裹，彻底从底层根除大倾角下的单像素边缘拉丝
  textures[1].wrapS = THREE.MirroredRepeatWrapping;
  textures[1].wrapT = THREE.MirroredRepeatWrapping;
  textures[1].needsUpdate = true;

  // 构建 Layer B 超画幅高斯氛围底衬纹理 (常驻底层，防拉丝氛围光影)
  const blurCanvas = document.createElement("canvas");
  blurCanvas.width = 512;
  blurCanvas.height = 768;
  const bCtx = blurCanvas.getContext("2d");
  if (textures[1]?.image) {
    bCtx.filter = "blur(24px) saturate(135%)";
    bCtx.drawImage(textures[1].image, -40, -60, 512 + 80, 768 + 120);
  } else {
    bCtx.fillStyle = "#141615";
    bCtx.fillRect(0, 0, 512, 768);
  }
  const bgBlurTex = new THREE.CanvasTexture(blurCanvas);
  bgBlurTex.colorSpace = THREE.NoColorSpace;
  bgBlurTex.wrapS = THREE.MirroredRepeatWrapping;
  bgBlurTex.wrapT = THREE.MirroredRepeatWrapping;
  bgBlurTex.needsUpdate = true;

  const p = config.parameters || {};
  const sW = textures[0]?.image?.width || 1024;
  const sH = textures[0]?.image?.height || 1536;
  const imageAspect = sW / sH;
  const fit =
    config.artworkFit ||
    (config.sourceMode === "reference"
      ? [
          Math.min(0.87, (0.87 * imageAspect) / (2 / 3)),
          Math.min(0.87, (0.87 * (2 / 3)) / imageAspect),
        ]
      : [1, 1]);
  uniforms = {
    tSubject: { value: textures[0] },
    tBackground: { value: textures[1] },
    tBackgroundBlur: { value: bgBlurTex },
    tText: { value: textures[2] },
    tLine: { value: line },
    tEffects: { value: effects },
    tBack: { value: back },
    uTime: { value: 0 },
    uView: { value: new THREE.Vector3(0, 0, 1) },
    uFit: { value: new THREE.Vector2(1, 1) },
    uFoil: { value: p.foil ?? 0.52 },
    uScale: { value: 1.0 },
    uDepth: { value: p.subjectDepth ?? 0.32 },
    uBgDepth: { value: p.backgroundDepth ?? -0.18 },
    uDiff: { value: p.diff ?? 1.0 },
    uSafeScale: { value: 1.0 },
    uSafeOffset: { value: new THREE.Vector2(0, 0) },
    uFxDepth: { value: p.effectsDepth ?? 0.14 },
    uHasFx: { value: hasFx ? 1 : 0 },
    uFxGlow: { value: p.fxGlow ?? 0.5 },
    uFinish: { value: 0 },
    uHasLine: { value: config.assets.lineart ? 1 : 0 },
    uRelief: { value: config.sourceMode === "relief" ? 1 : 0 },
  };
  const material = (fragment) =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.FrontSide,
    });
  const materials = {
    web_front: material(frontFragment),
    web_back: material(backFragment),
    web_edge: material(edgeFragment),
    web_gold: new THREE.MeshBasicMaterial({ color: "#c9a24a" }),
  };
  for (const [role,fragment] of [["web_subject",subjectFragment],["web_effects",effectsFragment],["web_text",textFragment]]) {
    materials[role] = material(fragment);
    materials[role].transparent = true;
    materials[role].depthWrite = role !== "web_effects";
  }
  const gltf = await new GLTFLoader().loadAsync(config.assets.model);
  root = new THREE.Group();
  root.add(gltf.scene);
  scene.add(root);
  let faces = 0;
  gltf.scene.traverse((ob) => {
    if (!ob.isMesh) return;
    const role = ob.material?.name;
    if (role === "web_text" && config.sourceMode !== "relief") {
      ob.visible = false;
      return;
    }
    if (role === "web_front") faces++;
    ob.material = materials[role] || materials.web_edge;
    if (role === "web_subject") reliefLayers.subject.push(ob);
    if (role === "web_effects") reliefLayers.effects.push(ob);
    if (role === "web_text") reliefLayers.text.push(ob);
  });
  if (!faces) throw Error("卡片模型缺少正面材质");
  root.updateMatrixWorld(true);
  for (const meshes of Object.values(reliefLayers)) for (const mesh of meshes) {
    root.attach(mesh);
    mesh.userData.basePosition=mesh.position.clone();
    mesh.userData.baseScale=mesh.scale.clone();
  }
  if (config.sourceMode === "relief" && !reliefLayers.subject.length) throw Error("缺少独立人物层，请重新生成模型");

  // 创建可突破卡牌原本物理边界的 3D 全息悬浮光效网格 (fxMesh)
  const fxGeometry = new THREE.PlaneGeometry(6.30, 9.45);
  const fxMat = material(effectsFragment);
  fxMat.transparent = true;
  fxMat.depthWrite = false;
  fxMat.side = THREE.FrontSide;
  const fxMesh = new THREE.Mesh(fxGeometry, fxMat);
  fxMesh.name = "holo_floating_fx";
  fxMesh.renderOrder = 5;
  root.add(fxMesh);

  const updateFxTransform = (scale, x, y, depth, visible) => {
    if (!fxMesh) return;
    const s = typeof scale === "number" ? scale : 1.0;
    fxMesh.scale.set(s, s, 1.0);
    const px = typeof x === "number" ? (x / 162.54) : 0;
    const py = typeof y === "number" ? (-y / 162.54) : 0;
    // 确保物理Z轴不跌入卡牌正面网格下方（防止负值景深被遮挡消失），同时负值景深由parallax视差着色器完美呈现内嵌纵深
    const dVal = typeof depth === "number" ? depth : 0.14;
    const pz = Math.max(0.015, 0.025 + Math.max(0.0, dVal) * 0.25);
    fxMesh.position.set(px, py, pz);
    if (visible !== undefined) fxMesh.visible = !!visible;
  };
  updateFxTransform(
    p.fxScale ?? 1.0,
    p.fxX ?? 0,
    p.fxY ?? 0,
    p.effectsDepth ?? 0.14,
    hasFx
  );

  addShadow();
  const settingsHome=$('parameter-panel').parentElement;
  const responsiveSettings=()=>{
    const panel=$('parameter-panel');
    if(matchMedia('(max-width:960px)').matches)document.querySelector('main').append(panel);
    else settingsHome.append(panel);
  };
  responsiveSettings();window.addEventListener('resize',responsiveSettings);
  setupControls();
  document
    .querySelectorAll("button[disabled],input[disabled]")
    .forEach((el) => (el.disabled = false));
  new ResizeObserver(resize).observe(stage);
  resize();
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  const shaderErrors = (renderer.info.programs || []).filter(
    (p) => p.diagnostics && !p.diagnostics.runnable,
  );
  if (shaderErrors.length) {
    renderer.dispose();
    renderer.domElement.remove();
    fallback3D(new Error("当前设备无法显示卡面材质"));
    return;
  }
  const loadingEl = $("loading");
  if (loadingEl) {
    loadingEl.classList.add("fade-out");
    setTimeout(() => {
      try { loadingEl.remove(); } catch (e) {}
    }, 450);
  }
  root.rotation.set(targetX, targetY, 0);
  window.THREE = THREE;
  window.__holo = {
    ready: true,
    config,
    renderer,
    root,
    uniforms,
    camera,
    reset,
    flip,
    saveCard,
    updateFxTransform,
    fxMesh,
    recordGifFrames,
    recordVideoFrames,
    setFinish,
    setZoom: (z) => {
      zoom = z;
      resize();
    },
    getZoom: () => zoom,
    setCenterOffset,
    getCenterOffset: () => centerOffsetY,
    toggleGyro,
    getGyroState: () => gyroEnabled,
    toggleAutoRecenter,
    getAutoRecenterState: () => autoRecenter,
    resetPose,
    resize: () => resize(),
    modelSource: config.assets.model,
    layers: reliefLayers,
    getState: () => ({ auto, flipped, finish, zoom }),
  };
  setFinish(config.appearance?.finish || "pearl");
  setAuto(!media.matches);
  renderer.setAnimationLoop(animate);
}
// Layered 3D card built with CSS 3D transforms — used only when WebGL is
// unavailable (browser hardware acceleration off). It keeps the real depth
// stack: layers float at their configured offsets, the card tilts with the
// pointer, sways when idle, flips to a gold back, and the foil sheen follows
// the cursor. If WebGL comes back, the full shader engine takes over instead.
function fallback3D(error) {
  console.warn("[holo-card] WebGL unavailable, using CSS-3D fallback:", error);
  const roleZ = { background: -48, effects: -25, subject: -8, lineart: 24, text: 28 };
  const wrap = document.createElement("div");
  wrap.className = "fallback3d";
  const flipper = document.createElement("div");
  flipper.className = "flipper3d";
  const card = document.createElement("div");
  card.className = "card3d";
  card.id = "card3d";
  const front = document.createElement("div");
  front.className = "face3d front3d";
  const layers = new Map();
  for (const name of ["background", "effects", "subject", "lineart", "text"]) {
    if (!config?.assets?.[name]) continue;
    const layer = document.createElement("div");
    layer.className = "layer3d";
    const img = document.createElement("img");
    img.src = config.assets[name];
    img.alt = config.title || "卡片";
    img.loading = "eager";
    layer.append(img);
    front.append(layer);
    // White-background line art must not cover the subject: multiply drops the
    // white base and keeps only the dark contour strokes on top of the artwork.
    if (name === "lineart") layer.style.mixBlendMode = "multiply";
    layers.set(name, { el: layer, z: roleZ[name] });
  }
  const foil = document.createElement("div");
  foil.className = "foil3d";
  front.append(foil);
  const back = document.createElement("div");
  back.className = "face3d back3d";
  const backMark = document.createElement("span");
  backMark.className = "back-mark";
  backMark.textContent = "HOLO";
  back.append(backMark);
  card.append(front, back);
  flipper.append(card);
  wrap.append(flipper);
  stage.append(wrap);
  const fbLoading = $("loading");
  if (fbLoading) {
    fbLoading.classList.add("fade-out");
    setTimeout(() => {
      try { fbLoading.remove(); } catch (e) {}
    }, 450);
  }

  // ---- interaction state (independent of the WebGL path) ----
  let tx = -0.03, ty = -0.06, curX = 0, curY = 0, curFlip = 0, flipTarget = 0;
  let lastMove = 0, sway = !media.matches;
  let scale = 1, depthScale = 1, bgScale = 1;
  const applyLayers = () => {
    for (const [name, { el, z }] of layers) {
      const s = name === "background" ? bgScale : 1;
      el.style.transform = `translateZ(${(z * depthScale * s).toFixed(2)}px)`;
    }
  };
  applyLayers();
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    tx = Math.max(-0.5, Math.min(0.5, ((e.clientY - r.top) / r.height - 0.5) * 0.9));
    ty = Math.max(-0.5, Math.min(0.5, ((e.clientX - r.left) / r.width - 0.5) * 1.1));
    lastMove = performance.now();
    const c = card.getBoundingClientRect();
    front.style.setProperty("--mx", Math.round(((e.clientX - c.left) / c.width) * 100) + "%");
    front.style.setProperty("--my", Math.round(((e.clientY - c.top) / c.height) * 100) + "%");
  });
  stage.addEventListener("pointerleave", () => { lastMove = 0; });
  const frame = (now) => {
    if (sway && now - lastMove > 1500) {
      const t = now / 1000;
      tx = Math.sin(t * 0.7) * 0.07 + 0.05;
      ty = Math.sin(t * 0.55) * 0.11 - 0.18;
    }
    curX += (tx - curX) * 0.08;
    curY += (ty - curY) * 0.08;
    curFlip += (flipTarget - curFlip) * 0.12;
    flipper.style.transform = `rotateX(${curX.toFixed(4)}rad) rotateY(${curY.toFixed(4)}rad) scale(${scale})`;
    card.style.transform = `rotateY(${curFlip.toFixed(4)}rad)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- control wiring (mirrors the WebGL controls) ----
  const setFlip = (value) => {
    flipped = value;
    flipTarget = flipped ? Math.PI : 0;
    faceLabels();
  };
  const setAutoUI = (value) => {
    sway = value;
    const b = $("auto");
    if (!b) return;
    b.setAttribute("aria-pressed", String(value));
    b.setAttribute("aria-label", value ? "暂停旋转" : "自动旋转");
    b.title = value ? "暂停旋转" : "自动旋转";
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", value ? "pause" : "play");
    b.replaceChildren(icon);
    refreshIcons();
  };
  const fallbackFinish = (value) => {
    front.classList.remove("finish-gold", "finish-silver", "finish-pearl", "finish-original");
    front.classList.add("finish-" + value);
    document
      .querySelectorAll("[data-finish]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.finish === value)));
    const fnNames = { pearl: "珠光", silver: "银箔", gold: "烫金", original: "原画", matte: "磨砂", gloss: "清漆", brushed: "拉丝", holo: "光栅" };
    document.querySelectorAll(".finish-name-val").forEach((el) => {
      el.textContent = fnNames[value] || value;
    });
    if ($("finish-name")) {
      $("finish-name").textContent = fnNames[value] || value;
    }
    if ($("foil")) $("foil").disabled = value === "original";
    if ($("b-foil")) $("b-foil").disabled = value === "original";
    if ($("ws-foil")) $("ws-foil").disabled = value === "original";
  };
  $("info").disabled = false;
  if ($("info")) $("info").onclick = () => {
    if (typeof window.updateAboutModal === "function") window.updateAboutModal();
    $("about")?.showModal();
  };
  $("front").disabled = false;
  if ($("front")) $("front").onclick = () => setFlip(false);
  $("back").disabled = false;
  if ($("back")) $("back").onclick = () => setFlip(true);
  const depthToggleFallback = $("depth-toggle");
  if (depthToggleFallback) depthToggleFallback.onclick = () => toggleSettings();
  // The hide/show control cluster that used to sit under the card is gone: it rendered
  // as four unlabelled, icon-less circles there. Flipping stays available through the
  // 正面/背面 buttons and dragging already stops the idle sway, so only the panel's
  // permanent visibility matters here.
  const bindRange = (id, output, fn, decimals = 2) => {
    $(id).disabled = false;
    $(id).addEventListener("input", () => {
      const v = Number($(id).value);
      $(output).textContent = v.toFixed(decimals);
      fn(v);
    });
  };
  bindRange("scale", "scale-value", (v) => { scale = v; });
  bindRange("depth", "depth-value", (v) => {
    depthScale = Math.max(0.1, 1 + v * 4);
    applyLayers();
  });
  bindRange("bg-depth", "bg-depth-value", (v) => {
    bgScale = Math.max(0.1, 1 + v * 4);
    applyLayers();
  });
  document.querySelectorAll("[data-finish]").forEach((b) => {
    b.disabled = false;
    b.onclick = () => fallbackFinish(b.dataset.finish);
  });
  bindRange("foil", "foil-value", (v) => {
    front.style.setProperty("--foil-amount", v);
  }, 0);
  $("foil-value").textContent = Math.round(Number($("foil").value) * 100) + "%";
  front.style.setProperty("--foil-amount", $("foil").value);
  // Seed scale from config; depth sliders start neutral (the layered base
  // offsets above already encode the default depth profile).
  if (config.parameters?.subjectScale) {
    scale = config.parameters.subjectScale;
    $("scale").value = config.parameters.subjectScale;
  }
  applyLayers();
  fallbackFinish(config.appearance?.finish || "gold");
  notice("浏览器未开启 WebGL：已用轻量 3D 模式显示（层次保留）");
  window.__holo = { ready: false, error: String(error), fallback3d: true };
}
function resize() {
  if (!renderer || !stage) return;
  const width = stage.clientWidth || window.innerWidth || 1024;
  const height = stage.clientHeight || window.innerHeight || 768;
  const aspect = width / (height || 1) || 1;
  const z = zoom || 1;
  const halfHeight = (Math.max(config?.sourceMode === "relief" ? 6.75 : 6.10, 5.10 / aspect) / z);
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
function setAuto(value) {
  auto = value;
  const button = $("auto");
  if (!button) return;
  button.setAttribute("aria-pressed", String(auto));
  button.setAttribute("aria-label", auto ? "暂停旋转" : "自动旋转");
  button.title = auto ? "暂停旋转" : "自动旋转";
  button.replaceChildren();
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", auto ? "pause" : "play");
  button.append(icon);
  refreshIcons();
}
function setFinish(value) {
  finish = value;
  if (uniforms && uniforms.uFinish) {
    uniforms.uFinish.value = { pearl: 0, silver: 1, original: 2, gold: 3, matte: 4, gloss: 5, brushed: 6, holo: 7 }[value] ?? 0;
  }
  document
    .querySelectorAll("[data-finish]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.finish === value)),
    );
  const fnNames = {
    pearl: "珠光",
    silver: "银箔",
    gold: "烫金",
    original: "原画",
    matte: "磨砂",
    gloss: "清漆",
    brushed: "拉丝",
    holo: "光栅",
  };
  document.querySelectorAll(".finish-name-val").forEach((el) => {
    el.textContent = fnNames[value] || value;
  });
  if ($("finish-name")) {
    $("finish-name").textContent = fnNames[value] || value;
  }
  if ($("foil")) $("foil").disabled = value === "original";
  if ($("b-foil")) $("b-foil").disabled = value === "original";
  if ($("ws-foil")) $("ws-foil").disabled = value === "original";
}
function faceLabels() {
  $("front").setAttribute("aria-pressed", String(!flipped));
  $("back").setAttribute("aria-pressed", String(flipped));
  $("view-label").textContent = flipped ? "02 / BACK" : "01 / FRONT";
}
function flip(value = !flipped) {
  flipped = value;
  setAuto(false);
  userRotY = flipped ? Math.PI : 0;
  userRotX = 0;
  targetY = userRotY + gyroDeltaY;
  targetX = userRotX + gyroDeltaX;
  faceLabels();
}
// Layered relief stack: clearly separated depths so the card reads as a
// lightbox diorama — subject / effects / text each float on their own plane
// (offsets in card-space units, card half-height ≈ 5.45).
const RELIEF_STEP = 0.22;
function layoutRelief() {
  const z = Number($("depth").value);
  const invScale = 1 / Number($("scale").value);
  const place = (meshes, dz) => {
    for (const mesh of meshes) {
      mesh.position.z = z + dz;
      mesh.scale.copy(mesh.userData.baseScale).multiplyScalar(invScale);
    }
  };
  place(reliefLayers.subject, 0);
  place(reliefLayers.effects, RELIEF_STEP);
  place(reliefLayers.text, RELIEF_STEP * 2);
}
function updateInput(id, name) {
  const input = $(id);
  if (!input) return;
  const val = Number(input.value);
  if (!isNaN(val)) {
    if (uniforms && uniforms[name]) {
      uniforms[name].value = val;
    }
  }
  if (config.sourceMode === "relief") layoutRelief();
  const out = $(id + "-value");
  if (out) {
    out.value =
      id === "foil"
        ? Math.round(input.value * 100) + "%"
        : Number(input.value).toFixed(2);
  }
}
function reset() {
  userRotX = -0.035;
  userRotY = -0.15;
  gyroDeltaX = 0;
  gyroDeltaY = 0;
  targetX = -0.035;
  targetY = -0.15;
  neutralBeta = null;
  neutralGamma = null;
  zoom = 1;
  setCenterOffset(0);
  flipped = false;
  setAuto(false);
  faceLabels();
  const p = config.parameters || {};
  const defaults = {
    foil: p.foil ?? 0.52,
    scale: p.subjectScale ?? 1,
    depth: p.subjectDepth ?? 0.32,
    "fx-depth": p.effectsDepth ?? 0.14,
    "bg-depth": p.backgroundDepth ?? -0.18,
  };
  settings.forEach(([id, name]) => {
    $(id).value = defaults[id];
    updateInput(id, name);
  });
  setFinish(config.appearance?.finish || "pearl");
  resize();
}
function toggleSettings() {
  // 统一联动：点击底部景深调整按钮直接打开统一的侧边栏，不再使用旧版冲突的双式构图浮动面板
  const bSidebar = $("b-sidebar");
  if (bSidebar) {
    const willOpen = !bSidebar.classList.contains("open");
    bSidebar.classList.toggle("open", willOpen);
    document.querySelectorAll(".sidebar-backdrop").forEach(b => b.classList.toggle("open", willOpen));
    const button = $("depth-toggle");
    if (button) button.setAttribute("aria-expanded", String(willOpen));
  }
}
function setupControls() {
  if (config.sourceMode === "relief") {
    // Layered card relief: subject base plane 0..0.9, effects/text above it.
    $("depth").min="0.0";$("depth").max="0.9";
    $("scale").min="0.92";$("scale").max="1.3";
  }
  settings.forEach(([id, name]) => {
    const el = $(id);
    if (!el) return;
    // 只有带有明确 min 和 max 范围的有效控件才同步与触发 updateInput，
    // 彻底避免未配置 min/max 的占位 range 把负数（如 uBgDepth = -0.18）或小数强制截断为 0 导致景深丢失！
    if (uniforms && uniforms[name] !== undefined) {
      if (el.min !== "" && el.max !== "") {
        el.value = uniforms[name].value;
        updateInput(id, name);
      }
    }
    el.addEventListener("input", () => updateInput(id, name));
  });
  const activePointers = new Map();
  let initialPinchDist = null;
  let initialPinchZoom = zoom;

  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("dragging");
    stage.focus({ preventScroll: true });
    setAuto(false);

    if (activePointers.size === 1) {
      dragging = true;
      // 关键修复：触摸按下一瞬间，将 userRotX / userRotY 精准同步为当前卡牌物理旋转角
      userRotX = root.rotation.x - gyroDeltaX;
      userRotY = root.rotation.y - gyroDeltaY;
      targetX = root.rotation.x;
      targetY = root.rotation.y;
      lastPointer = { x: e.clientX, y: e.clientY };
    } else if (activePointers.size === 2) {
      // 切换至移动端双指捏合缩放模式
      dragging = false;
      const pts = Array.from(activePointers.values());
      initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialPinchZoom = zoom;
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指手势：动态缩放卡牌视角
    if (activePointers.size === 2 && initialPinchDist) {
      const pts = Array.from(activePointers.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (initialPinchDist > 5) {
        const ratio = currentDist / initialPinchDist;
        zoom = THREE.MathUtils.clamp(initialPinchZoom * ratio, 0.72, 1.35);
        resize();
      }
      return;
    }

    if (!dragging || activePointers.size !== 1) return;

    // 单指拖拽：360度自由流畅无阻碍旋转
    userRotY += (e.clientX - lastPointer.x) * 0.007;
    userRotX += (e.clientY - lastPointer.y) * 0.005;
    userRotX = THREE.MathUtils.clamp(userRotX, -0.65, 0.65);
    targetY = userRotY + gyroDeltaY;
    targetX = userRotX + gyroDeltaX;
    lastPointer = { x: e.clientX, y: e.clientY };
  });

  const releasePointer = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      dragging = false;
      initialPinchDist = null;
      stage.classList.remove("dragging");
      if (autoRecenter) {
        let base = flipped ? Math.PI : 0;
        const twoPi = Math.PI * 2;
        const turns = Math.round((userRotY - base) / twoPi);
        base = base + turns * twoPi;
        userRotY = base;
        userRotX = -0.02;
        targetY = userRotY + gyroDeltaY;
        targetX = userRotX + gyroDeltaX;
      }
    } else if (activePointers.size === 1) {
      // 从双指松开一指后无缝接管回单指旋转
      const [remaining] = activePointers.values();
      lastPointer = { x: remaining.x, y: remaining.y };
      userRotX = root.rotation.x - gyroDeltaX;
      userRotY = root.rotation.y - gyroDeltaY;
      dragging = true;
      initialPinchDist = null;
    }
  };

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
    stage.addEventListener(type, releasePointer),
  );

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom - e.deltaY * 0.001, 0.72, 1.35);
      resize();
    },
    { passive: false },
  );
  stage.addEventListener("keydown", (e) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "f",
        "F",
        "r",
        "R",
        " ",
      ].includes(e.key)
    )
      return;
    e.preventDefault();
    if (e.key === " ") {
      setAuto(!auto);
      return;
    }
    if (e.key.toLowerCase() === "f") {
      flip();
      return;
    }
    if (e.key.toLowerCase() === "r") {
      reset();
      return;
    }
    setAuto(false);
    const base = flipped ? Math.PI : 0;
    if (e.key === "ArrowLeft") userRotY -= 0.08;
    if (e.key === "ArrowRight") userRotY += 0.08;
    if (e.key === "ArrowUp") userRotX -= 0.06;
    if (e.key === "ArrowDown") userRotX += 0.06;
    userRotX = THREE.MathUtils.clamp(userRotX, -0.65, 0.65);
    targetY = userRotY + gyroDeltaY;
    targetX = userRotX + gyroDeltaX;
  });
  if ($("front")) $("front").onclick = () => flip(false);
  if ($("back")) $("back").onclick = () => flip(true);
  const depthToggle = $("depth-toggle");
  if (depthToggle) depthToggle.onclick = () => toggleSettings();
  document
    .querySelectorAll("[data-finish]")
    .forEach((b) => (b.onclick = () => setFinish(b.dataset.finish)));
  if ($("info")) $("info").onclick = () => {
    if (typeof window.updateAboutModal === "function") window.updateAboutModal();
    $("about")?.showModal();
  };
  if ($("close-about")) $("close-about").onclick = () => $("about")?.close();
  if ($("about")) {
    $("about").onclick = (e) => {
      if (e.target === $("about")) {
        const r = $("about").getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          $("about").close();
      }
    };
  }
  if ($("save")) $("save").onclick = saveCard;

  const gyroBtn = $("btn-gyro-toggle");
  if (gyroBtn) {
    gyroBtn.onclick = async () => {
      const active = await toggleGyro();
      const txt = gyroBtn.querySelector(".gyro-btn-text");
      if (txt) txt.textContent = active ? "陀螺仪: 开" : "陀螺仪: 关";
      gyroBtn.classList.toggle("active", active);
      notice(active ? "已开启重力感应（晃动设备体验全息流光）" : "已关闭重力感应陀螺仪");
    };
  }

  const recenterBtn = $("btn-recenter-toggle");
  if (recenterBtn) {
    recenterBtn.onclick = () => {
      const active = toggleAutoRecenter();
      const txt = recenterBtn.querySelector(".recenter-btn-text");
      if (txt) txt.textContent = active ? "自动回正: 开" : "自动回正: 关";
      recenterBtn.classList.toggle("active", active);
      notice(active ? "已开启松手自动回正" : "已开启自由滑转停驻");
    };
  }

  const resetBtn = $("btn-reset-view");
  if (resetBtn) {
    resetBtn.onclick = () => {
      resetPose();
      notice("已复位视角");
    };
  }
  media.addEventListener("change", () => {
    if (media.matches) setAuto(false);
  });
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    notice("图形显示已暂停，请刷新页面恢复");
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    notice("3D 渲染已恢复");
    try {
      renderer.setAnimationLoop(animate);
    } catch (e) {}
  });
}
function saveCard() {
  try {
    const originalSize = new THREE.Vector2();
    renderer.getSize(originalSize);
    const originalRatio = renderer.getPixelRatio();
    const bounds = {
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
    };
    renderer.setPixelRatio(1);
    renderer.setSize(1400, 1800, false);
    const captureHeight = config.sourceMode === "relief" ? 6.4 : 5.4;
    camera.left = -captureHeight*1400/1800;
    camera.right = captureHeight*1400/1800;
    camera.top = captureHeight;
    camera.bottom = -captureHeight;
    camera.updateProjectionMatrix();
    try {
      renderer.render(scene, camera);
      const link = document.createElement("a");
      link.download =
        (config.title || "art-card") +
        "-" +
        (flipped ? "back" : "front") +
        ".png";
      link.href = renderer.domElement.toDataURL("image/png");
      link.click();
      notice("卡片图片已保存");
    } finally {
      Object.assign(camera, bounds);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(originalRatio);
      renderer.setSize(originalSize.x, originalSize.y, false);
      renderer.render(scene, camera);
    }
  } catch (error) {
    console.error(error);
    notice("图片未能保存，请重试");
  }
}

// 自动录制 3 秒 3D 全息动态检视 60 帧无缝循环像素数据 (400x560, 20fps)
async function recordGifFrames(onFrameProgress) {
  if (!renderer || !root || !uniforms) throw new Error("3D 渲染器未就绪");
  const originalSize = new THREE.Vector2();
  renderer.getSize(originalSize);
  const originalRatio = renderer.getPixelRatio();
  const bounds = {
    left: camera.left,
    right: camera.right,
    top: camera.top,
    bottom: camera.bottom,
  };
  const origRotX = root.rotation.x;
  const origRotY = root.rotation.y;
  const origRotZ = root.rotation.z;
  const origPosY = root.position.y;
  const origTime = uniforms.uTime.value;

  const width = 400;
  const height = 560;
  const totalFrames = 60;
  const frames = [];

  const captureCanvas = document.createElement("canvas");
  captureCanvas.width = width;
  captureCanvas.height = height;
  const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    // 聚焦卡牌本体并留约 8% 舒适展示边距
    const captureHeight = 5.6;
    camera.left = -captureHeight * (width / height);
    camera.right = captureHeight * (width / height);
    camera.top = captureHeight;
    camera.bottom = -captureHeight;
    camera.updateProjectionMatrix();
    root.position.y = 0;

    const baseRotY = flipped ? Math.PI : 0;

    for (let i = 0; i < totalFrames; i++) {
      const progress = i / totalFrames; // 0.0 -> 0.983
      const theta = progress * Math.PI * 2; // 0 -> 2π seamless loop

      // 1. 左右偏转 (Yaw): ±20° 正弦平滑来回
      const rotY = baseRotY + Math.sin(theta) * 0.35;
      // 2. 前后俯仰 (Pitch): ±7° 双倍频复合，第0秒与第3秒首尾完全重合
      const rotX = Math.sin(theta * 2) * 0.12 - 0.03;

      root.rotation.x = rotX;
      root.rotation.y = rotY;
      root.updateMatrixWorld(true);

      uniforms.uView.value
        .copy(camera.position)
        .applyMatrix4(inverse.copy(root.matrixWorld).invert())
        .normalize();

      // 3. 同时推进 Uniforms 使镭射扫光与粒子首尾平滑流动
      uniforms.uTime.value = progress * 3.0;
      shadow.scale.x = 1 - Math.abs(Math.sin(root.rotation.y)) * 0.14;

      renderer.render(scene, camera);

      // 捕获帧 RGBA 像素数据
      captureCtx.drawImage(renderer.domElement, 0, 0, width, height);
      const imgData = captureCtx.getImageData(0, 0, width, height);
      frames.push(new Uint8Array(imgData.data.buffer));

      if (typeof onFrameProgress === "function") {
        onFrameProgress(i + 1, totalFrames, "recording");
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    return frames;
  } finally {
    Object.assign(camera, bounds);
    camera.updateProjectionMatrix();
    root.rotation.set(origRotX, origRotY, origRotZ);
    root.position.y = origPosY;
    uniforms.uTime.value = origTime;
    renderer.setPixelRatio(originalRatio);
    renderer.setSize(originalSize.x, originalSize.y, false);
    renderer.render(scene, camera);
  }
}

// 自动录制 3 秒 3D 全息动态检视 1080P 60帧视频画面 (1080x1512, 60fps)
async function recordVideoFrames(width, height, totalFrames, onFrameProgress) {
  if (!renderer || !root || !uniforms) throw new Error("3D 渲染器未就绪");
  const originalSize = new THREE.Vector2();
  renderer.getSize(originalSize);
  const originalRatio = renderer.getPixelRatio();
  const bounds = {
    left: camera.left,
    right: camera.right,
    top: camera.top,
    bottom: camera.bottom,
  };
  const origRotX = root.rotation.x;
  const origRotY = root.rotation.y;
  const origRotZ = root.rotation.z;
  const origPosY = root.position.y;
  const origTime = uniforms.uTime.value;

  const captureCanvas = document.createElement("canvas");
  captureCanvas.width = width;
  captureCanvas.height = height;
  const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    const captureHeight = 5.6;
    camera.left = -captureHeight * (width / height);
    camera.right = captureHeight * (width / height);
    camera.top = captureHeight;
    camera.bottom = -captureHeight;
    camera.updateProjectionMatrix();
    root.position.y = 0;

    const baseRotY = flipped ? Math.PI : 0;

    for (let i = 0; i < totalFrames; i++) {
      const progress = i / totalFrames;
      const theta = progress * Math.PI * 2;

      // 1. 左右偏转 (Yaw): ±20° 正弦平滑来回
      const rotY = baseRotY + Math.sin(theta) * 0.35;
      // 2. 前后俯仰 (Pitch): ±7° 双倍频复合，第0秒与第3秒首尾完全重合
      const rotX = Math.sin(theta * 2) * 0.12 - 0.03;

      root.rotation.x = rotX;
      root.rotation.y = rotY;
      root.updateMatrixWorld(true);

      uniforms.uView.value
        .copy(camera.position)
        .applyMatrix4(inverse.copy(root.matrixWorld).invert())
        .normalize();

      uniforms.uTime.value = progress * 3.0;
      shadow.scale.x = 1 - Math.abs(Math.sin(root.rotation.y)) * 0.14;

      renderer.render(scene, camera);
      captureCtx.drawImage(renderer.domElement, 0, 0, width, height);

      if (typeof onFrameProgress === "function") {
        await onFrameProgress(captureCanvas, i, totalFrames);
      }
    }
  } finally {
    Object.assign(camera, bounds);
    camera.updateProjectionMatrix();
    root.rotation.set(origRotX, origRotY, origRotZ);
    root.position.y = origPosY;
    uniforms.uTime.value = origTime;
    renderer.setPixelRatio(originalRatio);
    renderer.setSize(originalSize.x, originalSize.y, false);
    renderer.render(scene, camera);
  }
}
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.06) || 0;
  lastTime = now;
  const gallery = $("view-gallery");
  if (document.hidden || (gallery && gallery.classList.contains("hidden"))) return;
  if (!media.matches || auto) elapsed += dt;
  if (auto) {
    targetY = Math.sin(elapsed * 0.42) * 0.23 - 0.055;
    targetX = Math.sin(elapsed * 0.53) * 0.055 - 0.018;
  }
  const ease = media.matches ? 1 : 1 - Math.exp(-dt * 8);
  root.rotation.x += (targetX - root.rotation.x) * ease;
  root.rotation.y += (targetY - root.rotation.y) * ease;
  root.updateMatrixWorld(true);
  uniforms.uView.value
    .copy(camera.position)
    .applyMatrix4(inverse.copy(root.matrixWorld).invert())
    .normalize();
  uniforms.uTime.value = media.matches && !auto ? 0 : elapsed;
  shadow.scale.x = 1 - Math.abs(Math.sin(root.rotation.y)) * 0.14;
  renderer.render(scene, camera);
}
const fail = (message) => {
  const loading = $("loading");
  if (loading && window.__holo && window.__holo.ready) return;
  loading?.classList.add("error");
  loading?.setAttribute("role", "alert");
  loading?.replaceChildren();
  const msg = document.createElement("span");
  msg.textContent = message;
  const retry = document.createElement("button");
  retry.textContent = "重新加载";
  retry.onclick = () => location.reload();
  loading?.append(msg, retry);
  window.__holo = { ready: false, error: message };
};
const LOAD_TIMEOUT_MS = 12000;
let settled = false;
Promise.race([
  init().then(() => {
    settled = true;
  }),
  new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("卡片加载超时，请检查网络或刷新重试")),
      LOAD_TIMEOUT_MS,
    ),
  ),
]).catch((error) => {
  if (settled) return;
  console.error("3D Card load error:", error);
  try {
    fallback3D(error);
    settled = true;
  } catch (fbErr) {
    const errMsg = (error && error.message)
      ? error.message
      : (typeof error === "string" ? error : (error && error.type ? `资源响应异常 (${error.type})` : "着色器或资源初始化异常，请刷新重试"));
    fail("作品暂时无法加载。\n" + errMsg);
  }
});