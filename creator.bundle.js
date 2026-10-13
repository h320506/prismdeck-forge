// creator.js
function $(id) {
  return document.getElementById(id);
}
var state = {
  title: "\u516B\u5948\u89C1\u674F\u83DC",
  subtitle: "\u8D25\u72AC\u5973\u4E3B\u592A\u591A\u4E86\uFF01",
  collection: "\u6587\u5B66\u90E8",
  technique: "\u6E29\u6C34\u304F\u3093",
  tagline: "\u3042\u8BDD\u306F\u3001\u6E29\u6C34\u304F\u3093\u3002",
  edition: "001 / 001",
  borderStyle: "classic-gold",
  colorTheme: "gold",
  subjectScale: 1,
  subjectX: 0,
  subjectY: 0,
  bgScale: 1,
  bgX: 0,
  bgY: 0
};
var rawSubjectImg = null;
var rawBgImg = null;
function waitForHolo(callback, maxAttempts = 60) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (window.__holo && window.__holo.ready && window.THREE) {
      clearInterval(timer);
      callback();
    } else if (attempts > maxAttempts) {
      clearInterval(timer);
      console.warn("Holo Card viewer failed to initialize in time.");
    }
  }, 100);
}
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
      const g10 = gray[idx - 1], g12 = gray[idx + 1];
      const g20 = gray[idx + w - 1], g22 = gray[idx + w + 1];
      const gx = -g00 + g02 + 2 * (-g10 + g12) + (-g20 + g22);
      const gy = -g00 - 2 * gray[idx - w] - g02 + (g20 + 2 * gray[idx + w] + g22);
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
function fitImageToCanvas(img, scale = 1, offsetX = 0, offsetY = 0, transparentBg = false) {
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
  ctx.drawImage(img, posX, posY, drawW, drawH);
  return canvas;
}
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
    primary = "#ff6b81";
    secondary = "#ffeaa7";
    stroke = "rgba(40,10,20,0.9)";
  } else if (cfg.colorTheme === "cyan") {
    primary = "#00d2d3";
    secondary = "#c8d6e5";
    stroke = "rgba(5,25,35,0.9)";
  }
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
function updateTextTexture() {
  if (!window.__holo || !window.THREE) return;
  const canvas = drawTextCanvas(state);
  const tex = new window.THREE.CanvasTexture(canvas);
  tex.colorSpace = window.THREE.NoColorSpace;
  window.__holo.uniforms.tText.value = tex;
  const titleEl = $("card-title");
  if (titleEl) titleEl.textContent = state.title;
  const subEl = $("subtitle");
  if (subEl) subEl.textContent = state.subtitle;
  const descEl = $("description");
  if (descEl) descEl.textContent = state.tagline;
  const edEl = $("edition");
  if (edEl) edEl.textContent = state.edition;
}
function updateSubjectTexture() {
  if (!window.__holo || !window.THREE || !rawSubjectImg) return;
  const canvas = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true);
  const tex = new window.THREE.CanvasTexture(canvas);
  tex.colorSpace = window.THREE.NoColorSpace;
  window.__holo.uniforms.tSubject.value = tex;
  try {
    const lineCanvas = generateLineart(canvas);
    const lineTex = new window.THREE.CanvasTexture(lineCanvas);
    lineTex.colorSpace = window.THREE.NoColorSpace;
    window.__holo.uniforms.tLine.value = lineTex;
  } catch (e) {
    console.warn("Lineart update warning:", e);
  }
}
function updateBgTexture() {
  if (!window.__holo || !window.THREE || !rawBgImg) return;
  const canvas = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false);
  const tex = new window.THREE.CanvasTexture(canvas);
  tex.colorSpace = window.THREE.NoColorSpace;
  window.__holo.uniforms.tBackground.value = tex;
}
function initDrawer() {
  const drawer = $("creator-drawer");
  const backdrop = $("drawer-backdrop");
  const openBtn = $("open-editor");
  const closeBtn = $("close-editor");
  function open() {
    drawer.classList.add("open");
    backdrop.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  function close() {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (openBtn) {
    openBtn.style.display = "inline-flex";
    openBtn.onclick = open;
  }
  if (closeBtn) closeBtn.onclick = close;
  if (backdrop) backdrop.onclick = close;
  const bTextBindings = [
    ["draw-input-title", "title"],
    ["draw-input-subtitle", "subtitle"],
    ["draw-input-collection", "collection"],
    ["draw-input-technique", "technique"],
    ["draw-input-tagline", "tagline"],
    ["draw-input-edition", "edition"]
  ];
  bTextBindings.forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    el.value = state[key];
    el.oninput = (e) => {
      state[key] = e.target.value;
      const aEl = $("ws-" + id.replace("draw-input-", ""));
      if (aEl) aEl.value = e.target.value;
      updateTextTexture();
      render2DPreview();
    };
  });
  const bBorderEl = $("draw-select-border");
  if (bBorderEl) {
    bBorderEl.value = state.borderStyle;
    bBorderEl.onchange = (e) => {
      state.borderStyle = e.target.value;
      if ($("ws-border")) $("ws-border").value = e.target.value;
      updateTextTexture();
      render2DPreview();
    };
  }
  const bThemeEl = $("draw-select-theme");
  if (bThemeEl) {
    bThemeEl.value = state.colorTheme;
    bThemeEl.onchange = (e) => {
      state.colorTheme = e.target.value;
      if ($("ws-theme")) $("ws-theme").value = e.target.value;
      updateTextTexture();
      render2DPreview();
    };
  }
  const dScaleEl = $("draw-subject-scale");
  const dScaleVal = $("draw-val-scale");
  if (dScaleEl) {
    dScaleEl.oninput = (e) => {
      state.subjectScale = parseFloat(e.target.value);
      if (dScaleVal) dScaleVal.textContent = state.subjectScale.toFixed(2) + "x";
      if ($("ws-subject-scale")) $("ws-subject-scale").value = state.subjectScale;
      if ($("ws-val-scale")) $("ws-val-scale").textContent = state.subjectScale.toFixed(2) + "x";
      updateSubjectTexture();
      render2DPreview();
    };
  }
  const dXEl = $("draw-subject-x");
  const dXVal = $("draw-val-x");
  if (dXEl) {
    dXEl.oninput = (e) => {
      state.subjectX = parseInt(e.target.value);
      if (dXVal) dXVal.textContent = state.subjectX + "px";
      if ($("ws-subject-x")) $("ws-subject-x").value = state.subjectX;
      if ($("ws-val-x")) $("ws-val-x").textContent = state.subjectX + "px";
      updateSubjectTexture();
      render2DPreview();
    };
  }
  const dYEl = $("draw-subject-y");
  const dYVal = $("draw-val-y");
  if (dYEl) {
    dYEl.oninput = (e) => {
      state.subjectY = parseInt(e.target.value);
      if (dYVal) dYVal.textContent = state.subjectY + "px";
      if ($("ws-subject-y")) $("ws-subject-y").value = state.subjectY;
      if ($("ws-val-y")) $("ws-val-y").textContent = state.subjectY + "px";
      updateSubjectTexture();
      render2DPreview();
    };
  }
  const drawResetSubjBtn = $("draw-reset-subj-pos");
  if (drawResetSubjBtn) {
    drawResetSubjBtn.onclick = () => {
      state.subjectScale = 1;
      state.subjectX = 0;
      state.subjectY = 0;
      if (dScaleEl) dScaleEl.value = 1;
      if (dScaleVal) dScaleVal.textContent = "1.00x";
      if (dXEl) dXEl.value = 0;
      if (dXVal) dXVal.textContent = "0px";
      if (dYEl) dYEl.value = 0;
      if (dYVal) dYVal.textContent = "0px";
      if ($("ws-subject-scale")) $("ws-subject-scale").value = 1;
      if ($("ws-val-scale")) $("ws-val-scale").textContent = "1.00x";
      if ($("ws-subject-x")) $("ws-subject-x").value = 0;
      if ($("ws-val-x")) $("ws-val-x").textContent = "0px";
      if ($("ws-subject-y")) $("ws-subject-y").value = 0;
      if ($("ws-val-y")) $("ws-val-y").textContent = "0px";
      updateSubjectTexture();
      render2DPreview();
    };
  }
  const dbScaleEl = $("draw-bg-scale");
  const dbScaleVal = $("draw-val-bg-scale");
  if (dbScaleEl) {
    dbScaleEl.oninput = (e) => {
      state.bgScale = parseFloat(e.target.value);
      if (dbScaleVal) dbScaleVal.textContent = state.bgScale.toFixed(2) + "x";
      if ($("ws-bg-scale")) $("ws-bg-scale").value = state.bgScale;
      if ($("ws-val-bg-scale")) $("ws-val-bg-scale").textContent = state.bgScale.toFixed(2) + "x";
      updateBgTexture();
      render2DPreview();
    };
  }
  const dbXEl = $("draw-bg-x");
  const dbXVal = $("draw-val-bg-x");
  if (dbXEl) {
    dbXEl.oninput = (e) => {
      state.bgX = parseInt(e.target.value);
      if (dbXVal) dbXVal.textContent = state.bgX + "px";
      if ($("ws-bg-x")) $("ws-bg-x").value = state.bgX;
      if ($("ws-val-bg-x")) $("ws-val-bg-x").textContent = state.bgX + "px";
      updateBgTexture();
      render2DPreview();
    };
  }
  const dbYEl = $("draw-bg-y");
  const dbYVal = $("draw-val-bg-y");
  if (dbYEl) {
    dbYEl.oninput = (e) => {
      state.bgY = parseInt(e.target.value);
      if (dbYVal) dbYVal.textContent = state.bgY + "px";
      if ($("ws-bg-y")) $("ws-bg-y").value = state.bgY;
      if ($("ws-val-bg-y")) $("ws-val-bg-y").textContent = state.bgY + "px";
      updateBgTexture();
      render2DPreview();
    };
  }
  const dbBlurEl = $("draw-bg-blur");
  const dbBlurVal = $("draw-val-bg-blur");
  if (dbBlurEl) {
    dbBlurEl.oninput = (e) => {
      state.bgBlur = parseInt(e.target.value);
      if (dbBlurVal) dbBlurVal.textContent = state.bgBlur + "px";
      if ($("ws-bg-blur")) $("ws-bg-blur").value = state.bgBlur;
      if ($("ws-val-bg-blur")) $("ws-val-bg-blur").textContent = state.bgBlur + "px";
      updateBgTexture();
      render2DPreview();
    };
  }
  const drawResetBgBtn = $("draw-reset-bg-pos");
  if (drawResetBgBtn) {
    drawResetBgBtn.onclick = () => {
      state.bgScale = 1;
      state.bgX = 0;
      state.bgY = 0;
      state.bgBlur = 0;
      if (dbScaleEl) dbScaleEl.value = 1;
      if (dbScaleVal) dbScaleVal.textContent = "1.00x";
      if (dbXEl) dbXEl.value = 0;
      if (dbXVal) dbXVal.textContent = "0px";
      if (dbYEl) dbYEl.value = 0;
      if (dbYVal) dbYVal.textContent = "0px";
      if (dbBlurEl) dbBlurEl.value = 0;
      if (dbBlurVal) dbBlurVal.textContent = "0px";
      if ($("ws-bg-scale")) $("ws-bg-scale").value = 1;
      if ($("ws-val-bg-scale")) $("ws-val-bg-scale").textContent = "1.00x";
      if ($("ws-bg-x")) $("ws-bg-x").value = 0;
      if ($("ws-val-bg-x")) $("ws-val-bg-x").textContent = "0px";
      if ($("ws-bg-y")) $("ws-bg-y").value = 0;
      if ($("ws-val-bg-y")) $("ws-val-bg-y").textContent = "0px";
      if ($("ws-bg-blur")) $("ws-bg-blur").value = 0;
      if ($("ws-val-bg-blur")) $("ws-val-bg-blur").textContent = "0px";
      updateBgTexture();
      render2DPreview();
    };
  }
  const textBindings = [
    ["input-title", "title"],
    ["input-subtitle", "subtitle"],
    ["input-collection", "collection"],
    ["input-technique", "technique"],
    ["input-tagline", "tagline"],
    ["input-edition", "edition"]
  ];
  textBindings.forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    el.value = state[key];
    el.oninput = (e) => {
      state[key] = e.target.value;
      updateTextTexture();
    };
  });
  const borderEl = $("select-border");
  if (borderEl) {
    borderEl.value = state.borderStyle;
    borderEl.onchange = (e) => {
      state.borderStyle = e.target.value;
      updateTextTexture();
    };
  }
  const themeEl = $("select-theme");
  if (themeEl) {
    themeEl.value = state.colorTheme;
    themeEl.onchange = (e) => {
      state.colorTheme = e.target.value;
      updateTextTexture();
    };
  }
  const sScaleEl = $("slider-subject-scale");
  const sScaleVal = $("val-subject-scale");
  if (sScaleEl) {
    sScaleEl.oninput = (e) => {
      state.subjectScale = parseFloat(e.target.value);
      if (sScaleVal) sScaleVal.textContent = state.subjectScale.toFixed(2) + "x";
      updateSubjectTexture();
    };
  }
  const sXEl = $("slider-subject-x");
  const sXVal = $("val-subject-x");
  if (sXEl) {
    sXEl.oninput = (e) => {
      state.subjectX = parseInt(e.target.value);
      if (sXVal) sXVal.textContent = state.subjectX + "px";
      updateSubjectTexture();
    };
  }
  const sYEl = $("slider-subject-y");
  const sYVal = $("val-subject-y");
  if (sYEl) {
    sYEl.oninput = (e) => {
      state.subjectY = parseInt(e.target.value);
      if (sYVal) sYVal.textContent = state.subjectY + "px";
      updateSubjectTexture();
    };
  }
  const resetSubjBtn = $("btn-reset-subject");
  if (resetSubjBtn) {
    resetSubjBtn.onclick = () => {
      state.subjectScale = 1;
      state.subjectX = 0;
      state.subjectY = 0;
      if (sScaleEl) sScaleEl.value = 1;
      if (sScaleVal) sScaleVal.textContent = "1.00x";
      if (sXEl) sXEl.value = 0;
      if (sXVal) sXVal.textContent = "0px";
      if (sYEl) sYEl.value = 0;
      if (sYVal) sYVal.textContent = "0px";
      updateSubjectTexture();
    };
  }
  const uploadSubj = $("upload-subject");
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
          updateSubjectTexture();
        };
      };
      reader.readAsDataURL(file);
    };
  }
  const uploadBg = $("upload-bg");
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
          updateBgTexture();
        };
      };
      reader.readAsDataURL(file);
    };
  }
  const sInit = new Image();
  sInit.crossOrigin = "anonymous";
  sInit.src = "./assets/subject.png";
  sInit.onload = () => {
    rawSubjectImg = sInit;
  };
  const bInit = new Image();
  bInit.crossOrigin = "anonymous";
  bInit.src = "./assets/background.png";
  bInit.onload = () => {
    rawBgImg = bInit;
  };
}
waitForHolo(() => {
  initDrawer();
});
