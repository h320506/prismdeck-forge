/**
 * site.js - 统管 Page A (工坊) 与 Page B (3D 展台) 的双向交互、半透明侧边栏与 Netlify 一键导出
 */
import JSZip from "jszip";

function $(id) {
  return document.getElementById(id);
}

// 全局卡牌统一状态
const state = {
  title: "八奈见杏菜",
  subtitle: "败犬女主太多了！",
  collection: "文学部",
  technique: "温水くん",
  tagline: "あはは、温水くん。",
  edition: "001 / 001",
  finish: "pearl",
  cardEffect: "none",
  borderStyle: "classic-gold",
  colorTheme: "gold",
  subjectScale: 1.0,
  subjectX: 0,
  subjectY: 0,
  bgScale: 1.0,
  bgX: 0,
  bgY: 0,
  bgBlur: 0,
  depth: 0.32,
  bgDepth: -0.18,
  diff: 1.0,
  foil: 0.52,
  fxGlow: 0.5
};

let rawSubjectImg = null;
let rawBgImg = null;
let activeCardId = null;
let hasCustomSubject = false;
let hasCustomBg = false;

// 卡面特效预设资源与预加载
const effectSources = {
  stardust: "./assets/effects/effect_stardust.png",
  star_glint: "./assets/effects/effect_star_glint.png",
  floating_bokeh: "./assets/effects/effect_floating_bokeh.png",
  light_embers: "./assets/effects/effect_light_embers.png",
  prismatic_petals: "./assets/effects/effect_prismatic_petals.png",
  cracked_ice: "./assets/effects/effect_cracked_ice.png",
  brushed_sheen: "./assets/effects/effect_brushed_sheen.png",
  gold_leaf: "./assets/effects/effect_gold_leaf.png",
  water_ripple: "./assets/effects/effect_water_ripple.png"
};
const effectImgs = {};
for (const [k, url] of Object.entries(effectSources)) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.onload = () => {
    effectImgs[k] = img;
    if (state.cardEffect === k) {
      render2DPreview();
      syncTo3D();
    }
  };
}
const effectNames = {
  none: "纯净无特效",
  stardust: "✨ 银河碎钻",
  star_glint: "✦ 璀璨星芒",
  floating_bokeh: "🫧 梦幻光尘",
  light_embers: "🕊️ 灵动光烬",
  prismatic_petals: "💎 幻彩碎羽",
  cracked_ice: "🧊 破碎冰晶",
  brushed_sheen: "☀️ 丝绢放射",
  gold_leaf: "🍂 浮世金箔",
  water_ripple: "💧 水波涟漪"
};

// 获取特效 Canvas 纹理生成器
function getEffectCanvas(effKey) {
  if (!effKey || effKey === "none") return null;
  const img = effectImgs[effKey];
  if (!img) return null;
  const cvs = document.createElement("canvas");
  cvs.width = 1024;
  cvs.height = 1536;
  const ctx = cvs.getContext("2d");
  ctx.drawImage(img, 0, 0, 1024, 1536);
  return cvs;
}

// 生成白底黑线线稿 (用于全息烫金描边发光)
function generateLineart(subjectCanvas) {
  const w = 1024;
  const h = 1536;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext("2d");

  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, w, h);

  const srcCtx = subjectCanvas.getContext("2d");
  const srcData = srcCtx.getImageData(0, 0, w, h);
  const dstData = outCtx.getImageData(0, 0, w, h);

  const src = srcData.data;
  const dst = dstData.data;

  const gray = new Float32Array(w * h);
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    alpha[i] = src[p + 3];
    if (src[p + 3] > 10) {
      gray[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
    } else {
      gray[i] = 255;
    }
  }

  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const idx = y * w + x;
      if (alpha[idx] < 10) continue;

      const g00 = gray[idx - w - 1], g02 = gray[idx - w + 1];
      const g10 = gray[idx - 1],     g12 = gray[idx + 1];
      const g20 = gray[idx + w - 1], g22 = gray[idx + w + 1];

      const gx = (-g00 + g02) + 2 * (-g10 + g12) + (-g20 + g22);
      const gy = (-g00 - 2 * gray[idx - w] - g02) + (g20 + 2 * gray[idx + w] + g22);
      const mag = Math.sqrt(gx * gx + gy * gy);

      if (mag > 40 || alpha[idx] < 200) {
        const p = idx * 4;
        dst[p] = 20;
        dst[p + 1] = 20;
        dst[p + 2] = 20;
        dst[p + 3] = 255;
      }
    }
  }

  outCtx.putImageData(dstData, 0, 0);
  return outCanvas;
}

// 适配到 1024x1536 画布
function fitImageToCanvas(img, scale = 1.0, offsetX = 0, offsetY = 0, transparentBg = false, blurRadius = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1536;
  const ctx = canvas.getContext("2d");

  if (transparentBg) {
    ctx.clearRect(0, 0, 1024, 1536);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1024, 1536);
  }

  if (!img) return canvas;

  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const imgAspect = w / h;
  const canvasAspect = 1024 / 1536;

  let drawW = 1024 * scale;
  let drawH = 1536 * scale;

  if (imgAspect > canvasAspect) {
    drawH = drawW / imgAspect;
  } else {
    drawW = drawH * imgAspect;
  }

  const posX = (1024 - drawW) / 2 + offsetX;
  const posY = (1536 - drawH) / 2 + offsetY;

  if (blurRadius > 0) {
    ctx.filter = `blur(${blurRadius}px)`;
  }
  ctx.drawImage(img, posX, posY, drawW, drawH);
  ctx.filter = "none";
  return canvas;
}

// 动态绘制卡片文字与装饰边框
function drawTextCanvas(cfg) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1536;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);

  // 1. 同色系和谐配色：保持同色相体系，主标题为高亮琉璃色，边框与副标题为同色系纯度基调
  let primary = "#f4d087";      // 耀目鎏金：典雅暖金
  let secondary = "#fff1ce";    // 鎏金主字：淡金象牙白（同金色系）
  let stroke = "rgba(22, 16, 8, 0.9)";

  if (cfg.colorTheme === "silver") {
    primary = "#c5cdd6";        // 秘银流光：高雅纯银
    secondary = "#ffffff";      // 秘银主字：纯澈明亮白（同银色系）
    stroke = "rgba(12, 16, 22, 0.9)";
  } else if (cfg.colorTheme === "crimson") {
    primary = "#e05368";        // 炽烈绯红：高贵宝石绯红
    secondary = "#ffe8ed";      // 绯红主字：极淡粉白琉璃光（严谨同属于绯红色系，绝不再跨到黄色！）
    stroke = "rgba(38, 10, 16, 0.92)";
  } else if (cfg.colorTheme === "cyan") {
    primary = "#17c0ba";        // 荧光青蓝：通透晶莹青碧
    secondary = "#e8fcfb";      // 青蓝主字：极淡冰青白（严谨同属于青蓝冷色系）
    stroke = "rgba(8, 25, 30, 0.92)";
  }

  const hasBorder = cfg.borderStyle && cfg.borderStyle !== "none";
  const hasTopText = Boolean((cfg.title && cfg.title.trim()) || (cfg.subtitle && cfg.subtitle.trim()) || (cfg.collection && cfg.collection.trim()));
  const hasBottomText = Boolean((cfg.tagline && cfg.tagline.trim()) || (cfg.technique && cfg.technique.trim()));

  // 绘制边框 (选择「无边框」时完全不绘制任何边线或几何结构)
  if (cfg.borderStyle === "classic-gold") {
    ctx.strokeStyle = primary;
    ctx.lineWidth = 3;
    ctx.strokeRect(36, 36, 952, 1464);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(48, 48, 928, 1440);

    const sz = 20;
    [[48, 48], [976, 48], [48, 1488], [976, 1488]].forEach(([cx, cy]) => {
      ctx.fillStyle = primary;
      ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
    });
  } else if (cfg.borderStyle === "cyber") {
    ctx.strokeStyle = primary;
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, 944, 1456);
    ctx.fillStyle = primary;
    ctx.fillRect(40, 40, 120, 8);
    ctx.fillRect(864, 40, 120, 8);
    ctx.fillRect(40, 1488, 120, 8);
    ctx.fillRect(864, 1488, 120, 8);
  } else if (cfg.borderStyle === "ornamental") {
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, 944, 1456);
    ctx.strokeRect(52, 52, 920, 1432);
    ctx.strokeRect(60, 60, 904, 1416);
  }

  function drawTxt(x, y, value, size, anchor = "left", fill = secondary, maxWidth = 850) {
    if (!value || !value.trim()) return;
    let currentSize = Math.max(8, Math.round(size));
    ctx.font = `600 ${currentSize}px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = anchor;
    ctx.textBaseline = "top";

    while (ctx.measureText(value).width > maxWidth && currentSize > 12) {
      currentSize--;
      ctx.font = `600 ${currentSize}px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
    }

    ctx.fillStyle = fill;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = stroke;
    ctx.strokeText(value, x, y);
    ctx.fillText(value, x, y);
  }

  function drawLine(y) {
    ctx.beginPath();
    ctx.moveTo(70, y);
    ctx.lineTo(954, y);
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 顶部文字排版 (仅在有文字时绘制)
  if (cfg.subtitle) drawTxt(72, 60, cfg.subtitle, 26, "left", primary);
  if (cfg.title) drawTxt(72, 100, cfg.title, 86, "left", secondary, 875);
  if (cfg.collection) drawTxt(76, 205, cfg.collection, 24, "left", primary);

  // 顶部分割线：必须同时满足「开启边框」且「顶部有文字」才绘制；选择无边框或无文字时坚决不画横线！
  if (hasBorder && hasTopText) {
    drawLine(245);
  }

  // 底部分割线：必须同时满足「开启边框」且「底部有招式/标语文字」才绘制
  if (hasBorder && hasBottomText) {
    drawLine(1280);
  }

  if (cfg.tagline) drawTxt(512, 1300, cfg.tagline, 32, "center", primary);
  if (cfg.technique) drawTxt(512, 1348, cfg.technique, 68, "center", secondary);

  // 编号与 HOLOGRAPHIC 标识：用户清空编号时自动隐藏，无边框且清空时不画任何干扰元素
  const editionVal = cfg.edition !== undefined ? cfg.edition : "001 / 001";
  if (editionVal && editionVal.trim()) {
    drawTxt(72, 1460, editionVal, 22, "left", primary);
    if (hasBorder) {
      drawTxt(950, 1460, "H O L O G R A P H I C", 20, "right", primary, 400);
    }
  }

  return c;
}

// 刷新 Page A 的 2D 预览
function render2DPreview() {
  const previewCanvas = $("preview-canvas");
  if (!previewCanvas) return;
  const ctx = previewCanvas.getContext("2d");
  const w = 1024;
  const h = 1536;

  ctx.clearRect(0, 0, w, h);

  // 1. 绘制背景 (支持缩放、位移与模糊)
  if (rawBgImg) {
    const bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
    ctx.drawImage(bgCvs, 0, 0);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }

  // 2. 绘制主体 (支持缩放与位移)
  if (rawSubjectImg) {
    const subjCvs = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0);
    ctx.drawImage(subjCvs, 0, 0);
  }

  // 2.5 绘制卡面特效 (碎钻、星芒、光尘、光烬、碎羽、冰晶、放射、金箔、水波)
  if (state.cardEffect && state.cardEffect !== "none") {
    const fxCvs = getEffectCanvas(state.cardEffect);
    if (fxCvs) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(fxCvs, 0, 0, w, h);
      const glowAmt = state.fxGlow ?? 0.5;
      if (glowAmt > 0.01) {
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.65 * glowAmt;
        ctx.drawImage(fxCvs, 0, 0, w, h);
      }
      ctx.restore();
    }
  }

  // 3. 绘制文字与边框
  const textCvs = drawTextCanvas(state);
  ctx.drawImage(textCvs, 0, 0);
}

// 同步所有图层到 Page B (3D 全息视图)
function syncTo3D() {
  if (!window.__holo || !window.THREE) return;

  // 1. 背景
  if (rawBgImg) {
    const bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
    const bgTex = new window.THREE.CanvasTexture(bgCvs);
    bgTex.colorSpace = window.THREE.NoColorSpace;
    window.__holo.uniforms.tBackground.value = bgTex;
  }

  // 2. 主体与线稿
  if (rawSubjectImg) {
    const subjCvs = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0);
    const subjTex = new window.THREE.CanvasTexture(subjCvs);
    subjTex.colorSpace = window.THREE.NoColorSpace;
    window.__holo.uniforms.tSubject.value = subjTex;

    try {
      const lineCvs = generateLineart(subjCvs);
      const lineTex = new window.THREE.CanvasTexture(lineCvs);
      lineTex.colorSpace = window.THREE.NoColorSpace;
      window.__holo.uniforms.tLine.value = lineTex;
    } catch (e) {
      console.warn("Lineart sync error:", e);
    }
  }

  // 3. 文字
  const textCvs = drawTextCanvas(state);
  const textTex = new window.THREE.CanvasTexture(textCvs);
  textTex.colorSpace = window.THREE.NoColorSpace;
  window.__holo.uniforms.tText.value = textTex;

  // 3.5 同步卡面特效至 3D 浮层 (具备真实三维景深视差与辉光调节)
  if (window.__holo && window.__holo.uniforms) {
    if (state.cardEffect && state.cardEffect !== "none") {
      const fxCvs = getEffectCanvas(state.cardEffect);
      if (fxCvs) {
        const fxTex = new window.THREE.CanvasTexture(fxCvs);
        fxTex.colorSpace = window.THREE.NoColorSpace;
        fxTex.needsUpdate = true;
        window.__holo.uniforms.tEffects.value = fxTex;
        if (window.__holo.uniforms.uHasFx) window.__holo.uniforms.uHasFx.value = 1.0;
      }
    } else {
      if (window.__holo.uniforms.uHasFx) window.__holo.uniforms.uHasFx.value = 0.0;
    }
    if (window.__holo.uniforms.uFxGlow) {
      window.__holo.uniforms.uFxGlow.value = state.fxGlow ?? 0.5;
    }
  }

  // 4. 景深、镭射与卡面材质
  window.__holo.uniforms.uDepth.value = state.depth;
  window.__holo.uniforms.uBgDepth.value = state.bgDepth;
  if (window.__holo.uniforms.uDiff) {
    window.__holo.uniforms.uDiff.value = state.diff ?? 1.0;
  }
  window.__holo.uniforms.uFoil.value = state.foil;
  if (state.finish && typeof window.__holo.setFinish === "function") {
    window.__holo.setFinish(state.finish);
  }

  // 5. 更新网页文本
  const tEl = $("card-title");
  if (tEl) tEl.textContent = state.title;
  const sEl = $("subtitle");
  if (sEl) sEl.textContent = state.subtitle;
  const dEl = $("description");
  if (dEl) dEl.textContent = state.tagline;
  const eEl = $("edition");
  if (eEl) eEl.textContent = state.edition;

  window.dispatchEvent(new Event("resize"));
}

// 视图切换：进入 Page B (3D 展台)
function showGallery() {
  syncTo3D();
  const vWorkshop = $("view-workshop");
  const vGallery = $("view-gallery");
  if (vWorkshop) vWorkshop.classList.add("hidden");
  if (vGallery) vGallery.classList.remove("hidden");
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event("resize"));
}

// 视图切换：返回 Page A (工坊)
function showWorkshop() {
  const vWorkshop = $("view-workshop");
  const vGallery = $("view-gallery");
  if (vGallery) vGallery.classList.add("hidden");
  if (vWorkshop) vWorkshop.classList.remove("hidden");
  window.scrollTo(0, 0);
  render2DPreview();
}

// 一键导出 Netlify 静态部署包 (ZIP)

// 构建纯享 3D 展台静态网站包 (完全纯净展示卡牌，与导出的 ZIP 和一键部署 100% 保持一致)
async function buildPureViewerZip() {
  const zip = new JSZip();

  // 1. 生成 4 张最新真实 PNG 图层 (已烘焙构图缩放、位移与模糊)
  const bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
  const subjCvs = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0);
  const textCvs = drawTextCanvas(state);
  const lineCvs = generateLineart(subjCvs);

  const getBlob = (cvs) => new Promise((resolve) => cvs.toBlob(resolve, "image/png"));

  const [bgBlob, subjBlob, textBlob, lineBlob] = await Promise.all([
    getBlob(bgCvs),
    getBlob(subjCvs),
    getBlob(textCvs),
    getBlob(lineCvs)
  ]);

  const assets = zip.folder("assets");
  assets.file("background.png", bgBlob);
  assets.file("subject.png", subjBlob);
  assets.file("text.png", textBlob);
  assets.file("lineart.png", lineBlob);

  // 如果启用了卡面特效，导出特效图层 (直接获取源素材，确保无任何绘制或加载遗漏)
  if (state.cardEffect && state.cardEffect !== "none") {
    try {
      const effSrc = effectSources[state.cardEffect];
      if (effSrc) {
        const fxRes = await fetch(effSrc);
        if (fxRes.ok) {
          const fxBuf = await fxRes.arrayBuffer();
          assets.file("effects.png", fxBuf);
        }
      }
    } catch (effErr) {
      console.warn("Bundle effect texture failed:", effErr);
    }
  }

  // 获取 3D 模型
  const glbRes = await fetch("./assets/card.glb");
  const glbBuf = await glbRes.arrayBuffer();
  assets.file("card.glb", glbBuf);

  // 2. 核心静态网页文件：纯净展台仅需 style.css 与 app.bundle.js
  const [styleRes, appRes] = await Promise.all([
    fetch("./style.css").then((r) => r.text()),
    fetch("./app.bundle.js").then((r) => r.text())
  ]);

  zip.file("style.css", styleRes);
  zip.file("app.bundle.js", appRes);
  try {
    const headersRes = await fetch("./_headers");
    if (headersRes.ok) zip.file("_headers", await headersRes.text());
  } catch(e){}

  // 3. 构建完全纯净的展台 HTML (仅展示 3D 卡牌，无任何工坊、侧边栏、修改或保存功能)
  const cTitle = state.title || "全息卡牌";
  const cSubtitle = state.subtitle || "";
  const cTagline = state.tagline || "";
  const cCollection = state.collection || "个人典藏";
  const cEdition = state.edition || "001 / 001";

  const pureViewerHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="theme-color" content="#fafafa" />
    <link rel="icon" href="data:," />
    <title>${cTitle} · 3D 全息典藏卡</title>
    <link rel="stylesheet" href="./style.css" />
    <script type="module" src="./app.bundle.js"></script>
  </head>
  <body>
    <header class="masthead">
      <a class="wordmark" href="./" aria-label="全息卡牌首页">
        <span class="wordmark-cn">全息卡牌<span class="brand-dot"></span></span>
        <span class="wordmark-en">HOLO ATELIER</span>
      </a>
      <span class="collection-label">${cCollection} <span>/</span> <span id="edition">${cEdition}</span></span>
      <div class="header-actions">
        <button class="icon-button" id="info" aria-label="作品信息" title="作品信息" disabled>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
        </button>
        <button class="icon-button save-button" id="save" aria-label="保存卡片高清图片" title="保存卡片高清图片" disabled>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
      </div>
    </header>

    <main>
      <section class="gallery" aria-label="卡片展台">
        <!-- 展开放大卡牌查看按钮 -->
        <button id="btn-zoom-card" class="btn-card-zoom" type="button" title="展开放大卡牌查看" aria-label="展开放大卡牌查看">
          <svg class="zoom-icon-in" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
          <svg class="zoom-icon-out" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
            <polyline points="4 14 10 14 10 20"></polyline>
            <polyline points="20 10 14 10 14 4"></polyline>
            <line x1="14" y1="10" x2="21" y2="3"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
          <span class="zoom-btn-text">展开放大</span>
        </button>

        <!-- 卡牌左下角：陀螺仪与复位按钮 -->
        <div class="stage-tools-bottom-left">
          <button id="btn-gyro-toggle" class="btn-card-stage-tool" type="button" title="开启/关闭手机重力感应陀螺仪" aria-label="陀螺仪开关">
            <svg class="gyro-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
            </svg>
            <span class="gyro-btn-text">陀螺仪: 关</span>
          </button>

          <button id="btn-recenter-toggle" class="btn-card-stage-tool" type="button" title="开启/关闭滑动松手后自动回正" aria-label="自动回正开关">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <circle cx="12" cy="12" r="8"></circle>
              <line x1="12" y1="2" x2="12" y2="4"></line>
              <line x1="12" y1="20" x2="12" y2="22"></line>
              <line x1="2" y1="12" x2="4" y2="12"></line>
              <line x1="20" y1="12" x2="22" y2="12"></line>
            </svg>
            <span class="recenter-btn-text">自动回正: 关</span>
          </button>

          <button id="btn-reset-view" class="btn-card-stage-tool" type="button" title="复位卡牌视角" aria-label="复位卡牌视角">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
            <span>复位</span>
          </button>
        </div>

        <div class="stage" id="stage" tabindex="0" role="group" aria-label="可旋转的全息卡片">
          <div id="loading" class="loading" role="status">
            <span class="loading-line"></span><span>正在装裱作品</span>
          </div>
        </div>
        <div class="stage-note" aria-hidden="true">
          <span>ART STUDY</span><span id="view-label">01 / FRONT</span>
        </div>
        <div class="parameter-panel" id="parameter-panel" style="display: none !important;">
          <input id="scale" type="range" min="0.5" max="1.8" step="0.02" value="${state.subjectScale}" /><output id="scale-value"></output>
          <input id="depth" type="range" min="-0.45" max="0.6" step="0.01" value="${state.depth}" /><output id="depth-value"></output>
          <input id="diff" type="range" min="0" max="3" step="0.05" value="${state.diff ?? 1.0}" /><output id="diff-value"></output>
          <input id="fx-depth" type="range" min="-0.5" max="0.5" step="0.01" value="0.14" /><output id="fx-depth-value"></output>
          <input id="bg-depth" type="range" min="-0.6" max="0.4" step="0.01" value="${state.bgDepth}" /><output id="bg-depth-value"></output>
          <input id="foil" type="range" min="0" max="1" step="0.01" value="${state.foil}" /><output id="foil-value"></output>
          <span id="finish-name"></span>
        </div>
      </section>

      <section class="artwork-bar" aria-label="作品与材质">
        <div class="artwork-title">
          <div class="title-line">
            <h1 id="card-title">${cTitle}</h1>
            <span id="subtitle">${cSubtitle}</span>
          </div>
          <p id="description">${cTagline}</p>
        </div>
        <div class="face-picker" role="group" aria-label="卡片朝向">
          <button id="front" aria-pressed="true" disabled>正面</button>
          <button id="back" aria-pressed="false" disabled>背面</button>
        </div>
      </section>
    </main>

    <footer class="footer">
      <span>光影之间，自有回响。</span><span>PERSONAL ART COLLECTION</span>
    </footer>

    <dialog id="about" aria-labelledby="about-title">
      <button id="close-about" class="icon-button modal-close" aria-label="关闭作品信息" title="关闭作品信息">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <p class="dialog-mark">全息典藏</p>
      <h2 id="about-title">${cTitle}</h2>
      <p id="about-description">${cSubtitle ? cSubtitle + " · " : ""}全息典藏卡片</p>
      <dl>
        <div><dt>所属系列</dt><dd>${cCollection}</dd></div>
        <div><dt>呈现</dt><dd>3D 全息交互典藏卡</dd></div>
        <div><dt>编号</dt><dd id="about-edition">${cEdition}</dd></div>
      </dl>
    </dialog>
    <div id="notice" role="status" class="notice" hidden></div>
    <script>
      // 纯享展台端卡牌放大居中查看交互
      const zoomBtn = document.getElementById("btn-zoom-card");
      let isExpanded = false;
      if (zoomBtn) {
        const toggleZoom = () => {
          isExpanded = !isExpanded;
          if (isExpanded) {
            document.body.classList.add("is-card-expanded");
            const txt = zoomBtn.querySelector(".zoom-btn-text");
            if (txt) txt.textContent = "还原大小";
            if (window.__holo) {
              if (typeof window.__holo.setZoom === "function") window.__holo.setZoom(1.15);
              if (typeof window.__holo.setCenterOffset === "function") window.__holo.setCenterOffset(1.08);
            }
          } else {
            document.body.classList.remove("is-card-expanded");
            const txt = zoomBtn.querySelector(".zoom-btn-text");
            if (txt) txt.textContent = "展开放大";
            if (window.__holo) {
              if (typeof window.__holo.setZoom === "function") window.__holo.setZoom(1.0);
              if (typeof window.__holo.setCenterOffset === "function") window.__holo.setCenterOffset(0);
            }
          }
          window.dispatchEvent(new Event("resize"));
          if (window.__holo && typeof window.__holo.resize === "function") {
            window.__holo.resize();
          }
        };
        zoomBtn.onclick = toggleZoom;
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && isExpanded) toggleZoom();
        });
      }

      // 纯享展台深度着色器与材质初始化保底守卫
      window.addEventListener("DOMContentLoaded", () => {
        let attempts = 0;
        const checkTimer = setInterval(() => {
          attempts++;
          if (window.__holo && window.__holo.uniforms) {
            clearInterval(checkTimer);
            if (window.__holo.uniforms.uDepth) window.__holo.uniforms.uDepth.value = ${state.depth};
            if (window.__holo.uniforms.uBgDepth) window.__holo.uniforms.uBgDepth.value = ${state.bgDepth};
            if (window.__holo.uniforms.uDiff) window.__holo.uniforms.uDiff.value = ${state.diff ?? 1.0};
            if (window.__holo.uniforms.uFoil) window.__holo.uniforms.uFoil.value = ${state.foil};
            if (window.__holo.uniforms.uFxGlow) window.__holo.uniforms.uFxGlow.value = ${state.fxGlow ?? 0.5};
            if (typeof window.__holo.setFinish === "function") window.__holo.setFinish("${state.finish || 'pearl'}");
          }
          if (attempts > 120) clearInterval(checkTimer);
        }, 50);
      });
    </script>
  </body>
</html>`;

    zip.file("index.html", pureViewerHtml);

  // 4. 配置 JSON
  const configData = {
    title: state.title,
    subtitle: state.subtitle,
    technique: state.technique,
    tagline: state.tagline,
    collection: state.collection,
    edition: state.edition,
    description: `${state.subtitle || ""} 全息典藏卡片`,
    appearance: {
      finish: state.finish || "pearl"
    },
    parameters: {
      subjectScale: 1.0,
      subjectDepth: state.depth,
      backgroundDepth: state.bgDepth,
      diff: state.diff ?? 1.0,
      effectsDepth: 0.14,
      foil: state.foil,
      fxGlow: state.fxGlow ?? 0.5
    },
    safeArea: {
      scale: 1.0,
      offset: [0, 0]
    },
    assets: {
      subject: "./assets/subject.png",
      background: "./assets/background.png",
      text: "./assets/text.png",
      lineart: "./assets/lineart.png",
      model: "./assets/card.glb",
      ...(state.cardEffect && state.cardEffect !== "none" ? { effects: "./assets/effects.png" } : {})
    }
  };
  zip.file("card-config.json", JSON.stringify(configData, null, 2));

  return zip;
}

// 一键导出纯享 3D 展台静态网站包 (ZIP - 仅展示卡牌，无任何 A/B 页面切换、修改或保存功能)
async function exportNetlifyViewerZip(triggerBtn) {
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>📦 正在打包纯享展台...</span>";
  }

  try {
    const zip = await buildPureViewerZip();
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `holo-card-${state.title || "card"}-viewer-netlify.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    showToast("🎉 纯享展台包已生成！拖入 Netlify 即可上线");

    if (triggerBtn) {
      triggerBtn.innerHTML = "<span>✅ 纯享展台包导出成功！</span>";
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origHtml;
      }, 2200);
    }
  } catch (err) {
    console.error("Export Netlify viewer zip error:", err);
    alert("导出纯享展台包失败: " + err.message);
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origHtml;
    }
  }
}

// 一键自动部署至 Netlify 生成 24H 临时独立在线展台
async function deployNetlifyViewer(triggerBtn) {
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  const progressWrap = $("deploy-progress-wrap");
  const progressBar = $("deploy-progress-bar");
  const progressStatus = $("deploy-progress-status");
  const progressPercent = $("deploy-progress-percent");
  const resultBox = $("deploy-result-box");
  const liveUrlInput = $("deploy-live-url");
  const openLink = $("link-open-live-url");
  const claimLink = $("link-claim-live-url");

  const setProgress = (pct, text) => {
    if (progressWrap) progressWrap.style.display = "flex";
    if (progressBar) progressBar.style.width = pct + "%";
    if (progressPercent) progressPercent.textContent = pct + "%";
    if (progressStatus) progressStatus.textContent = text;
  };

  if (resultBox) resultBox.style.display = "none";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>🚀 正在自动化部署中...</span>";
  }

  try {
    // 阶段 1: 打包纯享卡牌 (15% -> 40%)
    setProgress(15, "正在打包纯享 3D 卡牌素材与着色器...");
    const zip = await buildPureViewerZip();

    setProgress(40, "正在压缩生成独立网站包 (ZIP)...");
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    // 阶段 2: 上传至 Netlify 部署接口 (40% -> 85%)
    setProgress(55, "正在连接 Netlify 部署接口...");
    const formData = new FormData();
    formData.append("file", zipBlob, `holo-card-${state.title || "card"}.zip`);

    const progressTimer = setInterval(() => {
      const cur = parseInt(progressBar?.style.width || "55");
      if (cur < 85) setProgress(cur + 5, "正在上传 3D 模型与高清图层至全球边缘节点...");
    }, 400);

    let deployRes = null;
    try {
      const res = await fetch("/api/deploy-temp-site", {
        method: "POST",
        body: formData
      });
      clearInterval(progressTimer);
      deployRes = await res.json();
    } catch (netErr) {
      clearInterval(progressTimer);
      throw new Error("部署服务网络异常: " + netErr.message);
    }

    // 阶段 3: 部署完成展示卡片
    if (deployRes && deployRes.ok && deployRes.url) {
      setProgress(100, "✅ 独立展台已成功部署上线！");
      setTimeout(() => {
        if (progressWrap) progressWrap.style.display = "none";
        if (resultBox) resultBox.style.display = "flex";
        if (liveUrlInput) liveUrlInput.value = deployRes.url;
        if (openLink) openLink.href = deployRes.url;
        if (claimLink && deployRes.claimUrl) {
          claimLink.href = deployRes.claimUrl;
          claimLink.style.display = "flex";
        }
        showToast("🎉 您的 3D 全息卡牌独立展台已成功上线！可一键复制链接");
      }, 500);
    } else {
      // Netlify 接口限流或异常兜底：自动下载纯享 ZIP 并引导用户一键拖拽
      setProgress(100, "已为您准备好纯享展台包！");
      setTimeout(() => {
        if (progressWrap) progressWrap.style.display = "none";
      }, 1000);

      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `holo-card-${state.title || "card"}-viewer-netlify.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      const msg = deployRes?.message || "Netlify 匿名部署接口触发限制";
      alert(`${msg}\n\n已自动为您下载【纯享展台包 (.zip)】，点击下方「直达 Netlify Drop」拖入即可免登录秒级上线独立展台！`);
    }
  } catch (err) {
    console.error("Deploy error:", err);
    if (progressWrap) progressWrap.style.display = "none";
    alert("一键部署失败: " + err.message + "\n\n建议使用下方的「导出纯享展台包 (.zip)」，直接拖入 Netlify Drop 上线。");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = "<span>🚀 一键部署到 Netlify（生成独立预览站）</span>";
    }
  }
}

// 导出包含工坊与展台的完整整套网站部署包 (将当前配置固化为整站默认设置)
async function exportFullWebsiteZip(triggerBtn) {
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>📦 正在打包整站部署包...</span>";
  }

  try {
    const zip = new JSZip();

    // 1. 获取核心源码与样式
    const [indexHtml, styleCss, workshopCss, appJs, siteJs] = await Promise.all([
      fetch("./index.html").then(r => r.text()),
      fetch("./style.css").then(r => r.text()),
      fetch("./workshop.css").then(r => r.text()),
      fetch("./app.bundle.js").then(r => r.text()),
      fetch("./site.bundle.js").then(r => r.text())
    ]);

    zip.file("index.html", indexHtml);
    zip.file("style.css", styleCss);
    zip.file("workshop.css", workshopCss);
    zip.file("app.bundle.js", appJs);
    zip.file("site.bundle.js", siteJs);

    // 2. 将当前最新 state 写入 card-config.json 作为整站默认设置
    const configData = {
      title: state.title || "八奈见杏菜",
      subtitle: state.subtitle || "",
      technique: state.technique || "",
      tagline: state.tagline || "",
      edition: state.edition || "001 / 001",
      collection: state.collection || "文学部",
      description: `${state.subtitle || ""} 全息典藏卡片`,
      appearance: {
        finish: state.finish || "pearl",
        borderStyle: state.borderStyle || "classic-gold",
        colorTheme: state.colorTheme || "gold",
        cardEffect: state.cardEffect || "none"
      },
      parameters: {
        subjectScale: state.subjectScale ?? 1.0,
        subjectX: state.subjectX ?? 0,
        subjectY: state.subjectY ?? 0,
        bgScale: state.bgScale ?? 1.0,
        bgX: state.bgX ?? 0,
        bgY: state.bgY ?? 0,
        bgBlur: state.bgBlur ?? 0,
        subjectDepth: state.depth ?? 0.32,
        backgroundDepth: state.bgDepth ?? -0.18,
        diff: state.diff ?? 1.0,
        effectsDepth: 0.14,
        foil: state.foil ?? 0.52,
        fxGlow: state.fxGlow ?? 0.5
      },
      safeArea: {
        scale: 1.0,
        offset: [0, 0]
      },
      assets: {
        subject: "./assets/subject.png",
        background: "./assets/background.png",
        text: "./assets/text.png",
        lineart: "./assets/lineart.png",
        model: "./assets/card.glb",
        ...(state.cardEffect && state.cardEffect !== "none" ? { effects: "./assets/effects.png" } : {})
      }
    };
    zip.file("card-config.json", JSON.stringify(configData, null, 2));

    // 3. 打包资产文件
    const assets = zip.folder("assets");
    const [glbBuf, lineBlob, textBlob] = await Promise.all([
      fetch("./assets/card.glb").then(r => r.arrayBuffer()),
      fetch("./assets/lineart.png").then(r => r.blob()),
      fetch("./assets/text.png").then(r => r.blob())
    ]);
    assets.file("card.glb", glbBuf);
    assets.file("lineart.png", lineBlob);
    assets.file("text.png", textBlob);

    // 如果用户有自定义的主体与背景，打包当前主体与背景；否则读取当前资产
    if (rawSubjectImg) {
      const sCvs = document.createElement("canvas");
      sCvs.width = rawSubjectImg.naturalWidth || rawSubjectImg.width || 1024;
      sCvs.height = rawSubjectImg.naturalHeight || rawSubjectImg.height || 1536;
      sCvs.getContext("2d").drawImage(rawSubjectImg, 0, 0);
      const sBlob = await new Promise(res => sCvs.toBlob(res, "image/png"));
      assets.file("subject.png", sBlob);
    } else {
      const sRes = await fetch("./assets/subject.png");
      assets.file("subject.png", await sRes.blob());
    }

    if (rawBgImg) {
      const bCvs = document.createElement("canvas");
      bCvs.width = rawBgImg.naturalWidth || rawBgImg.width || 1024;
      bCvs.height = rawBgImg.naturalHeight || rawBgImg.height || 1536;
      bCvs.getContext("2d").drawImage(rawBgImg, 0, 0);
      const bBlob = await new Promise(res => bCvs.toBlob(res, "image/png"));
      assets.file("background.png", bBlob);
    } else {
      const bRes = await fetch("./assets/background.png");
      assets.file("background.png", await bRes.blob());
    }

    // 打包特效素材
    const effectsFolder = assets.folder("effects");
    for (const [k, src] of Object.entries(effectSources)) {
      try {
        const efRes = await fetch(src);
        if (efRes.ok) {
          effectsFolder.file(src.replace("./assets/effects/", ""), await efRes.arrayBuffer());
        }
      } catch (e) {}
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `holo-card-${state.title || "website"}-full-site.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    showToast("🎉 整套网站部署包已生成！部署后默认呈现当前设置");
    if (triggerBtn) {
      triggerBtn.innerHTML = "<span>✅ 整站部署包导出成功！</span>";
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origHtml;
      }, 2200);
    }
  } catch (err) {
    console.error("Export full site failed:", err);
    alert("导出整站失败: " + err.message);
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origHtml;
    }
  }
}



// 绑定侧边栏表单组件与双向同步
function bindSidebarInputs(prefix, isPageB = false) {
  // 1. 文字输入
  const textBindings = [
    ["title", "title"],
    ["subtitle", "subtitle"],
    ["collection", "collection"],
    ["technique", "technique"],
    ["tagline", "tagline"],
    ["edition", "edition"]
  ];

  textBindings.forEach(([key, stateProp]) => {
    const el = $(prefix + "-" + key);
    if (!el) return;
    el.value = state[stateProp];
    el.oninput = (e) => {
      state[stateProp] = e.target.value;
      // 同步另一个侧边栏
      const otherPrefix = prefix === "ws" ? "b" : "ws";
      const otherEl = $(otherPrefix + "-" + key);
      if (otherEl) otherEl.value = e.target.value;

      render2DPreview();
      if (isPageB) syncTo3D();
    };
  });

  // 2. 边框与配色
  const borderEl = $(prefix + "-border");
  if (borderEl) {
    borderEl.value = state.borderStyle;
    borderEl.onchange = (e) => {
      state.borderStyle = e.target.value;
      const other = $(prefix === "ws" ? "b-border" : "ws-border");
      if (other) other.value = e.target.value;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const themeEl = $(prefix + "-theme");
  if (themeEl) {
    themeEl.value = state.colorTheme;
    themeEl.onchange = (e) => {
      state.colorTheme = e.target.value;
      const other = $(prefix === "ws" ? "b-theme" : "ws-theme");
      if (other) other.value = e.target.value;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  // 3. 主体位置微调
  const sScale = $(prefix + "-subject-scale");
  const sScaleVal = $(prefix + "-val-scale");
  if (sScale) {
    sScale.value = state.subjectScale;
    if (sScaleVal) sScaleVal.textContent = state.subjectScale.toFixed(2) + "x";
    sScale.oninput = (e) => {
      state.subjectScale = parseFloat(e.target.value);
      if (sScaleVal) sScaleVal.textContent = state.subjectScale.toFixed(2) + "x";
      const other = $(prefix === "ws" ? "b-subject-scale" : "ws-subject-scale");
      const otherVal = $(prefix === "ws" ? "b-val-scale" : "ws-val-scale");
      if (other) other.value = state.subjectScale;
      if (otherVal) otherVal.textContent = sScaleVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const sX = $(prefix + "-subject-x");
  const sXVal = $(prefix + "-val-x");
  if (sX) {
    sX.value = state.subjectX;
    if (sXVal) sXVal.textContent = state.subjectX + "px";
    sX.oninput = (e) => {
      state.subjectX = parseInt(e.target.value);
      if (sXVal) sXVal.textContent = state.subjectX + "px";
      const other = $(prefix === "ws" ? "b-subject-x" : "ws-subject-x");
      const otherVal = $(prefix === "ws" ? "b-val-x" : "ws-val-x");
      if (other) other.value = state.subjectX;
      if (otherVal) otherVal.textContent = sXVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const sY = $(prefix + "-subject-y");
  const sYVal = $(prefix + "-val-y");
  if (sY) {
    sY.value = state.subjectY;
    if (sYVal) sYVal.textContent = state.subjectY + "px";
    sY.oninput = (e) => {
      state.subjectY = parseInt(e.target.value);
      if (sYVal) sYVal.textContent = state.subjectY + "px";
      const other = $(prefix === "ws" ? "b-subject-y" : "ws-subject-y");
      const otherVal = $(prefix === "ws" ? "b-val-y" : "ws-val-y");
      if (other) other.value = state.subjectY;
      if (otherVal) otherVal.textContent = sYVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const resetSubj = $(prefix + "-reset-subj-pos");
  if (resetSubj) {
    resetSubj.onclick = () => {
      state.subjectScale = 1.0;
      state.subjectX = 0;
      state.subjectY = 0;
      ["ws", "b"].forEach((p) => {
        const sc = $(p + "-subject-scale");
        const scV = $(p + "-val-scale");
        const x = $(p + "-subject-x");
        const xV = $(p + "-val-x");
        const y = $(p + "-subject-y");
        const yV = $(p + "-val-y");
        if (sc) sc.value = 1.0;
        if (scV) scV.textContent = "1.00x";
        if (x) x.value = 0;
        if (xV) xV.textContent = "0px";
        if (y) y.value = 0;
        if (yV) yV.textContent = "0px";
      });
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  // 4. 背景构图微调
  const bScale = $(prefix + "-bg-scale");
  const bScaleVal = $(prefix + "-val-bg-scale");
  if (bScale) {
    bScale.value = state.bgScale;
    if (bScaleVal) bScaleVal.textContent = state.bgScale.toFixed(2) + "x";
    bScale.oninput = (e) => {
      state.bgScale = parseFloat(e.target.value);
      if (bScaleVal) bScaleVal.textContent = state.bgScale.toFixed(2) + "x";
      const other = $(prefix === "ws" ? "b-bg-scale" : "ws-bg-scale");
      const otherVal = $(prefix === "ws" ? "b-val-bg-scale" : "ws-val-bg-scale");
      if (other) other.value = state.bgScale;
      if (otherVal) otherVal.textContent = bScaleVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const bX = $(prefix + "-bg-x");
  const bXVal = $(prefix + "-val-bg-x");
  if (bX) {
    bX.value = state.bgX;
    if (bXVal) bXVal.textContent = state.bgX + "px";
    bX.oninput = (e) => {
      state.bgX = parseInt(e.target.value);
      if (bXVal) bXVal.textContent = state.bgX + "px";
      const other = $(prefix === "ws" ? "b-bg-x" : "ws-bg-x");
      const otherVal = $(prefix === "ws" ? "b-val-bg-x" : "ws-val-bg-x");
      if (other) other.value = state.bgX;
      if (otherVal) otherVal.textContent = bXVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const bY = $(prefix + "-bg-y");
  const bYVal = $(prefix + "-val-bg-y");
  if (bY) {
    bY.value = state.bgY;
    if (bYVal) bYVal.textContent = state.bgY + "px";
    bY.oninput = (e) => {
      state.bgY = parseInt(e.target.value);
      if (bYVal) bYVal.textContent = state.bgY + "px";
      const other = $(prefix === "ws" ? "b-bg-y" : "ws-bg-y");
      const otherVal = $(prefix === "ws" ? "b-val-bg-y" : "ws-val-bg-y");
      if (other) other.value = state.bgY;
      if (otherVal) otherVal.textContent = bYVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const bBlur = $(prefix + "-bg-blur");
  const bBlurVal = $(prefix + "-val-bg-blur");
  if (bBlur) {
    bBlur.value = state.bgBlur;
    if (bBlurVal) bBlurVal.textContent = state.bgBlur + "px";
    bBlur.oninput = (e) => {
      state.bgBlur = parseInt(e.target.value);
      if (bBlurVal) bBlurVal.textContent = state.bgBlur + "px";
      const other = $(prefix === "ws" ? "b-bg-blur" : "ws-bg-blur");
      const otherVal = $(prefix === "ws" ? "b-val-bg-blur" : "ws-val-bg-blur");
      if (other) other.value = state.bgBlur;
      if (otherVal) otherVal.textContent = bBlurVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  const resetBg = $(prefix + "-reset-bg-pos");
  if (resetBg) {
    resetBg.onclick = () => {
      state.bgScale = 1.0;
      state.bgX = 0;
      state.bgY = 0;
      state.bgBlur = 0;
      ["ws", "b"].forEach((p) => {
        const sc = $(p + "-bg-scale");
        const scV = $(p + "-val-bg-scale");
        const x = $(p + "-bg-x");
        const xV = $(p + "-val-bg-x");
        const y = $(p + "-bg-y");
        const yV = $(p + "-val-bg-y");
        const bl = $(p + "-bg-blur");
        const blV = $(p + "-val-bg-blur");
        if (sc) sc.value = 1.0;
        if (scV) scV.textContent = "1.00x";
        if (x) x.value = 0;
        if (xV) xV.textContent = "0px";
        if (y) y.value = 0;
        if (yV) yV.textContent = "0px";
        if (bl) bl.value = 0;
        if (blV) blV.textContent = "0px";
      });
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }

  // 5. 景深与全息参数
  const depth = $(prefix + "-depth");
  const depthVal = $(prefix + "-val-depth");
  if (depth) {
    depth.value = state.depth;
    if (depthVal) depthVal.textContent = state.depth.toFixed(2);
    depth.oninput = (e) => {
      state.depth = parseFloat(e.target.value);
      if (depthVal) depthVal.textContent = state.depth.toFixed(2);
      const other = $(prefix === "ws" ? "b-depth" : "ws-depth");
      const otherVal = $(prefix === "ws" ? "b-val-depth" : "ws-val-depth");
      if (other) other.value = state.depth;
      if (otherVal) otherVal.textContent = depthVal.textContent;
      if (isPageB) syncTo3D();
    };
  }

  const bgDepth = $(prefix + "-holo-depth");
  const bgDepthVal = $(prefix + "-val-holo-depth");
  if (bgDepth) {
    bgDepth.value = state.bgDepth;
    if (bgDepthVal) bgDepthVal.textContent = state.bgDepth.toFixed(2);
    bgDepth.oninput = (e) => {
      state.bgDepth = parseFloat(e.target.value);
      if (bgDepthVal) bgDepthVal.textContent = state.bgDepth.toFixed(2);
      const other = $(prefix === "ws" ? "b-holo-depth" : "ws-holo-depth");
      const otherVal = $(prefix === "ws" ? "b-val-holo-depth" : "ws-val-holo-depth");
      if (other) other.value = state.bgDepth;
      if (otherVal) otherVal.textContent = bgDepthVal.textContent;
      if (isPageB) syncTo3D();
    };
  }

  // 4.5. 转动与晃动差速 (0.0x ~ 3.0x)
  const diffEl = $(prefix + "-diff");
  const diffVal = $(prefix + "-val-diff");
  if (diffEl) {
    diffEl.value = state.diff ?? 1.0;
    if (diffVal) diffVal.textContent = (state.diff ?? 1.0).toFixed(2) + "x";
    diffEl.oninput = (e) => {
      state.diff = parseFloat(e.target.value);
      if (diffVal) diffVal.textContent = state.diff.toFixed(2) + "x";
      const other = $(prefix === "ws" ? "b-diff" : "ws-diff");
      const otherVal = $(prefix === "ws" ? "b-val-diff" : "ws-val-diff");
      if (other) other.value = state.diff;
      if (otherVal) otherVal.textContent = diffVal.textContent;
      if (isPageB) syncTo3D();
    };
  }

  const foil = $(prefix + "-foil");
  const foilVal = $(prefix + "-val-foil");
  if (foil) {
    foil.value = state.foil;
    if (foilVal) foilVal.textContent = Math.round(state.foil * 100) + "%";
    foil.oninput = (e) => {
      state.foil = parseFloat(e.target.value);
      if (foilVal) foilVal.textContent = Math.round(state.foil * 100) + "%";
      const other = $(prefix === "ws" ? "b-foil" : "ws-foil");
      const otherVal = $(prefix === "ws" ? "b-val-foil" : "ws-val-foil");
      if (other) other.value = state.foil;
      if (otherVal) otherVal.textContent = foilVal.textContent;
      if (isPageB) syncTo3D();
    };
  }

  // 6. 特效辉光程度调节 (从纯净平光 0% 到璀璨发光 100%)
  const fxGlow = $(prefix + "-fx-glow");
  const fxGlowVal = $(prefix + "-val-fx-glow");
  if (fxGlow) {
    fxGlow.value = state.fxGlow ?? 0.5;
    if (fxGlowVal) fxGlowVal.textContent = Math.round((state.fxGlow ?? 0.5) * 100) + "%";
    fxGlow.oninput = (e) => {
      state.fxGlow = parseFloat(e.target.value);
      if (fxGlowVal) fxGlowVal.textContent = Math.round(state.fxGlow * 100) + "%";
      const other = $(prefix === "ws" ? "b-fx-glow" : "ws-fx-glow");
      const otherVal = $(prefix === "ws" ? "b-val-fx-glow" : "ws-val-fx-glow");
      if (other) other.value = state.fxGlow;
      if (otherVal) otherVal.textContent = fxGlowVal.textContent;
      render2DPreview();
      if (isPageB) syncTo3D();
    };
  }
}


// 初始化防误触锁定功能 (需点击一次激活才能滑动，解决手机滚动误触痛点)
function initTouchGuards() {
  const rows = document.querySelectorAll(".slider-row");
  let activeTimer = null;

  function lockAll() {
    rows.forEach((r) => {
      r.classList.remove("active-unlocked");
      r.classList.add("touch-locked");
      const pill = r.querySelector(".lock-pill");
      if (pill) pill.textContent = "🔒 点按滑动";
    });
    $("ws-sidebar")?.classList.remove("sidebar-tweaking");
    $("b-sidebar")?.classList.remove("sidebar-tweaking");
  }

  rows.forEach((row) => {
    row.classList.add("touch-locked");

    const labelRow = row.querySelector(".slider-label-row");
    if (labelRow && !labelRow.querySelector(".lock-pill")) {
      const pill = document.createElement("span");
      pill.className = "lock-pill";
      pill.textContent = "🔒 点按滑动";
      labelRow.appendChild(pill);
    }

    const input = row.querySelector("input[type='range']");

    row.addEventListener("click", (e) => {
      if (row.classList.contains("active-unlocked")) return;

      lockAll();
      row.classList.remove("touch-locked");
      row.classList.add("active-unlocked");

      const pill = row.querySelector(".lock-pill");
      if (pill) pill.textContent = "🔓 调节中...";

      const currentSidebar = row.closest(".glass-sidebar");
      if (currentSidebar) currentSidebar.classList.add("sidebar-tweaking");

      clearTimeout(activeTimer);
      activeTimer = setTimeout(lockAll, 4000);
    });

    if (input) {
      input.addEventListener("input", () => {
        clearTimeout(activeTimer);
        activeTimer = setTimeout(lockAll, 4000);
      });
      input.addEventListener("change", () => {
        clearTimeout(activeTimer);
        activeTimer = setTimeout(lockAll, 2000);
      });
      input.addEventListener("pointerup", () => {
        clearTimeout(activeTimer);
        activeTimer = setTimeout(lockAll, 2500);
      });
      input.addEventListener("touchend", () => {
        clearTimeout(activeTimer);
        activeTimer = setTimeout(lockAll, 2500);
      });
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".slider-row") && !e.target.closest(".btn-toggle-opacity")) {
      lockAll();
    }
  });
}

// 初始化透明度切换
function initOpacityToggles() {
  const wsToggle = $("btn-toggle-opacity-ws");
  const bToggle = $("btn-toggle-opacity-b");

  if (wsToggle) {
    wsToggle.onclick = () => {
      const sb = $("ws-sidebar");
      sb?.classList.toggle("ultra-transparent");
      wsToggle.textContent = sb?.classList.contains("ultra-transparent") ? "👁️ 磨砂半透" : "👁️ 极透视";
    };
  }
  if (bToggle) {
    bToggle.onclick = () => {
      const sb = $("b-sidebar");
      sb?.classList.toggle("ultra-transparent");
      bToggle.textContent = sb?.classList.contains("ultra-transparent") ? "👁️ 磨砂半透" : "👁️ 极透视";
    };
  }
}


// 初始化侧边栏折叠/滑出控制与外部点击自动缩回
function initDrawerToggles() {
  const wsSidebar = $("ws-sidebar");
  const wsOpenBtn = $("btn-open-ws-drawer");
  const wsHeaderBtn = $("btn-open-ws-drawer-header");
  const wsCloseBtn = $("btn-close-ws-drawer");

  const bSidebar = $("b-sidebar");
  const bFloatBtn = $("btn-open-b-drawer");
  const bHeaderBtn = $("btn-open-b-drawer-header");
  const bCloseBtn = $("btn-close-b-drawer");

  const setBackdrops = (open) => {
    document.querySelectorAll(".sidebar-backdrop").forEach((b) => {
      if (open) b.classList.add("open");
      else b.classList.remove("open");
    });
  };

  const openWs = () => {
    wsSidebar?.classList.add("open");
    setBackdrops(true);
  };
  const closeWs = () => {
    wsSidebar?.classList.remove("open");
    setBackdrops(false);
  };

  const openB = () => {
    bSidebar?.classList.add("open");
    setBackdrops(true);
  };
  const closeB = () => {
    bSidebar?.classList.remove("open");
    setBackdrops(false);
  };

  if (wsOpenBtn) wsOpenBtn.onclick = openWs;
  if (wsHeaderBtn) wsHeaderBtn.onclick = openWs;
  if (wsCloseBtn) wsCloseBtn.onclick = closeWs;

  if (bFloatBtn) bFloatBtn.onclick = openB;
  if (bHeaderBtn) bHeaderBtn.onclick = openB;
  if (bCloseBtn) bCloseBtn.onclick = closeB;

  // 遮罩层点击关闭
  const backdrops = document.querySelectorAll(".sidebar-backdrop");
  backdrops.forEach((bd) => {
    bd.onclick = () => {
      closeWs();
      closeB();
    };
  });

  // 全局点击/触摸非侧边栏区域自动缩回 (针对手机端露出的卡片区域与背景)
  document.addEventListener("pointerdown", (e) => {
    const isInsideSidebar = e.target.closest(".glass-sidebar");
    const isTriggerBtn = e.target.closest("#btn-open-ws-drawer-header") || e.target.closest("#btn-open-b-drawer-header") || e.target.closest(".floating-tool-pill");
    
    if (!isInsideSidebar && !isTriggerBtn) {
      if (wsSidebar?.classList.contains("open")) closeWs();
      if (bSidebar?.classList.contains("open")) closeB();
    }
  });
}


// 初始化卡面特效控制器
function setCardEffect(eff) {
  state.cardEffect = eff || "none";
  document.querySelectorAll("[data-effect]").forEach((b) => {
    const isActive = b.dataset.effect === state.cardEffect;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", String(isActive));
  });
  document.querySelectorAll(".effect-name-val").forEach((el) => {
    el.textContent = effectNames[state.cardEffect] || state.cardEffect;
  });
  render2DPreview();
  syncTo3D();
}

function initEffectControls() {
  document.querySelectorAll("[data-effect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setCardEffect(btn.dataset.effect);
    });
  });
}

// 卡面物理材质统一切换函数 (支持 Page A 与 Page B 双向完全同步)
function applyFinishUI(f) {
  if (!f) return;
  state.finish = f;
  const finishNames = { pearl: "珠光", silver: "银箔", gold: "烫金", original: "原画", matte: "磨砂", gloss: "清漆", brushed: "拉丝", holo: "光栅" };
  document.querySelectorAll("[data-finish]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.finish === f));
  });
  document.querySelectorAll(".finish-name-val").forEach((el) => {
    el.textContent = finishNames[f] || f;
  });
  if ($("finish-name")) $("finish-name").textContent = finishNames[f] || f;
  if ($("b-foil")) $("b-foil").disabled = f === "original";
  if ($("ws-foil")) $("ws-foil").disabled = f === "original";
  if (window.__holo && typeof window.__holo.setFinish === "function") {
    window.__holo.setFinish(f);
  }
}

// 初始化卡面质感材质选择器
function initFinishControls() {
  document.querySelectorAll("[data-finish]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyFinishUI(btn.dataset.finish);
    });
  });
}


// ==========================================================================
// 本地牌库 (Card Deck Vault) 核心引擎 - 基于 IndexedDB 大容量无损存储
// ==========================================================================

function showToast(msg, duration = 2800) {
  const toast = $("holo-toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}

function imageToBlob(img) {
  if (!img) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width || 1024;
      c.height = img.naturalHeight || img.height || 1536;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      c.toBlob((blob) => resolve(blob), "image/png");
    } catch (e) {
      console.warn("imageToBlob error:", e);
      resolve(null);
    }
  });
}

function blobToImage(blob) {
  if (!blob) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    } catch (e) {
      console.warn("blobToImage error:", e);
      resolve(null);
    }
  });
}

function blobToDataUrl(blob) {
  if (!blob) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return Promise.resolve(null);
  }
  return fetch(dataUrl).then((r) => r.blob()).catch(() => null);
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportCurrentCardJson(triggerBtn) {
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>📤 正在导出卡牌...</span>";
  }

  try {
    const previewCanvas = $("preview-canvas");
    let thumbDataUrl = "";
    if (previewCanvas) {
      const tc = document.createElement("canvas");
      tc.width = 240;
      tc.height = 360;
      const tCtx = tc.getContext("2d");
      tCtx.drawImage(previewCanvas, 0, 0, 240, 360);
      thumbDataUrl = tc.toDataURL("image/jpeg", 0.85);
    }

    const [subjBlob, bgBlob] = await Promise.all([
      imageToBlob(rawSubjectImg),
      imageToBlob(rawBgImg)
    ]);
    const [subjUrl, bgUrl] = await Promise.all([
      blobToDataUrl(subjBlob),
      blobToDataUrl(bgBlob)
    ]);

    const cName = state.title || "未命名卡牌";
    const exportData = {
      version: "1.0",
      type: "single",
      exportedAt: Date.now(),
      card: {
        id: "card_" + Date.now(),
        createdAt: Date.now(),
        name: cName,
        title: cName,
        subtitle: state.subtitle || "",
        collection: state.collection || "文学部",
        technique: state.technique || "",
        tagline: state.tagline || "",
        edition: state.edition || "001 / 001",
        borderStyle: state.borderStyle || "classic-gold",
        colorTheme: state.colorTheme || "gold",
        finish: state.finish || "pearl",
        cardEffect: state.cardEffect || "none",
        subjectScale: state.subjectScale,
        subjectX: state.subjectX,
        subjectY: state.subjectY,
        bgScale: state.bgScale,
        bgX: state.bgX,
        bgY: state.bgY,
        bgBlur: state.bgBlur,
        depth: state.depth,
        bgDepth: state.bgDepth,
        foil: state.foil,
        fxGlow: state.fxGlow ?? 0.5,
        thumbDataUrl,
        subjectDataUrl: subjUrl,
        bgDataUrl: bgUrl
      }
    };

    downloadJson(exportData, "holo-card-" + cName + ".json");
    showToast("🎉 卡牌「" + cName + "」已成功导出！可在牌库一键导入");

    if (triggerBtn) {
      triggerBtn.innerHTML = "<span>✅ 导出卡牌成功！</span>";
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origHtml;
      }, 2000);
    }
  } catch (err) {
    console.error("Export current card error:", err);
    alert("导出卡牌失败: " + err.message);
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origHtml;
    }
  }
}

async function exportSingleCard(id) {
  try {
    const card = await dbGetCard(id);
    if (!card) return;
    const [subjUrl, bgUrl] = await Promise.all([
      blobToDataUrl(card.subjectBlob),
      blobToDataUrl(card.bgBlob)
    ]);
    const exportData = {
      version: "1.0",
      type: "single",
      exportedAt: Date.now(),
      card: {
        ...card,
        subjectBlob: null,
        bgBlob: null,
        subjectDataUrl: subjUrl,
        bgDataUrl: bgUrl
      }
    };
    const cName = card.name || card.title || "card";
    downloadJson(exportData, "holo-card-" + cName + ".json");
    showToast("已导出「" + cName + "」JSON 文件");
  } catch (err) {
    console.error("Export single card error:", err);
    alert("导出卡牌失败: " + err.message);
  }
}

async function exportAllCards() {
  try {
    const cards = await dbGetAllCards();
    if (cards.length === 0) {
      alert("当前牌库为空，没有卡牌可导出！");
      return;
    }
    showToast("正在打包导出 " + cards.length + " 张卡牌...");
    const exportedCards = await Promise.all(
      cards.map(async (card) => {
        const [subjUrl, bgUrl] = await Promise.all([
          blobToDataUrl(card.subjectBlob),
          blobToDataUrl(card.bgBlob)
        ]);
        return {
          ...card,
          subjectBlob: null,
          bgBlob: null,
          subjectDataUrl: subjUrl,
          bgDataUrl: bgUrl
        };
      })
    );
    const backupData = {
      version: "1.0",
      type: "deck_backup",
      exportedAt: Date.now(),
      cards: exportedCards
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadJson(backupData, "holo-cards-backup-" + dateStr + ".json");
    showToast("🎉 成功导出全部 " + cards.length + " 张卡牌备份！");
  } catch (err) {
    console.error("Export all cards error:", err);
    alert("导出牌库失败: " + err.message);
  }
}

async function importCardsFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    let incomingCards = [];
    if (Array.isArray(data)) {
      incomingCards = data;
    } else if (data.type === "deck_backup" && Array.isArray(data.cards)) {
      incomingCards = data.cards;
    } else if (data.type === "single" && data.card) {
      incomingCards = [data.card];
    } else if (data.title || data.id) {
      incomingCards = [data];
    } else {
      throw new Error("无法识别的卡牌 JSON 数据格式");
    }

    if (incomingCards.length === 0) {
      alert("文件中没有找到有效的卡牌数据！");
      return;
    }

    showToast("正在导入 " + incomingCards.length + " 张卡牌...");

    for (const raw of incomingCards) {
      const [subjBlob, bgBlob] = await Promise.all([
        raw.subjectDataUrl ? dataUrlToBlob(raw.subjectDataUrl) : Promise.resolve(raw.subjectBlob || null),
        raw.bgDataUrl ? dataUrlToBlob(raw.bgDataUrl) : Promise.resolve(raw.bgBlob || null)
      ]);

      const isSubjCustom = raw.isCustomSubject !== undefined ? raw.isCustomSubject : (raw.subjectDataUrl ? true : !isDefaultSubjectBlob(subjBlob));
      const isBgCustom = raw.isCustomBg !== undefined ? raw.isCustomBg : (raw.bgDataUrl ? true : !isDefaultBgBlob(bgBlob));
      const cardId = "card_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const cardRecord = {
        ...raw,
        id: cardId,
        name: raw.name || raw.title || "导入卡牌",
        title: raw.title || raw.name || "导入卡牌",
        subjectBlob: subjBlob,
        bgBlob: bgBlob,
        isCustomSubject: isSubjCustom,
        isCustomBg: isBgCustom,
        subjectDataUrl: undefined,
        bgDataUrl: undefined,
        createdAt: raw.createdAt || Date.now()
      };

      await dbSaveCard(cardRecord);
    }

    await renderDeckGrid();
    await updateDeckBadge();
    showToast("✅ 成功导入 " + incomingCards.length + " 张卡牌！");
  } catch (err) {
    console.error("Import cards error:", err);
    alert("导入卡牌失败: " + err.message);
  }
}

const DB_NAME = "HoloCardVaultDB";
const DB_VERSION = 1;
const STORE_NAME = "cards";

function openDeckDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSaveCard(card) {
  const db = await openDeckDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(card);
    req.onsuccess = () => resolve(card);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAllCards() {
  const db = await openDeckDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetCard(id) {
  const db = await openDeckDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDeleteCard(id) {
  const db = await openDeckDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function updateDeckBadge() {
  try {
    const cards = await dbGetAllCards();
    const count = cards.length;
    const badge = $("deck-badge");
    if (badge) badge.textContent = String(count);
    const mCount = $("deck-modal-count");
    if (mCount) mCount.textContent = count + " 张卡牌";
  } catch (e) {
    console.warn("Update deck badge error:", e);
  }
}

async function saveCurrentCardToDeck(triggerBtn) {
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>💾 正在保存...</span>";
  }

  try {
    // 确保从当前 UI 与 3D 引擎精准捕获最新材质与特效
    let curFinish = state.finish;
    if (window.__holo && typeof window.__holo.getState === "function") {
      const hState = window.__holo.getState();
      if (hState && hState.finish) curFinish = hState.finish;
    }
    const pressedSwatch = document.querySelector("[data-finish][aria-pressed='true']");
    if (pressedSwatch && pressedSwatch.dataset.finish) {
      curFinish = pressedSwatch.dataset.finish;
    }
    state.finish = curFinish || "pearl";

    let curEffect = state.cardEffect;
    const activePill = document.querySelector("[data-effect].active") || document.querySelector("[data-effect][aria-pressed='true']");
    if (activePill && activePill.dataset.effect) {
      curEffect = activePill.dataset.effect;
    }
    state.cardEffect = curEffect || "none";

    // 重新合成一次 2D 画布，确保缩略图包含最新人物、背景与特效层
    render2DPreview();

    // 1. 生成 240x360 缩略图
    const previewCanvas = $("preview-canvas");
    let thumbDataUrl = "";
    if (previewCanvas) {
      const tc = document.createElement("canvas");
      tc.width = 240;
      tc.height = 360;
      const tCtx = tc.getContext("2d");
      tCtx.drawImage(previewCanvas, 0, 0, 240, 360);
      thumbDataUrl = tc.toDataURL("image/jpeg", 0.85);
    }

    // 2. 将主体与背景图转为 Blob 永久保留
    const [subjBlob, bgBlob] = await Promise.all([
      imageToBlob(rawSubjectImg),
      imageToBlob(rawBgImg)
    ]);

    // 3. 构建卡牌数据体 (完整持久化保存材质、特效及素材来源标识)
    const cardId = "card_" + Date.now();
    const isSubjCustom = Boolean(hasCustomSubject);
    const isBgCustom = Boolean(hasCustomBg);
    const cardData = {
      id: cardId,
      createdAt: Date.now(),
      name: state.title || "未命名卡牌",
      title: state.title || "未命名卡牌",
      subtitle: state.subtitle || "",
      collection: state.collection || "文学部",
      technique: state.technique || "",
      tagline: state.tagline || "",
      edition: state.edition || "001 / 001",
      borderStyle: state.borderStyle || "classic-gold",
      colorTheme: state.colorTheme || "gold",
      finish: state.finish,
      cardEffect: state.cardEffect,
      subjectScale: state.subjectScale,
      subjectX: state.subjectX,
      subjectY: state.subjectY,
      bgScale: state.bgScale,
      bgX: state.bgX,
      bgY: state.bgY,
      bgBlur: state.bgBlur,
      depth: state.depth,
      bgDepth: state.bgDepth,
      diff: state.diff ?? 1.0,
      foil: state.foil,
      thumbDataUrl,
      subjectBlob: subjBlob,
      bgBlob: bgBlob,
      isCustomSubject: isSubjCustom,
      isCustomBg: isBgCustom
    };

    await dbSaveCard(cardData);
    activeCardId = cardId;
    await updateDeckBadge();

    showToast("🎉 卡牌「" + cardData.title + "」已成功保存至您的牌库！");

    if (triggerBtn) {
      triggerBtn.innerHTML = "<span>✅ 已保存至牌库</span>";
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origHtml;
      }, 2200);
    }
  } catch (err) {
    console.error("Save to deck failed:", err);
    alert("保存到牌库失败: " + err.message);
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origHtml;
    }
  }
}

async function openDeckModal() {
  const modal = $("modal-deck");
  if (!modal) return;
  modal.classList.remove("hidden");
  await renderDeckGrid();
}

function closeDeckModal() {
  const modal = $("modal-deck");
  if (modal) modal.classList.add("hidden");
}

// 公告栏版本标识（更新此版本号可让所有用户再次自动弹出）
const NOTICE_VERSION = "20261013-v1";

function openNoticeModal() {
  const modal = $("modal-notice");
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function closeNoticeModal() {
  const modal = $("modal-notice");
  if (modal) {
    modal.classList.add("hidden");
  }
  localStorage.setItem("holo_card_notice_seen_ver", NOTICE_VERSION);
}

function checkAutoNotice() {
  const seenVer = localStorage.getItem("holo_card_notice_seen_ver");
  if (seenVer !== NOTICE_VERSION) {
    setTimeout(openNoticeModal, 350);
  }
}

// 资源安全加载辅助函数
function loadSafeAssetImage(src, onDone) {
  const img = new Image();
  let retryCount = 0;
  img.onload = () => {
    onDone(img);
  };
  img.onerror = () => {
    if (retryCount < 4) {
      retryCount++;
      setTimeout(() => {
        img.src = src + (src.includes("?") ? "&" : "?") + "t=" + Date.now();
      }, 600 * retryCount);
    } else {
      console.warn("Image load failed after retries:", src);
      onDone(null);
    }
  };
  img.src = src;
}

// 确保 3D 展台纹理与状态精准同步（解决网络延迟下 3D 引擎异步初始化完成较晚导致配置被覆盖的竞态问题）
function ensureSyncTo3D() {
  syncTo3D();
  let retries = 0;
  const interval = setInterval(() => {
    retries++;
    if (window.__holo && window.__holo.ready) {
      syncTo3D();
      if (retries >= 4) clearInterval(interval);
    } else if (retries > 60) {
      clearInterval(interval);
    }
  }, 150);
}
async function renderDeckGrid() {
  const grid = $("deck-cards-grid");
  const empty = $("deck-empty-state");
  if (!grid || !empty) return;

  grid.innerHTML = "";
  const cards = await dbGetAllCards();
  cards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  await updateDeckBadge();

  if (cards.length === 0) {
    empty.style.display = "flex";
    grid.style.display = "none";
    return;
  }

  empty.style.display = "none";
  grid.style.display = "grid";

  const finishMap = { pearl: "珠光", silver: "银箔", gold: "烫金", original: "原画", matte: "磨砂", gloss: "清漆", brushed: "拉丝", holo: "光栅" };

  cards.forEach((card) => {
    const item = document.createElement("div");
    item.className = "deck-card-item";
    item.dataset.id = card.id;

    const cardName = card.name || card.title || "未命名卡牌";
    const dateStr = card.createdAt
      ? new Date(card.createdAt).toLocaleDateString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "";

    item.innerHTML = `
      <div class="deck-card-thumb-wrap">
        <img src="${card.thumbDataUrl || './assets/subject.png'}" alt="${cardName}" class="deck-card-thumb" />
        <span class="deck-card-finish-tag">${finishMap[card.finish] || "珠光"}</span>${card.cardEffect && card.cardEffect !== "none" ? `<span class="deck-card-finish-tag" style="top: auto; bottom: 6px; background: rgba(50, 80, 150, 0.85);">${effectNames[card.cardEffect] || "特效"}</span>` : ""}
      </div>
      <div class="deck-card-info">
        <div class="deck-card-title-row">
          <div class="deck-card-name" title="点击或按铅笔修改卡牌名称">${cardName}</div>
          <button class="btn-deck-rename" data-id="${card.id}" type="button" title="修改卡牌名称">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
        </div>
        <div class="deck-card-sub" title="${card.subtitle}">${card.subtitle || ""}</div>
        <div class="deck-card-meta">
          <span class="deck-meta-tag">${card.collection || "典藏"}</span>
          <span class="deck-meta-date">${dateStr}</span>
        </div>
      </div>
      <div class="deck-card-actions">
        <button class="btn-deck-use" data-id="${card.id}" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>一键使用</span>
        </button>
        <button class="btn-deck-export-one" data-id="${card.id}" type="button" title="导出此卡牌 (.json)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
        <button class="btn-deck-del" data-id="${card.id}" type="button" title="从牌库删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // 绑定卡牌改名逻辑 (点击铅笔或名称均可进入重命名模式)
    const titleRow = item.querySelector(".deck-card-title-row");
    const nameEl = item.querySelector(".deck-card-name");
    const renameBtn = item.querySelector(".btn-deck-rename");

    const startRename = (e) => {
      e.stopPropagation();
      const currentName = card.name || card.title || "";
      titleRow.innerHTML = `
        <input type="text" class="deck-rename-input" value="${currentName.replace(/"/g, '&quot;')}" />
        <button class="btn-rename-ok" title="确认">✓</button>
        <button class="btn-rename-cancel" title="取消">✕</button>
      `;
      const input = titleRow.querySelector(".deck-rename-input");
      input.focus();
      input.select();

      const save = async () => {
        const val = input.value.trim();
        if (val && val !== currentName) {
          card.name = val;
          card.title = val;
          await dbSaveCard(card);
          await renderDeckGrid();
          showToast("卡牌名称已修改为「" + val + "」");
        } else {
          await renderDeckGrid();
        }
      };

      titleRow.querySelector(".btn-rename-ok").onclick = (ev) => {
        ev.stopPropagation();
        save();
      };
      titleRow.querySelector(".btn-rename-cancel").onclick = (ev) => {
        ev.stopPropagation();
        renderDeckGrid();
      };
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") save();
        if (ev.key === "Escape") renderDeckGrid();
      };
      input.onclick = (ev) => ev.stopPropagation();
    };

    if (renameBtn) renameBtn.onclick = startRename;
    if (nameEl) nameEl.onclick = startRename;

    const useBtn = item.querySelector(".btn-deck-use");
    if (useBtn) {
      useBtn.onclick = async (e) => {
        e.stopPropagation();
        await loadCardFromDeck(card.id);
      };
    }

    const exportBtn = item.querySelector(".btn-deck-export-one");
    if (exportBtn) {
      exportBtn.onclick = async (e) => {
        e.stopPropagation();
        await exportSingleCard(card.id);
      };
    }

    const delBtn = item.querySelector(".btn-deck-del");
    if (delBtn) {
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        const cName = card.name || card.title || "未命名";
        if (confirm("确认从牌库中移除卡牌「" + cName + "」吗？")) {
          await dbDeleteCard(card.id);
          await renderDeckGrid();
          showToast("已从牌库删除「" + cName + "」");
        }
      };
    }

    grid.appendChild(item);
  });
}

function syncAllInputsFromState() {
  ["ws", "b"].forEach((p) => {
    const setVal = (id, val) => {
      const el = $(p + "-" + id);
      if (el) el.value = val;
    };
    const setTxt = (id, txt) => {
      const el = $(p + "-" + id);
      if (el) el.textContent = txt;
    };

    setVal("title", state.title);
    setVal("subtitle", state.subtitle);
    setVal("collection", state.collection);
    setVal("technique", state.technique);
    setVal("tagline", state.tagline);
    setVal("edition", state.edition);

    setVal("border", state.borderStyle);
    setVal("theme", state.colorTheme);

    setVal("subject-scale", state.subjectScale);
    setTxt("val-scale", state.subjectScale.toFixed(2) + "x");
    setVal("subject-x", state.subjectX);
    setTxt("val-x", state.subjectX + "px");
    setVal("subject-y", state.subjectY);
    setTxt("val-y", state.subjectY + "px");

    setVal("bg-scale", state.bgScale);
    setTxt("val-bg-scale", state.bgScale.toFixed(2) + "x");
    setVal("bg-x", state.bgX);
    setTxt("val-bg-x", state.bgX + "px");
    setVal("bg-y", state.bgY);
    setTxt("val-bg-y", state.bgY + "px");
    setVal("bg-blur", state.bgBlur);
    setTxt("val-bg-blur", state.bgBlur + "px");

    setVal("depth", state.depth);
    setTxt("val-depth", state.depth.toFixed(2));
    setVal("holo-depth", state.bgDepth);
    setTxt("val-holo-depth", state.bgDepth.toFixed(2));
    setVal("diff", state.diff ?? 1.0);
    setTxt("val-diff", (state.diff ?? 1.0).toFixed(2) + "x");
    setVal("foil", state.foil);
    setTxt("val-foil", Math.round(state.foil * 100) + "%");
    setVal("fx-glow", state.fxGlow ?? 0.5);
    setTxt("val-fx-glow", Math.round((state.fxGlow ?? 0.5) * 100) + "%");
  });

  const f = state.finish || "pearl";
  document.querySelectorAll("[data-finish]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.finish === f));
  });
  const finishMap = { pearl: "珠光", silver: "银箔", gold: "烫金", original: "原画", matte: "磨砂", gloss: "清漆", brushed: "拉丝", holo: "光栅" };
  const eff = state.cardEffect || "none";
  document.querySelectorAll("[data-effect]").forEach((b) => {
    const isActive = b.dataset.effect === eff;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", String(isActive));
  });
  document.querySelectorAll(".effect-name-val").forEach((el) => {
    el.textContent = effectNames[eff] || eff;
  });
  document.querySelectorAll(".finish-name-val").forEach((el) => {
    el.textContent = finishMap[f] || f;
  });
  if ($("finish-name")) $("finish-name").textContent = finishMap[f] || f;
  if ($("b-foil")) $("b-foil").disabled = f === "original";
  if ($("ws-foil")) $("ws-foil").disabled = f === "original";
}

async function loadCardFromDeck(id, silent = false) {
  try {
    const card = await dbGetCard(id);
    if (!card) return;
    activeCardId = id;

    // 1. 恢复全局 state (支持自定义卡牌名称)
    state.title = card.name || card.title || state.title;
    state.subtitle = card.subtitle ?? state.subtitle;
    state.collection = card.collection ?? state.collection;
    state.technique = card.technique ?? state.technique;
    state.tagline = card.tagline ?? state.tagline;
    state.edition = card.edition ?? state.edition;
    state.borderStyle = card.borderStyle ?? state.borderStyle;
    state.colorTheme = card.colorTheme ?? state.colorTheme;
    state.finish = card.finish ?? state.finish;
    state.cardEffect = card.cardEffect ?? "none";
    applyFinishUI(state.finish);
    setCardEffect(state.cardEffect);

    state.subjectScale = card.subjectScale ?? state.subjectScale;
    state.subjectX = card.subjectX ?? state.subjectX;
    state.subjectY = card.subjectY ?? state.subjectY;

    state.bgScale = card.bgScale ?? state.bgScale;
    state.bgX = card.bgX ?? state.bgX;
    state.bgY = card.bgY ?? state.bgY;
    state.bgBlur = card.bgBlur ?? state.bgBlur;

    state.depth = card.depth ?? state.depth;
    state.bgDepth = card.bgDepth ?? state.bgDepth;
    state.diff = card.diff ?? state.diff ?? 1.0;
    state.foil = card.foil ?? state.foil;
    state.fxGlow = card.fxGlow ?? state.fxGlow ?? 0.5;

    // 2. 恢复图像并标记来源属性
    if (card.subjectBlob) {
      const sImg = await blobToImage(card.subjectBlob);
      if (sImg) {
        const isCust = card.isCustomSubject !== undefined ? card.isCustomSubject : !isDefaultSubjectBlob(card.subjectBlob);
        hasCustomSubject = Boolean(isCust);
        sImg._isCustom = isCust;
        sImg._isDefault = !isCust;
        rawSubjectImg = sImg;
      }
    } else {
      hasCustomSubject = false;
    }
    if (card.bgBlob) {
      const bImg = await blobToImage(card.bgBlob);
      if (bImg) {
        const isCust = card.isCustomBg !== undefined ? card.isCustomBg : !isDefaultBgBlob(card.bgBlob);
        hasCustomBg = Boolean(isCust);
        bImg._isCustom = isCust;
        bImg._isDefault = !isCust;
        rawBgImg = bImg;
      }
    } else {
      hasCustomBg = false;
    }

    // 3. 刷新控件与渲染
    syncAllInputsFromState();
    render2DPreview();
    syncTo3D();
    hideWorkshopLoading();

    if (!silent) {
      closeDeckModal();
      showToast("✨ 已成功载入卡牌「" + (card.name || card.title) + "」！");
    }
  } catch (err) {
    console.error("Load card from deck failed:", err);
    if (!silent) alert("载入卡牌失败: " + err.message);
  }
}


// 初始化卡牌展开放大查看功能
function initCardZoom() {
  const zoomBtn = $("btn-zoom-card");
  if (!zoomBtn) return;

  const vGallery = $("view-gallery");
  let isExpanded = false;

  const toggleZoom = () => {
    isExpanded = !isExpanded;
    if (isExpanded) {
      vGallery?.classList.add("is-card-expanded");
      const txt = zoomBtn.querySelector(".zoom-btn-text");
      if (txt) txt.textContent = "还原大小";
      if (window.__holo) {
        if (typeof window.__holo.setZoom === "function") {
          window.__holo.setZoom(1.15);
        }
        if (typeof window.__holo.setCenterOffset === "function") {
          window.__holo.setCenterOffset(1.08); // 严谨修正卡片重心，确保在视窗正中央
        }
      }
      showToast("🔍 已居中展开放大卡牌（按住可全景旋转查看细节）");
    } else {
      vGallery?.classList.remove("is-card-expanded");
      const txt = zoomBtn.querySelector(".zoom-btn-text");
      if (txt) txt.textContent = "展开放大";
      if (window.__holo) {
        if (typeof window.__holo.setZoom === "function") {
          window.__holo.setZoom(1.0);
        }
        if (typeof window.__holo.setCenterOffset === "function") {
          window.__holo.setCenterOffset(0);
        }
      }
      showToast("已恢复展台默认尺寸");
    }
    window.dispatchEvent(new Event("resize"));
    if (window.__holo && typeof window.__holo.resize === "function") {
      window.__holo.resize();
    }
  };

  zoomBtn.onclick = toggleZoom;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isExpanded) {
      toggleZoom();
    }
  });
}

// 保存当前修改为默认设置（同时更新对应牌库卡牌）
async function handleSaveCurrentChanges() {
  try {
    const currentSettings = {
      title: state.title,
      subtitle: state.subtitle,
      collection: state.collection,
      technique: state.technique,
      tagline: state.tagline,
      edition: state.edition,
      borderStyle: state.borderStyle,
      colorTheme: state.colorTheme,
      finish: state.finish,
      cardEffect: state.cardEffect,
      subjectScale: state.subjectScale,
      subjectX: state.subjectX,
      subjectY: state.subjectY,
      bgScale: state.bgScale,
      bgX: state.bgX,
      bgY: state.bgY,
      bgBlur: state.bgBlur,
      depth: state.depth,
      bgDepth: state.bgDepth,
      diff: state.diff ?? 1.0,
      foil: state.foil,
      fxGlow: state.fxGlow ?? 0.5
    };

    // 1. 存入 localStorage 设为后续进站的默认配置
    localStorage.setItem("holo_card_custom_default_settings", JSON.stringify(currentSettings));

    // 同步发送至服务端落盘，使打包出的整站 ZIP 默认配置实时对齐
    fetch("/api/save-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentSettings)
    }).catch(() => {});

    // 2. 如果牌库中已有卡牌或当前有载入的卡牌，同步更新它
    try {
      const cards = await dbGetAllCards();
      if (cards && cards.length > 0) {
        cards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const targetCard = (activeCardId ? cards.find(c => c.id === activeCardId) : null) || cards[0];
        if (targetCard) {
          Object.assign(targetCard, currentSettings);
          targetCard.name = state.title || targetCard.name;
          targetCard.title = state.title || targetCard.title;
          targetCard.updatedAt = Date.now();
          const previewCanvas = $("preview-canvas");
          if (previewCanvas) {
            targetCard.thumbDataUrl = previewCanvas.toDataURL("image/jpeg", 0.75);
          }
          await dbSaveCard(targetCard);
        }
      }
    } catch (dbErr) {
      console.warn("Update card in deck failed:", dbErr);
    }

    // 3. 按钮状态切换与视觉反馈
    const btns = [ $("ws-btn-save-changes"), $("b-btn-save-changes") ].filter(Boolean);
    btns.forEach(b => {
      b.classList.add("is-saved");
      const txt = b.querySelector(".btn-save-text");
      if (txt) txt.textContent = "✓ 已保存当前修改！";
    });

    setTimeout(() => {
      btns.forEach(b => {
        b.classList.remove("is-saved");
        const txt = b.querySelector(".btn-save-text");
        if (txt) txt.textContent = "保存当前修改";
      });
    }, 2000);

    showToast("💾 当前卡牌修改已成功保存为默认设置！");
  } catch (err) {
    console.error("Save current changes failed:", err);
    alert("保存失败: " + err.message);
  }
}

// 平滑隐藏 Page A 页面加载中遮罩层
function hideWorkshopLoading() {
  const loading = $("ws-loading");
  if (loading && !loading.classList.contains("fade-out")) {
    loading.classList.add("fade-out");
    setTimeout(() => {
      loading.style.display = "none";
    }, 450);
  }
}

async function initApp() {
  const previewCanvas = $("preview-canvas");
  if (previewCanvas) {
    previewCanvas.width = 1024;
    previewCanvas.height = 1536;
  }

  // 1. 优先从 card-config.json 载入基准默认设置 (确保即使在新设备/新部署上，也能开箱加载当前保存的默认值)
  try {
    const cfgRes = await fetch("./card-config.json");
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg.title) state.title = cfg.title;
      if (cfg.subtitle !== undefined) state.subtitle = cfg.subtitle;
      if (cfg.collection) state.collection = cfg.collection;
      if (cfg.technique) state.technique = cfg.technique;
      if (cfg.tagline) state.tagline = cfg.tagline;
      if (cfg.edition) state.edition = cfg.edition;
      if (cfg.appearance?.finish) state.finish = cfg.appearance.finish;
      if (cfg.appearance?.borderStyle) state.borderStyle = cfg.appearance.borderStyle;
      if (cfg.appearance?.colorTheme) state.colorTheme = cfg.appearance.colorTheme;
      if (cfg.appearance?.cardEffect) state.cardEffect = cfg.appearance.cardEffect;
      if (cfg.parameters) {
        const p = cfg.parameters;
        if (p.subjectScale !== undefined) state.subjectScale = p.subjectScale;
        if (p.subjectX !== undefined) state.subjectX = p.subjectX;
        if (p.subjectY !== undefined) state.subjectY = p.subjectY;
        if (p.bgScale !== undefined) state.bgScale = p.bgScale;
        if (p.bgX !== undefined) state.bgX = p.bgX;
        if (p.bgY !== undefined) state.bgY = p.bgY;
        if (p.bgBlur !== undefined) state.bgBlur = p.bgBlur;
        if (p.subjectDepth !== undefined) state.depth = p.subjectDepth;
        if (p.backgroundDepth !== undefined) state.bgDepth = p.backgroundDepth;
        if (p.diff !== undefined) state.diff = p.diff;
        if (p.foil !== undefined) state.foil = p.foil;
        if (p.fxGlow !== undefined) state.fxGlow = p.fxGlow;
      }
      applyFinishUI(state.finish);
      setCardEffect(state.cardEffect);
    }
  } catch (e) {
    console.warn("Load card-config.json failed:", e);
  }

  // 2. 检查本地浏览器是否另有单独保存的个性化配置
  try {
    const rawSaved = localStorage.getItem("holo_card_custom_default_settings");
    if (rawSaved) {
      const saved = JSON.parse(rawSaved);
      Object.assign(state, saved);
      applyFinishUI(state.finish);
      setCardEffect(state.cardEffect);
      fetch("/api/sync-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawSaved
      }).catch(() => {});
    }
  } catch (e) {
    console.warn("Load custom default settings failed:", e);
  }

  // 检查牌库：若牌库已有保存的卡牌，进网站默认直接呈现第一张卡牌
  async function loadInitialCard() {
    try {
      const cards = await dbGetAllCards();
      if (cards && cards.length > 0) {
        cards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const firstCard = cards[0];
        await loadCardFromDeck(firstCard.id, true);
        return;
      }
    } catch (e) {
      console.warn("Auto-load first card from deck failed, falling back to defaults:", e);
    }

    // 牌库为空时的初始示例素材保底
    let loadedAssetCount = 0;
    const checkAssetsDone = () => {
      loadedAssetCount++;
      if (loadedAssetCount >= 2) {
        hideWorkshopLoading();
        render2DPreview();
        ensureSyncTo3D();
      }
    };

    loadSafeAssetImage("./assets/subject.png", (img) => {
      if (img) {
        img._isDefault = true;
        img._isCustom = false;
        rawSubjectImg = img;
      }
      checkAssetsDone();
    });
    loadSafeAssetImage("./assets/background.png", (img) => {
      if (img) {
        img._isDefault = true;
        img._isCustom = false;
        rawBgImg = img;
      }
      checkAssetsDone();
    });
  }

  loadInitialCard();
  setTimeout(hideWorkshopLoading, 4000); // 弱网安全兜底保证遮罩不卡死
  checkAutoNotice(); // 用户初次进入自动弹出公告栏

  // A 页面上传主体
  const uploadSubj = $("ws-upload-subject");
  if (uploadSubj) {
    uploadSubj.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.src = evt.target.result;
        img.onload = () => {
          hasCustomSubject = true;
          img._isCustom = true;
          img._isDefault = false;
          rawSubjectImg = img;
          render2DPreview();
          syncTo3D();
        };
      };
      reader.readAsDataURL(file);
    };
  }

  // A 页面上传背景
  const uploadBg = $("ws-upload-bg");
  if (uploadBg) {
    uploadBg.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.src = evt.target.result;
        img.onload = () => {
          hasCustomBg = true;
          img._isCustom = true;
          img._isDefault = false;
          rawBgImg = img;
          render2DPreview();
          syncTo3D();
        };
      };
      reader.readAsDataURL(file);
    };
  }

  // 绑定 Page A 与 Page B 的侧边栏组件
  bindSidebarInputs("ws", false);
  bindSidebarInputs("b", true);

  // 初始化卡面材质与特效控制
  initFinishControls();
  initEffectControls();
  initDrawerToggles();

  // 初始化防误触与透明度切换
  initTouchGuards();
  initOpacityToggles();

  // 页面切换按钮
  const buildBtn = $("btn-generate-3d");
  if (buildBtn) buildBtn.onclick = showGallery;

  const skipBtn = $("btn-skip-to-gallery");
  if (skipBtn) skipBtn.onclick = showGallery;

  const backBtn = $("btn-back-to-workshop");
  if (backBtn) backBtn.onclick = showWorkshop;

  // B 页面一键导出卡牌 (可在牌库中随时导入使用)
  const exportCardBtn = $("btn-export-card");
  if (exportCardBtn) {
    exportCardBtn.onclick = () => exportCurrentCardJson(exportCardBtn);
  }

  // B 页面一键导出纯享 Netlify 展台包 (仅展示卡牌，无任何编辑/修改/保存)
  const savePhotoBtn = $("btn-save-card-photo");
  if (savePhotoBtn) {
    savePhotoBtn.onclick = () => {
      if (window.__holo && typeof window.__holo.saveCard === "function") {
        window.__holo.saveCard();
      } else {
        const origSave = $("save");
        if (origSave) origSave.click();
      }
    };
  }

  // 一键自动部署 Netlify 在线独立展台
  const autoDeployBtn = $("btn-auto-deploy-netlify");
  if (autoDeployBtn) {
    autoDeployBtn.onclick = () => deployNetlifyViewer(autoDeployBtn);
  }

  const copyLiveUrlBtn = $("btn-copy-live-url");
  if (copyLiveUrlBtn) {
    copyLiveUrlBtn.onclick = () => {
      const input = $("deploy-live-url");
      if (!input || !input.value) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(() => {
          copyLiveUrlBtn.textContent = "✓ 已复制";
          setTimeout(() => { copyLiveUrlBtn.textContent = "复制"; }, 2000);
          showToast("📋 展台网址已复制到剪贴板！发给朋友点开即可查看");
        });
      } else {
        input.select();
        document.execCommand("copy");
        copyLiveUrlBtn.textContent = "✓ 已复制";
        setTimeout(() => { copyLiveUrlBtn.textContent = "复制"; }, 2000);
        showToast("📋 展台网址已复制！");
      }
    };
  }

  const exportViewerBtn = $("btn-export-netlify-viewer");
  if (exportViewerBtn) {
    exportViewerBtn.onclick = () => exportNetlifyViewerZip(exportViewerBtn);
  }

  const copyNetlifyUrl = $("btn-copy-netlify-url");
  if (copyNetlifyUrl) {
    copyNetlifyUrl.onclick = () => {
      const url = "https://app.netlify.com/drop";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast("📋 已复制 Netlify Drop 部署网址到剪贴板！");
        }).catch(() => {
          window.open(url, "_blank");
        });
      } else {
        window.open(url, "_blank");
      }
    };
  }

  // 公告栏系统交互绑定
  const openNoticeBtn = $("btn-open-notice");
  if (openNoticeBtn) openNoticeBtn.onclick = openNoticeModal;

  const closeNoticeX = $("btn-close-notice-x");
  if (closeNoticeX) closeNoticeX.onclick = closeNoticeModal;

  const confirmNoticeBtn = $("btn-confirm-notice");
  if (confirmNoticeBtn) confirmNoticeBtn.onclick = closeNoticeModal;

  const noticeBackdrop = $("notice-backdrop");
  if (noticeBackdrop) noticeBackdrop.onclick = closeNoticeModal;

  // 牌库系统交互绑定
  const openDeckBtn = $("btn-open-deck");
  if (openDeckBtn) openDeckBtn.onclick = openDeckModal;

  const closeDeckBtn = $("btn-close-deck");
  if (closeDeckBtn) closeDeckBtn.onclick = closeDeckModal;

  const exportDeckBtn = $("btn-deck-export");
  if (exportDeckBtn) exportDeckBtn.onclick = exportAllCards;

  const importDeckBtn = $("btn-deck-import");
  const deckFileInput = $("deck-file-input");
  if (importDeckBtn && deckFileInput) {
    importDeckBtn.onclick = () => {
      deckFileInput.value = "";
      deckFileInput.click();
    };
    deckFileInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) importCardsFromFile(file);
    };
  }

  const deckBackdrop = $("deck-backdrop");
  if (deckBackdrop) deckBackdrop.onclick = closeDeckModal;

  const saveDeckHeaderBtn = $("btn-save-to-deck");
  if (saveDeckHeaderBtn) {
    saveDeckHeaderBtn.onclick = () => saveCurrentCardToDeck(saveDeckHeaderBtn);
  }

  const saveDeckSidebarBtn = $("btn-sidebar-save-deck");
  if (saveDeckSidebarBtn) {
    saveDeckSidebarBtn.onclick = () => saveCurrentCardToDeck(saveDeckSidebarBtn);
  }

  // AB 页面侧边栏「保存当前修改」长条按钮绑定
  const wsBtnSave = $("ws-btn-save-changes");
  if (wsBtnSave) wsBtnSave.onclick = handleSaveCurrentChanges;

  const bBtnSave = $("b-btn-save-changes");
  if (bBtnSave) bBtnSave.onclick = handleSaveCurrentChanges;

  // 初始化展台卡牌放大切换
  initCardZoom();

  // 陀螺仪与视角复位 Toast 联动
  const gyroBtn = $("btn-gyro-toggle");
  if (gyroBtn) {
    gyroBtn.addEventListener("click", () => {
      setTimeout(() => {
        const isActive = gyroBtn.classList.contains("active");
        showToast(isActive ? "🧭 已开启重力感应（晃动设备体验全息流光）" : "已关闭重力感应陀螺仪");
      }, 80);
    });
  }

  const recenterBtn = $("btn-recenter-toggle");
  if (recenterBtn) {
    recenterBtn.addEventListener("click", () => {
      setTimeout(() => {
        const isActive = recenterBtn.classList.contains("active");
        showToast(isActive ? "🧲 已开启松手自动回正" : "✨ 已开启自由滑转停驻（松手不回弹）");
      }, 80);
    });
  }

  const resetBtn = $("btn-reset-view");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      showToast("↺ 已复位卡牌视角");
    });
  }

  // 刷新初始牌库角标
  updateDeckBadge();

  render2DPreview();
}

// 启动工坊与页面逻辑：无需等待 3D 就绪，立刻初始化 2D 预览与所有交互控件
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
