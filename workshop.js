/**
 * workshop.js - Page A (工坊制作室) 交互与 2D 预览渲染
 */

function $(id) {
  return document.getElementById(id);
}

const state = {
  title: "八奈见杏菜",
  subtitle: "败犬女主太多了！",
  collection: "文学部",
  technique: "温水くん",
  tagline: "あはは、温水くん。",
  edition: "001 / 001",
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
  hologramDepth: -0.18,
  foil: 0.52
};

let rawSubjectImg = null;
let rawBgImg = null;

// 等待 3D 渲染核心就绪
function waitForHolo(callback, maxAttempts = 60) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (window.__holo && window.__holo.ready && window.THREE) {
      clearInterval(timer);
      callback();
    } else if (attempts > maxAttempts) {
      clearInterval(timer);
      console.warn("Holo viewer timeout");
    }
  }, 100);
}

// 生成白底黑线线稿 (用于 3D 卡牌全息烫金描边发光)
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

  const imgAspect = img.width / img.height;
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

  let primary = "#f4d087";
  let secondary = "#fff1ce";
  let stroke = "rgba(16,21,27,0.85)";

  if (cfg.colorTheme === "silver") {
    primary = "#e0e6ed";
    secondary = "#ffffff";
    stroke = "rgba(10,15,25,0.9)";
  } else if (cfg.colorTheme === "crimson") {
    primary = "#e05368";
    secondary = "#ffe8ed";
    stroke = "rgba(40,10,20,0.9)";
  } else if (cfg.colorTheme === "cyan") {
    primary = "#17c0ba";
    secondary = "#e8fcfb";
    stroke = "rgba(5,25,35,0.9)";
  }

  // 绘制边框
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
    if (!value) return;
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

  drawTxt(72, 60, cfg.subtitle || "", 26, "left", primary);
  drawTxt(72, 100, cfg.title || "", 86, "left", secondary, 875);
  drawTxt(76, 205, cfg.collection || "", 24, "left", primary);
  drawLine(245);

  drawLine(1280);
  drawTxt(512, 1300, cfg.tagline || "", 32, "center", primary);
  drawTxt(512, 1348, cfg.technique || "", 68, "center", secondary);
  drawTxt(72, 1460, cfg.edition || "001 / 001", 22, "left", primary);
  drawTxt(950, 1460, "H O L O G R A P H I C", 20, "right", primary, 400);

  return c;
}

// 绘制 Page A 的 2D 复合预览图
function render2DPreview() {
  const previewCanvas = $("preview-canvas");
  if (!previewCanvas) return;
  const ctx = previewCanvas.getContext("2d");
  const w = 1024;
  const h = 1536;

  ctx.clearRect(0, 0, w, h);

  // 1. 绘制背景
  if (rawBgImg) {
    const bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
    ctx.drawImage(bgCvs, 0, 0);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }

  // 2. 绘制主体
  if (rawSubjectImg) {
    const subjCvs = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0);
    ctx.drawImage(subjCvs, 0, 0);
  }

  // 3. 绘制文字与边框
  const textCvs = drawTextCanvas(state);
  ctx.drawImage(textCvs, 0, 0);
}

// 同步所有图层到 Page B (3D 全息视图)
function syncTo3D() {
  if (!window.__holo || !window.THREE) return;

  // 1. 更新背景
  if (rawBgImg) {
    const bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
    const bgTex = new window.THREE.CanvasTexture(bgCvs);
    bgTex.colorSpace = window.THREE.NoColorSpace;
    window.__holo.uniforms.tBackground.value = bgTex;
  }

  // 2. 更新主体与线稿
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
      console.warn("Lineart sync warning:", e);
    }
  }

  // 3. 更新文字
  const textCvs = drawTextCanvas(state);
  const textTex = new window.THREE.CanvasTexture(textCvs);
  textTex.colorSpace = window.THREE.NoColorSpace;
  window.__holo.uniforms.tText.value = textTex;
  
  // 更新景深参数
  window.__holo.uniforms.uDepth.value = state.depth;
  window.__holo.uniforms.uBgDepth.value = state.hologramDepth;
  window.__holo.uniforms.uFoil.value = state.foil;

  // 4. 更新 Page B 页面文本
  const tEl = $("card-title");
  if (tEl) tEl.textContent = state.title;
  const sEl = $("subtitle");
  if (sEl) sEl.textContent = state.subtitle;
  const dEl = $("description");
  if (dEl) dEl.textContent = state.tagline;
  const eEl = $("edition");
  if (eEl) eEl.textContent = state.edition;

  // 触发 3D 舞台尺寸自适应重绘
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

function initWorkshop() {
  const previewCanvas = $("preview-canvas");
  if (previewCanvas) {
    previewCanvas.width = 1024;
    previewCanvas.height = 1536;
  }

  // 加载初始默认图
  const sInit = new Image();
  sInit.crossOrigin = "anonymous";
  sInit.src = "./assets/subject.png";
  sInit.onload = () => {
    rawSubjectImg = sInit;
    render2DPreview();
  };

  const bInit = new Image();
  bInit.crossOrigin = "anonymous";
  bInit.src = "./assets/background.png";
  bInit.onload = () => {
    rawBgImg = bInit;
    render2DPreview();
  };

  // 绑定表单输入
  const textInputs = [
    ["ws-title", "title"],
    ["ws-subtitle", "subtitle"],
    ["ws-collection", "collection"],
    ["ws-technique", "technique"],
    ["ws-tagline", "tagline"],
    ["ws-edition", "edition"]
  ];

  textInputs.forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    el.value = state[key];
    el.oninput = (e) => {
      state[key] = e.target.value;
      render2DPreview();
    };
  });

  // 边框与配色选择
  const borderEl = $("ws-border");
  if (borderEl) {
    borderEl.value = state.borderStyle;
    borderEl.onchange = (e) => {
      state.borderStyle = e.target.value;
      render2DPreview();
    };
  }

  const themeEl = $("ws-theme");
  if (themeEl) {
    themeEl.value = state.colorTheme;
    themeEl.onchange = (e) => {
      state.colorTheme = e.target.value;
      render2DPreview();
    };
  }

  // 主体缩放与偏移
  const sScaleEl = $("ws-subject-scale");
  const sScaleVal = $("ws-val-scale");
  if (sScaleEl) {
    sScaleEl.oninput = (e) => {
      state.subjectScale = parseFloat(e.target.value);
      if (sScaleVal) sScaleVal.textContent = state.subjectScale.toFixed(2) + "x";
      render2DPreview();
    };
  }

  const sXEl = $("ws-subject-x");
  const sXVal = $("ws-val-x");
  if (sXEl) {
    sXEl.oninput = (e) => {
      state.subjectX = parseInt(e.target.value);
      if (sXVal) sXVal.textContent = state.subjectX + "px";
      render2DPreview();
    };
  }

  const sYEl = $("ws-subject-y");
  const sYVal = $("ws-val-y");
  if (sYEl) {
    sYEl.oninput = (e) => {
      state.subjectY = parseInt(e.target.value);
      if (sYVal) sYVal.textContent = state.subjectY + "px";
      render2DPreview();
    };
  }

  const resetSubjBtn = $("ws-reset-subj-pos");
  if (resetSubjBtn) {
    resetSubjBtn.onclick = () => {
      state.subjectScale = 1.0;
      state.subjectX = 0;
      state.subjectY = 0;
      if (sScaleEl) sScaleEl.value = 1.0;
      if (sScaleVal) sScaleVal.textContent = "1.00x";
      if (sXEl) sXEl.value = 0;
      if (sXVal) sXVal.textContent = "0px";
      if (sYEl) sYEl.value = 0;
      if (sYVal) sYVal.textContent = "0px";
      render2DPreview();
    };
  }

  // 背景缩放与偏移
  const bScaleEl = $("ws-bg-scale");
  const bScaleVal = $("ws-val-bg-scale");
  if (bScaleEl) {
    bScaleEl.oninput = (e) => {
      state.bgScale = parseFloat(e.target.value);
      if (bScaleVal) bScaleVal.textContent = state.bgScale.toFixed(2) + "x";
      render2DPreview();
    };
  }

  const bXEl = $("ws-bg-x");
  const bXVal = $("ws-val-bg-x");
  if (bXEl) {
    bXEl.oninput = (e) => {
      state.bgX = parseInt(e.target.value);
      if (bXVal) bXVal.textContent = state.bgX + "px";
      render2DPreview();
    };
  }

  const bYEl = $("ws-bg-y");
  const bYVal = $("ws-val-bg-y");
  if (bYEl) {
    bYEl.oninput = (e) => {
      state.bgY = parseInt(e.target.value);
      if (bYVal) bYVal.textContent = state.bgY + "px";
      render2DPreview();
    };
  }

  const bBlurEl = $("ws-bg-blur");
  const bBlurVal = $("ws-val-bg-blur");
  if (bBlurEl) {
    bBlurEl.oninput = (e) => {
      state.bgBlur = parseInt(e.target.value);
      if (bBlurVal) bBlurVal.textContent = state.bgBlur + "px";
      render2DPreview();
    };
  }

  const resetBgBtn = $("ws-reset-bg-pos");
  if (resetBgBtn) {
    resetBgBtn.onclick = () => {
      state.bgScale = 1.0;
      state.bgX = 0;
      state.bgY = 0;
      state.bgBlur = 0;
      if (bScaleEl) bScaleEl.value = 1.0;
      if (bScaleVal) bScaleVal.textContent = "1.00x";
      if (bXEl) bXEl.value = 0;
      if (bXVal) bXVal.textContent = "0px";
      if (bYEl) bYEl.value = 0;
      if (bYVal) bYVal.textContent = "0px";
      if (bBlurEl) bBlurEl.value = 0;
      if (bBlurVal) bBlurVal.textContent = "0px";
      render2DPreview();
    };
  }

  // 上传主体图片
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
          rawSubjectImg = img;
          render2DPreview();
        };
      };
      reader.readAsDataURL(file);
    };
  }

  // 上传背景图片
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
          rawBgImg = img;
          render2DPreview();
        };
      };
      reader.readAsDataURL(file);
    };
  }

  // 景深与全息参数
  const wDepthEl = $("ws-depth");
  const wDepthVal = $("ws-val-depth");
  if (wDepthEl) {
    wDepthEl.oninput = (e) => {
      state.depth = parseFloat(e.target.value);
      if (wDepthVal) wDepthVal.textContent = state.depth.toFixed(2);
    };
  }

  const wBgDepthEl = $("ws-holo-depth");
  const wBgDepthVal = $("ws-val-holo-depth");
  if (wBgDepthEl) {
    wBgDepthEl.oninput = (e) => {
      state.hologramDepth = parseFloat(e.target.value);
      if (wBgDepthVal) wBgDepthVal.textContent = state.hologramDepth.toFixed(2);
    };
  }
  
  const wFoilEl = $("ws-foil");
  const wFoilVal = $("ws-val-foil");
  if (wFoilEl) {
    wFoilEl.oninput = (e) => {
      state.foil = parseFloat(e.target.value);
      if (wFoilVal) wFoilVal.textContent = Math.round(state.foil * 100) + "%";
    };
  }

  // 生成 3D 全息卡牌按钮
  const buildBtn = $("btn-generate-3d");
  if (buildBtn) buildBtn.onclick = showGallery;

  const skipBtn = $("btn-skip-to-gallery");
  if (skipBtn) skipBtn.onclick = showGallery;

  // Page B 顶栏返回工坊按钮
  const backBtn = $("btn-back-to-workshop");
  if (backBtn) backBtn.onclick = showWorkshop;

  render2DPreview();
}

waitForHolo(() => {
  initWorkshop();
});
