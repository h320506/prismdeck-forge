/**
 * site.js - 统管 Page A (工坊) 与 Page B (3D 展台) 的双向交互、半透明侧边栏与 Netlify 一键导出
 */
import JSZip from "jszip";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

function $(id) {
  return document.getElementById(id);
}

// A 界面 Saobby 网页计数器：请求独立计数器 ID；第三方失败或超时只隐藏统计。
async function initVisitCounter() {
  const counter = $("site-visit-counter");
  const visitsNode = $("site-total-visits");
  const visitorsNode = $("site-total-visitors");
  if (!counter || !visitsNode || !visitorsNode) return;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch("https://w.saobby.com/api/visit/xosu9uca", {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const visits = Number(result?.data?.visits);
    const visitors = Number(result?.data?.ips);
    if (!result?.success || !Number.isFinite(visits) || !Number.isFinite(visitors)) {
      throw new Error("Invalid counter response");
    }
    const formatter = new Intl.NumberFormat("zh-CN");
    visitsNode.textContent = formatter.format(visits);
    visitorsNode.textContent = formatter.format(visitors);
    counter.hidden = false;
    counter.classList.add("is-ready");
  } catch (error) {
    counter.hidden = true;
    if (error?.name !== "AbortError") console.warn("Visit counter unavailable:", error);
  } finally {
    clearTimeout(timeoutId);
  }
}

// 官方标准默认基准配置 (用于新卡牌与缺失字段纯净回退，杜绝卡牌间跨卡污染)
const DEFAULTS = {
  title: "八奈见杏菜",
  subtitle: "败犬女主太多了！",
  collection: "文学部",
  technique: "温水くん～",
  tagline: "あはは、温水くん",
  edition: "001 / 001",
  finish: "pearl",
  cardEffect: "prismatic_petals",
  customFxName: "自定义特效",
  fxScale: 1.0,
  fxX: 0,
  fxY: 0,
  borderStyle: "ornamental",
  colorTheme: "cyan",
  backStyle: "ambient",
  customBackName: "自定义卡背",
  subjectScale: 0.80,
  subjectX: 0,
  subjectY: 0,
  bgScale: 1.0,
  bgX: 0,
  bgY: 0,
  bgBlur: 5,
  depth: 0.25,
  bgDepth: -0.60,
  diff: 2.0,
  foil: 0.50,
  fxGlow: 0.20,
  effectsDepth: 0.14
};

// 全局卡牌统一状态
const state = { ...DEFAULTS };

let rawSubjectImg = null;
let rawBgImg = null;
let customFxImg = null;
let customBackImg = null;
let activeCardId = null;
let hasCustomSubject = false;
let hasCustomBg = false;
let hasCustomFx = false;
let hasCustomBack = false;

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

// 获取特效 Canvas 纹理生成器 (支持多自制特效库与预设光效)
function getEffectCanvas(effKey) {
  if (!effKey || effKey === "none") return null;
  if (effKey.startsWith("custom")) {
    const fxId = effKey === "custom" ? state.activeCustomFxId : effKey.replace("custom_", "");
    const found = customFxLibrary.find((x) => x.id === fxId) || customFxLibrary[0];
    const img = found?.img || customFxImg;
    if (!img) return null;
    const cvs = document.createElement("canvas");
    cvs.width = 1024;
    cvs.height = 1536;
    const ctx = cvs.getContext("2d");
    ctx.drawImage(img, 0, 0, 1024, 1536);
    return cvs;
  }
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
    // 采用沉稳暗黑典雅底衬替代生硬白底，杜绝背景微移或缩小时露出白边
    ctx.fillStyle = "#141615";
    ctx.fillRect(0, 0, 1024, 1536);
  }

  if (!img) return canvas;

  // 背景边缘自然色彩延展 (根据图片边缘主色自然晕染四周，彻底消除白边与违和感)
  if (!transparentBg) {
    ctx.save();
    ctx.filter = "blur(32px) saturate(120%)";
    ctx.globalAlpha = 0.85;
    // 放大 115% 铺底，使四周自动充满原图边缘的真实过渡色彩
    ctx.drawImage(img, -76, -115, 1024 + 152, 1536 + 230);
    ctx.restore();
  }

  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const imgAspect = w / h;
  const canvasAspect = 1024 / 1536;

  let drawW = 1024 * scale;
  let drawH = 1536 * scale;

  if (transparentBg) {
    // 主体透明人物：按 contain 模式完整包容呈现，避免人物被上下或左右裁断
    if (imgAspect > canvasAspect) {
      drawH = drawW / imgAspect;
    } else {
      drawW = drawH * imgAspect;
    }
  } else {
    // 背景插画：按 cover 模式填满整个卡面（1024x1536），杜绝横屏宽图上下露出刺眼白边
    if (imgAspect > canvasAspect) {
      drawW = drawH * imgAspect;
    } else {
      drawH = drawW / imgAspect;
    }
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

// 动态绘制 4 款全新卡背视觉纹理 (与正面文字、首字、配色及素材完全实时动态联动)
function drawBackCanvas(cfg, bgImg, subjImg) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1536;
  const ctx = c.getContext("2d");

  const title = (cfg.title || "八奈见杏菜").trim();
  const subtitle = (cfg.subtitle || "").trim();
  const collection = (cfg.collection || "HOLO STUDIO").trim();
  const edition = (cfg.edition || "001 / 001").trim();
  const tagline = (cfg.tagline || "").trim();
  const firstChar = title.slice(0, 1) || "卡";
  const style = cfg.backStyle || "ambient";

  let goldBright = "#f4d087";
  let goldDeep = "#c5a059";
  let fontDark = "#2d352b";

  if (cfg.colorTheme === "silver") {
    goldBright = "#e2e8f0";
    goldDeep = "#94a3b8";
    fontDark = "#252d3a";
  } else if (cfg.colorTheme === "crimson") {
    goldBright = "#ffb3be";
    goldDeep = "#e05368";
    fontDark = "#3a131b";
  } else if (cfg.colorTheme === "cyan") {
    goldBright = "#99f6e4";
    goldDeep = "#14b8a6";
    fontDark = "#122f32";
  }

  if (style.startsWith("custom")) {
    const backId = style === "custom" ? state.activeCustomBackId : style.replace("custom_", "");
    const found = customBackLibrary.find((x) => x.id === backId) || customBackLibrary[0];
    const img = found?.img || customBackImg;
    if (img) {
      const backCvs = fitImageToCanvas(img, 1.0, 0, 0, false, 0);
      ctx.drawImage(backCvs, 0, 0);
      ctx.strokeStyle = goldDeep;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(56, 56, 912, 1424);
      ctx.strokeStyle = goldBright;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(68, 68, 888, 1400);
      return c;
    }
  }

  if (style === "obsidian") {
    // 方案 2: 黑曜晶石鎏金 (暗黑轻奢黑金)
    ctx.fillStyle = "#141615";
    ctx.fillRect(0, 0, 1024, 1536);

    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    for (let y = 0; y < 1536; y += 8) {
      ctx.fillRect(0, y, 1024, 2);
    }

    const rad = ctx.createRadialGradient(512, 700, 20, 512, 700, 480);
    rad.addColorStop(0, "rgba(212, 175, 55, 0.15)");
    rad.addColorStop(0.5, "rgba(212, 175, 55, 0.04)");
    rad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 1024, 1536);

    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(56, 56, 912, 1424);
    ctx.strokeStyle = goldBright;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(68, 68, 888, 1400);

    const cornerPoints = [[68, 68], [956, 68], [68, 1468], [956, 1468]];
    ctx.fillStyle = goldBright;
    cornerPoints.forEach(([cx, cy]) => {
      ctx.fillRect(cx - 5, cy - 5, 10, 10);
    });

    ctx.textAlign = "center";
    ctx.fillStyle = goldBright;
    ctx.font = '500 28px "Songti SC", "STSong", serif';
    ctx.fillText(subtitle || title, 512, 220);

    ctx.font = '16px "PingFang SC", sans-serif';
    ctx.fillStyle = goldDeep;
    ctx.fillText("LIMITED GOLD ARCHIVE", 512, 260);

    ctx.font = '500 380px "Songti SC", "STSong", serif';
    ctx.fillStyle = goldBright;
    ctx.fillText(firstChar, 512, 850);

    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(412, 1040);
    ctx.lineTo(612, 1040);
    ctx.stroke();

    ctx.font = '600 44px "PingFang SC", sans-serif';
    ctx.fillStyle = goldBright;
    ctx.fillText(title, 512, 1110);

    if (tagline) {
      ctx.font = '22px "PingFang SC", sans-serif';
      ctx.fillStyle = "rgba(244, 208, 135, 0.75)";
      ctx.fillText(tagline, 512, 1165);
    }

    ctx.font = '500 24px "PingFang SC", sans-serif';
    ctx.fillStyle = goldBright;
    ctx.fillText(edition, 512, 1370);

    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillStyle = goldDeep;
    ctx.fillText("✦ OBSIDIAN ART CERTIFIED ✦", 512, 1410);

  } else if (style === "minimal") {
    // 方案 3: 极简馆藏印鉴 (高雅象牙白)
    ctx.fillStyle = "#faf9f6";
    ctx.fillRect(0, 0, 1024, 1536);

    ctx.strokeStyle = "#aeb5aa";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(56, 56, 912, 1424);
    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 1;
    ctx.strokeRect(68, 68, 888, 1400);

    ctx.textAlign = "center";
    ctx.fillStyle = "#636c5f";
    ctx.font = '500 28px "Songti SC", "STSong", serif';
    ctx.fillText(subtitle || title, 512, 220);

    ctx.font = '16px "PingFang SC", sans-serif';
    ctx.fillStyle = "#8a9486";
    ctx.fillText("ATELIER CURATED STUDY", 512, 260);

    ctx.font = '500 380px "Songti SC", "STSong", serif';
    ctx.fillStyle = "rgba(70, 78, 68, 0.75)";
    ctx.fillText(firstChar, 512, 850);

    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(422, 1040);
    ctx.lineTo(602, 1040);
    ctx.stroke();

    ctx.font = '600 44px "PingFang SC", sans-serif';
    ctx.fillStyle = "#333c30";
    ctx.fillText(title, 512, 1110);

    ctx.font = '22px "PingFang SC", sans-serif';
    ctx.fillStyle = "#707a6c";
    ctx.fillText("个人典藏 · 习作编号", 512, 1165);

    ctx.font = '500 24px "PingFang SC", sans-serif';
    ctx.fillStyle = "#464e44";
    ctx.fillText(edition, 512, 1370);

    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillStyle = "#8a9486";
    ctx.fillText("WHITE ATELIER ARCHIVE", 512, 1410);

  } else if (style === "silhouette") {
    // 方案 4: 角色剪影图腾 (专属印记)
    ctx.fillStyle = "#f3f5f4";
    ctx.fillRect(0, 0, 1024, 1536);

    if (subjImg) {
      try {
        const tempC = document.createElement("canvas");
        tempC.width = 1024;
        tempC.height = 1536;
        const tCtx = tempC.getContext("2d");
        tCtx.drawImage(subjImg, 160, 260, 704, 1056);
        tCtx.globalCompositeOperation = "source-in";
        tCtx.fillStyle = "rgba(35, 60, 95, 0.18)";
        tCtx.fillRect(0, 0, 1024, 1536);
        ctx.drawImage(tempC, 0, 0);
      } catch (e) {
        console.warn("Silhouette draw error:", e);
      }
    }

    ctx.strokeStyle = "rgba(197, 160, 89, 0.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(512, 700, 320, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(160, 175, 190, 0.4)";
    ctx.beginPath();
    ctx.arc(512, 700, 345, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(160, 175, 190, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(56, 56, 912, 1424);
    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 1;
    ctx.strokeRect(68, 68, 888, 1400);

    ctx.textAlign = "center";
    ctx.fillStyle = "#25384e";
    ctx.font = '500 28px "Songti SC", "STSong", serif';
    ctx.fillText(subtitle || title, 512, 210);

    ctx.font = '16px "PingFang SC", sans-serif';
    ctx.fillStyle = "#6d8299";
    ctx.fillText("CHARACTER EMBLEM ARCHIVE", 512, 250);

    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(422, 1080);
    ctx.lineTo(602, 1080);
    ctx.stroke();

    ctx.font = '600 44px "PingFang SC", sans-serif';
    ctx.fillStyle = "#1e2e42";
    ctx.fillText(title, 512, 1145);

    ctx.font = '22px "PingFang SC", sans-serif';
    ctx.fillStyle = "#51677f";
    ctx.fillText("✦ 专属角色图腾 ✦", 512, 1195);

    ctx.font = '500 24px "PingFang SC", sans-serif';
    ctx.fillStyle = "#25384e";
    ctx.fillText(edition, 512, 1370);

    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillStyle = "#788ca2";
    ctx.fillText("COLLECTIBLE TRADING EMBLEM", 512, 1410);

  } else {
    // 方案 1: 光影氛围漫透 (提取背景色晕染 - 默认款式)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1024, 1536);

    if (bgImg) {
      try {
        ctx.save();
        ctx.filter = "blur(50px)";
        ctx.drawImage(bgImg, -100, -100, 1224, 1736);
        ctx.restore();
      } catch (e) {
        console.warn("Back blur error:", e);
      }
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.48)";
    ctx.fillRect(0, 0, 1024, 1536);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(52, 52, 920, 1432);
    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(66, 66, 892, 1404);

    const cornerDiamonds = [[66, 66], [958, 66], [66, 1470], [958, 1470]];
    ctx.fillStyle = goldDeep;
    cornerDiamonds.forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx + 6, cy);
      ctx.lineTo(cx, cy + 6);
      ctx.lineTo(cx - 6, cy);
      ctx.closePath();
      ctx.fill();
    });

    ctx.textAlign = "center";
    ctx.fillStyle = fontDark;
    ctx.font = '500 28px "Songti SC", "STSong", serif';
    ctx.fillText(subtitle || title, 512, 220);

    ctx.font = '16px "PingFang SC", sans-serif';
    ctx.fillStyle = "#636d60";
    ctx.fillText("PERSONAL ART COLLECTION", 512, 260);

    ctx.font = '500 380px "Songti SC", "STSong", serif';
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(firstChar, 512, 850);
    ctx.fillStyle = goldDeep;
    ctx.globalAlpha = 0.55;
    ctx.fillText(firstChar, 514, 852);
    ctx.globalAlpha = 1.0;

    ctx.strokeStyle = goldDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(412, 1040);
    ctx.lineTo(612, 1040);
    ctx.stroke();

    ctx.font = '600 44px "PingFang SC", sans-serif';
    ctx.fillStyle = fontDark;
    ctx.fillText(title, 512, 1110);

    if (tagline) {
      ctx.font = '22px "PingFang SC", sans-serif';
      ctx.fillStyle = "#555f52";
      ctx.fillText(tagline, 512, 1165);
    }

    ctx.font = '500 24px "PingFang SC", sans-serif';
    ctx.fillStyle = fontDark;
    ctx.fillText(edition, 512, 1370);

    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillStyle = "#707a6d";
    ctx.fillText("✦ HOLO ATELIER STUDY ✦", 512, 1410);
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

  // 1. 绘制背景 (支持缩放、位移与模糊，无背景时显示典雅暗色背景)
  if (rawBgImg) {
    const bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
    ctx.drawImage(bgCvs, 0, 0);
  } else {
    ctx.fillStyle = "#141615";
    ctx.fillRect(0, 0, w, h);
    const rad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, 700);
    rad.addColorStop(0, "rgba(255, 255, 255, 0.04)");
    rad.addColorStop(1, "rgba(0, 0, 0, 0.65)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, w, h);
  }

  // 2. 绘制主体 (支持缩放与位移，无主体时优雅跳过)
  if (rawSubjectImg) {
    const subjCvs = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0);
    ctx.drawImage(subjCvs, 0, 0);
  }

  // 2.5 绘制卡面特效 (支持自由缩放、破框位移与辉光)
  if (state.cardEffect && state.cardEffect !== "none") {
    const fxCvs = getEffectCanvas(state.cardEffect);
    if (fxCvs) {
      ctx.save();
      const fxScale = state.fxScale ?? 1.0;
      const fxX = state.fxX ?? 0;
      const fxY = state.fxY ?? 0;
      const dw = w * fxScale;
      const dh = h * fxScale;
      const dx = (w - dw) / 2 + fxX;
      const dy = (h - dh) / 2 + fxY;

      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(fxCvs, dx, dy, dw, dh);
      const glowAmt = state.fxGlow ?? 0.5;
      if (glowAmt > 0.01) {
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.65 * glowAmt;
        ctx.drawImage(fxCvs, dx, dy, dw, dh);
      }
      ctx.restore();
    }
  }

  // 3. 绘制文字与边框
  const textCvs = drawTextCanvas(state);
  ctx.drawImage(textCvs, 0, 0);
}

// 安全更新 CanvasTexture，复用已分配的 GPU 纹理显存，杜绝频繁创建导致的 VRAM 泄漏与上下文崩溃
function safeUpdateCanvasTexture(uniformTarget, newCanvas) {
  if (!window.__holo || !window.THREE || !uniformTarget || !newCanvas) return;
  const oldTex = uniformTarget.value;
  if (oldTex && oldTex.isCanvasTexture && oldTex.image && oldTex.image.width === newCanvas.width && oldTex.image.height === newCanvas.height) {
    oldTex.image = newCanvas;
    oldTex.wrapS = window.THREE.MirroredRepeatWrapping;
    oldTex.wrapT = window.THREE.MirroredRepeatWrapping;
    oldTex.needsUpdate = true;
  } else {
    const newTex = new window.THREE.CanvasTexture(newCanvas);
    newTex.colorSpace = window.THREE.NoColorSpace;
    newTex.wrapS = window.THREE.MirroredRepeatWrapping;
    newTex.wrapT = window.THREE.MirroredRepeatWrapping;
    newTex.needsUpdate = true;
    uniformTarget.value = newTex;
    if (oldTex && typeof oldTex.dispose === "function") {
      try { oldTex.dispose(); } catch (e) {}
    }
  }
}

// 极速同步 3D 着色器浮点参数 (Zero-Cost Uniforms Sync) - 毫秒级响应，完全避免重绘画布与线稿
function sync3DUniforms() {
  if (!window.__holo || !window.__holo.uniforms) return;
  const u = window.__holo.uniforms;
  if (u.uDepth) u.uDepth.value = state.depth;
  if (u.uBgDepth) u.uBgDepth.value = state.bgDepth;
  if (u.uDiff) u.uDiff.value = state.diff ?? 1.0;
  if (u.uFoil) u.uFoil.value = state.foil;
  if (u.uFxGlow) u.uFxGlow.value = state.fxGlow ?? 0.5;
  if (u.uFxDepth) u.uFxDepth.value = state.effectsDepth ?? 0.14;
  if (state.finish && typeof window.__holo.setFinish === "function") {
    window.__holo.setFinish(state.finish);
  }
  if (typeof window.__holo.updateFxTransform === "function") {
    window.__holo.updateFxTransform(
      state.fxScale ?? 1.0,
      state.fxX ?? 0,
      state.fxY ?? 0,
      state.effectsDepth ?? 0.14,
      state.cardEffect && state.cardEffect !== "none"
    );
  }
}

// 动态刷新作品信息弹窗内容 (与当前卡牌标题、出处与编号实时同步)
function updateAboutModal() {
  const at = $("about-title");
  if (at) at.textContent = [state.subtitle, state.title].filter(Boolean).join(" / ");
  const ad = $("about-description");
  if (ad) ad.textContent = state.tagline || (state.subtitle ? state.subtitle + " · 全息典藏卡片" : "全息典藏卡片");
  const ae = $("about-edition");
  if (ae) ae.textContent = state.edition || "001 / 001";
}
window.updateAboutModal = updateAboutModal;

// 丝滑局部更新流水线 (针对 Page B 高频滑条拖拽做专属 RAF 节流与防抖优化，消除 150 万像素 CPU 阻塞)
let lineartTimer = null;
let rafSubjectId = null;

function syncSubject3D() {
  if (!window.__holo || !window.__holo.uniforms) return;
  if (rafSubjectId) cancelAnimationFrame(rafSubjectId);
  rafSubjectId = requestAnimationFrame(() => {
    if (rawSubjectImg) {
      const subjCvs = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0);
      safeUpdateCanvasTexture(window.__holo.uniforms.tSubject, subjCvs);
      if (window.__holo.uniforms.uHasLine) window.__holo.uniforms.uHasLine.value = 1.0;

      // 线稿采用防抖异步合成，避免滑动主体时每帧执行耗时 60ms 的 Sobel CPU 边缘计算
      clearTimeout(lineartTimer);
      lineartTimer = setTimeout(() => {
        try {
          const lineCvs = generateLineart(subjCvs);
          safeUpdateCanvasTexture(window.__holo.uniforms.tLine, lineCvs);
        } catch (e) {}
      }, 90);
    } else {
      const emptyCvs = document.createElement("canvas");
      emptyCvs.width = 1;
      emptyCvs.height = 1;
      safeUpdateCanvasTexture(window.__holo.uniforms.tSubject, emptyCvs);
      safeUpdateCanvasTexture(window.__holo.uniforms.tLine, emptyCvs);
      if (window.__holo.uniforms.uHasLine) window.__holo.uniforms.uHasLine.value = 0.0;
    }
  });
}

// 构建 Layer B 超大高斯氛围底衬画布 (为大角度极限视差提供充沛的虚化底衬，彻底消灭拉丝)
function createBlurBackdropCanvas(img) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 768;
  const ctx = c.getContext("2d");
  if (img) {
    ctx.filter = "blur(24px) saturate(135%)";
    ctx.drawImage(img, -40, -60, 512 + 80, 768 + 120);
  } else {
    ctx.fillStyle = "#141615";
    ctx.fillRect(0, 0, 512, 768);
  }
  return c;
}
let rafBgId = null;
function syncBackground3D() {
  if (!window.__holo || !window.__holo.uniforms) return;
  if (rafBgId) cancelAnimationFrame(rafBgId);
  rafBgId = requestAnimationFrame(() => {
    let bgCvs;
    if (rawBgImg) {
      bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
    } else {
      bgCvs = document.createElement("canvas");
      bgCvs.width = 1024;
      bgCvs.height = 1536;
      const ctx = bgCvs.getContext("2d");
      ctx.fillStyle = "#141615";
      ctx.fillRect(0, 0, 1024, 1536);
      const rad = ctx.createRadialGradient(512, 768, 50, 512, 768, 700);
      rad.addColorStop(0, "rgba(255, 255, 255, 0.04)");
      rad.addColorStop(1, "rgba(0, 0, 0, 0.65)");
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, 1024, 1536);
    }
    safeUpdateCanvasTexture(window.__holo.uniforms.tBackground, bgCvs);
    if (window.__holo.uniforms.tBackgroundBlur) {
      const blurCvs = createBlurBackdropCanvas(rawBgImg);
      safeUpdateCanvasTexture(window.__holo.uniforms.tBackgroundBlur, blurCvs);
    }
  });
}

let rafTextId = null;
function syncTextAndBack3D() {
  if (!window.__holo || !window.__holo.uniforms) return;
  if (rafTextId) cancelAnimationFrame(rafTextId);
  rafTextId = requestAnimationFrame(() => {
    const textCvs = drawTextCanvas(state);
    safeUpdateCanvasTexture(window.__holo.uniforms.tText, textCvs);

    if (window.__holo.uniforms.tBack) {
      const backCvs = drawBackCanvas(state, rawBgImg, rawSubjectImg);
      safeUpdateCanvasTexture(window.__holo.uniforms.tBack, backCvs);
    }
    updateAboutModal();
  });
}

// 同步所有图层与参数到 Page B (3D 全息视图)
function syncTo3D() {
  if (!window.__holo || !window.THREE || !window.__holo.uniforms) return;

  // 1. 背景纹理安全更新 (单素材容错)
  let bgCvs;
  if (rawBgImg) {
    bgCvs = fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur);
  } else {
    bgCvs = document.createElement("canvas");
    bgCvs.width = 1024;
    bgCvs.height = 1536;
    const ctx = bgCvs.getContext("2d");
    ctx.fillStyle = "#141615";
    ctx.fillRect(0, 0, 1024, 1536);
    const rad = ctx.createRadialGradient(512, 768, 50, 512, 768, 700);
    rad.addColorStop(0, "rgba(255, 255, 255, 0.04)");
    rad.addColorStop(1, "rgba(0, 0, 0, 0.65)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 1024, 1536);
  }
  safeUpdateCanvasTexture(window.__holo.uniforms.tBackground, bgCvs);
  if (window.__holo.uniforms.tBackgroundBlur) {
    const blurCvs = createBlurBackdropCanvas(rawBgImg);
    safeUpdateCanvasTexture(window.__holo.uniforms.tBackgroundBlur, blurCvs);
  }
  // 2. 主体与线稿纹理安全更新 (单素材容错：无主体时设为透明1x1网格，关闭线稿Sobel)
  if (rawSubjectImg) {
    const subjCvs = fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0);
    safeUpdateCanvasTexture(window.__holo.uniforms.tSubject, subjCvs);
    try {
      const lineCvs = generateLineart(subjCvs);
      safeUpdateCanvasTexture(window.__holo.uniforms.tLine, lineCvs);
    } catch (e) {
      console.warn("Lineart sync error:", e);
    }
    if (window.__holo.uniforms.uHasLine) window.__holo.uniforms.uHasLine.value = 1.0;
  } else {
    const emptyCvs = document.createElement("canvas");
    emptyCvs.width = 1;
    emptyCvs.height = 1;
    safeUpdateCanvasTexture(window.__holo.uniforms.tSubject, emptyCvs);
    safeUpdateCanvasTexture(window.__holo.uniforms.tLine, emptyCvs);
    if (window.__holo.uniforms.uHasLine) window.__holo.uniforms.uHasLine.value = 0.0;
  }

  // 3. 文字边框纹理安全更新
  const textCvs = drawTextCanvas(state);
  safeUpdateCanvasTexture(window.__holo.uniforms.tText, textCvs);

  // 3.5 同步卡面特效至 3D 浮层 (具备真实三维景深视差与辉光调节，支持破框)
  if (state.cardEffect && state.cardEffect !== "none") {
    const fxCvs = getEffectCanvas(state.cardEffect);
    if (fxCvs) {
      safeUpdateCanvasTexture(window.__holo.uniforms.tEffects, fxCvs);
      if (window.__holo.uniforms.uHasFx) window.__holo.uniforms.uHasFx.value = 1.0;
      if (typeof window.__holo.updateFxTransform === "function") {
        window.__holo.updateFxTransform(state.fxScale, state.fxX, state.fxY, state.effectsDepth, true);
      }
    }
  } else {
    if (window.__holo.uniforms.uHasFx) window.__holo.uniforms.uHasFx.value = 0.0;
    if (typeof window.__holo.updateFxTransform === "function") {
      window.__holo.updateFxTransform(state.fxScale, state.fxX, state.fxY, state.effectsDepth, false);
    }
  }

  // 4. 着色器物理参数极速同步
  sync3DUniforms();

  // 5. 更新网页文本
  const tEl = $("card-title");
  if (tEl) tEl.textContent = state.title;
  const sEl = $("subtitle");
  if (sEl) sEl.textContent = state.subtitle;
  const dEl = $("description");
  if (dEl) dEl.textContent = state.tagline;
  const eEl = $("edition");
  if (eEl) eEl.textContent = state.edition;
  updateAboutModal();

  // 6. 卡背纹理更新 (支持4款卡背风格与正面文字/首字/配色完全实时动态联动)
  if (window.__holo && window.__holo.uniforms && window.__holo.uniforms.tBack) {
    const backCvs = drawBackCanvas(state, rawBgImg, rawSubjectImg);
    safeUpdateCanvasTexture(window.__holo.uniforms.tBack, backCvs);
  }

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

  // 1. 生成最新真实 PNG 图层 (单素材容错)
  const bgCvs = rawBgImg
    ? fitImageToCanvas(rawBgImg, state.bgScale, state.bgX, state.bgY, false, state.bgBlur)
    : (() => {
        const c = document.createElement("canvas");
        c.width = 1024; c.height = 1536;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#141615"; ctx.fillRect(0, 0, 1024, 1536);
        return c;
      })();
  const subjCvs = rawSubjectImg
    ? fitImageToCanvas(rawSubjectImg, state.subjectScale, state.subjectX, state.subjectY, true, 0)
    : (() => {
        const c = document.createElement("canvas");
        c.width = 1; c.height = 1;
        return c;
      })();
  const textCvs = drawTextCanvas(state);
  const lineCvs = rawSubjectImg ? generateLineart(subjCvs) : (() => {
    const c = document.createElement("canvas");
    c.width = 1; c.height = 1;
    return c;
  })();
  const backCvs = drawBackCanvas(state, rawBgImg, rawSubjectImg);

  const getBlob = (cvs) => new Promise((resolve) => cvs.toBlob(resolve, "image/png"));

  const [bgBlob, subjBlob, textBlob, lineBlob, backBlob] = await Promise.all([
    getBlob(bgCvs),
    getBlob(subjCvs),
    getBlob(textCvs),
    getBlob(lineCvs),
    getBlob(backCvs)
  ]);

  const assets = zip.folder("assets");
  assets.file("background.png", bgBlob);
  assets.file("subject.png", subjBlob);
  assets.file("text.png", textBlob);
  assets.file("lineart.png", lineBlob);
  assets.file("back.png", backBlob);

  // 如果启用了卡面特效，导出特效图层 (支持自定义上传与内置特效)
  if (state.cardEffect && state.cardEffect !== "none") {
    try {
      if (state.cardEffect === "custom" && customFxImg) {
        const fxBlob = await imageToBlob(customFxImg);
        if (fxBlob) assets.file("effects.png", fxBlob);
      } else {
        const effSrc = effectSources[state.cardEffect];
        if (effSrc) {
          const fxRes = await fetch(effSrc);
          if (fxRes.ok) {
            const fxBuf = await fxRes.arrayBuffer();
            assets.file("effects.png", fxBuf);
          }
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
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
      finish: state.finish || "pearl",
      backStyle: state.backStyle || "ambient"
    },
    parameters: {
      subjectScale: 1.0,
      subjectDepth: state.depth,
      backgroundDepth: state.bgDepth,
      diff: state.diff ?? 1.0,
      effectsDepth: state.effectsDepth ?? 0.14,
      foil: state.foil,
      fxGlow: state.fxGlow ?? 0.5,
      fxScale: state.fxScale ?? 1.0,
      fxX: state.fxX ?? 0,
      fxY: state.fxY ?? 0
    },
    safeArea: {
      scale: 1.0,
      offset: [0, 0]
    },
    assets: {
      subject: "./assets/subject.png",
      background: "./assets/background.png",
      text: "./assets/text.png",
      back: "./assets/back.png",
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
    triggerBtn.innerHTML = "<span>正在打包纯享展台...</span>";
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

// ==========================================================================
// Netlify 双阶段一键部署向导 (Two-Step Guided Deployment to Netlify Drop)
// ==========================================================================

// 打开部署向导弹窗 (step: 1 为下载包，2 为上传指引)
function openDeployModal(step = 1) {
  const modal = $("modal-deploy");
  if (!modal) return;
  modal.classList.remove("hidden");
  setDeployModalStep(step);
}

function closeDeployModal() {
  const modal = $("modal-deploy");
  if (modal) modal.classList.add("hidden");
}

function setDeployModalStep(step) {
  const step1 = $("deploy-view-step1");
  const step2 = $("deploy-view-step2");
  const badge = $("deploy-modal-step-badge");
  const title = $("deploy-modal-title");
  if (step === 1) {
    if (step1) step1.style.display = "flex";
    if (step2) step2.style.display = "none";
    if (badge) badge.textContent = "步骤 1 / 2";
    if (title) title.textContent = "准备 Netlify 部署包";
  } else {
    if (step1) step1.style.display = "none";
    if (step2) step2.style.display = "flex";
    if (badge) badge.textContent = "步骤 2 / 2";
    if (title) title.textContent = "前往 Netlify Drop 上线";
  }
}

// 步骤 1：生成并下载纯享展台包，下载完成后自动平滑弹入步骤 2 引导
async function handleDeployStep1Download(triggerBtn) {
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>正在生成纯享部署包...</span>";
  }
  try {
    const zip = await buildPureViewerZip();
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `holo-card-${state.title || "card"}-viewer-netlify.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    showToast("纯享部署包已成功下载！即将前往 Netlify Drop 上线");

    // 自动平滑切换到阶段 2 引导弹窗
    setTimeout(() => {
      setDeployModalStep(2);
    }, 450);
  } catch (err) {
    console.error("Generate deploy package error:", err);
    alert("生成部署包失败: " + err.message);
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origHtml;
    }
  }
}

// ==========================================================================
// 3 秒全息卡牌动态检视 GIF 录制与导出系统 (Seamless Loop GIF Engine)
// ==========================================================================

function openGifModal() {
  const modal = $("modal-gif-preview");
  if (modal) modal.classList.remove("hidden");
}

function closeGifModal() {
  const modal = $("modal-gif-preview");
  if (modal) modal.classList.add("hidden");
}

async function recordCardGif(triggerBtn) {
  if (!window.__holo || typeof window.__holo.recordGifFrames !== "function") {
    alert("3D 渲染引擎未就绪，请稍后重试");
    return;
  }
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>⏳ 正在录制动图 1/60 帧... 请稍候</span>";
  }
  showToast("正在录制 3 秒卡牌检视动图（共 60 帧），请稍候...", 3500);

  try {
    // 1. 抓取 60 帧首尾咬合无缝循环画面 (400x560, 20fps)
    const frames = await window.__holo.recordGifFrames((current, total) => {
      if (triggerBtn) {
        triggerBtn.innerHTML = `<span>⏳ 正在录制动图 ${current}/${total} 帧... 请稍候</span>`;
      }
    });

    if (triggerBtn) {
      triggerBtn.innerHTML = "<span>⚡ 正在高速编码 GIF... 请稍候</span>";
    }
    showToast("画面捕获完毕，正在高速量化与编码 GIF，请稍候...", 3500);
    await new Promise((r) => setTimeout(r, 20));

    // 2. 纯前端高保真调色板量化与快速编码
    const gif = GIFEncoder();
    const width = 400;
    const height = 560;

    for (let i = 0; i < frames.length; i++) {
      const frameData = frames[i];
      const palette = quantize(frameData, 128);
      const index = applyPalette(frameData, palette);
      gif.writeFrame(index, width, height, { palette, delay: 50 });

      if (i % 8 === 0 && triggerBtn) {
        triggerBtn.innerHTML = `<span>⚡ 正在编码 GIF ${Math.round((i / frames.length) * 100)}%...</span>`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    gif.finish();
    const bytes = gif.bytes();
    const gifBlob = new Blob([bytes], { type: "image/gif" });
    const sizeMb = (gifBlob.size / (1024 * 1024)).toFixed(1);

    // 3. 填充预览弹窗并呈现
    const previewImg = $("gif-preview-img");
    const sizeBadge = $("gif-filesize-badge");
    const downloadBtn = $("btn-download-gif");

    if (previewImg) previewImg.src = URL.createObjectURL(gifBlob);
    if (sizeBadge) sizeBadge.textContent = `约 ${sizeMb} MB`;
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(gifBlob);
        a.download = `holo-card-${state.title || "card"}-3s-loop.gif`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast("GIF 动图已开始下载！");
      };
    }

    openGifModal();
    showToast("3 秒全息卡牌动图已生成！");
  } catch (err) {
    console.error("Record GIF error:", err);
    alert("录制 GIF 动图失败: " + err.message);
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origHtml;
    }
  }
}

// ==========================================================================
// 1080P 60 帧 MP4 动态短视频录制与导出系统 (WebCodecs GPU加速 + mp4-muxer)
// ==========================================================================

function openMp4Modal() {
  const modal = $("modal-mp4-preview");
  if (modal) modal.classList.remove("hidden");
}

function closeMp4Modal() {
  const modal = $("modal-mp4-preview");
  if (modal) {
    modal.classList.add("hidden");
    const videoEl = $("mp4-preview-video");
    if (videoEl) {
      videoEl.pause();
      videoEl.src = "";
    }
  }
}

async function recordCardMp4(triggerBtn) {
  if (!window.__holo || typeof window.__holo.recordVideoFrames !== "function") {
    alert("3D 渲染引擎未就绪，请稍后重试");
    return;
  }
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>⏳ 正在初始化 1080P 60FPS 编码器...</span>";
  }
  showToast("正在录制 3 秒 1080P 60 帧超清短视频（共 180 帧）...", 3500);

  const width = 1080;
  const height = 1512;
  const fps = 60;
  const totalFrames = 180;

  try {
    if (typeof VideoEncoder !== "undefined") {
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: "avc",
          width: width,
          height: height
        },
        fastStart: "in-memory"
      });

      let encodeError = null;
      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          console.error("VideoEncoder error:", e);
          encodeError = e;
        }
      });

      await videoEncoder.configure({
        codec: "avc1.640028",
        width: width,
        height: height,
        bitrate: 10_000_000,
        framerate: fps
      });

      let lastUiYield = performance.now();

      await window.__holo.recordVideoFrames(width, height, totalFrames, async (canvas, i, total) => {
        if (encodeError) throw encodeError;

        const timestampUs = Math.round(i * (1_000_000 / fps));
        const frame = new VideoFrame(canvas, { timestamp: timestampUs });
        videoEncoder.encode(frame, { keyFrame: i % 60 === 0 });
        frame.close();

        if (i % 12 === 0 || i === total - 1) {
          const pct = Math.round(((i + 1) / total) * 88);
          if (triggerBtn) {
            triggerBtn.innerHTML = `<span>⚡ 渲染与编码 ${i + 1}/${total} 帧 (${pct}%)...</span>`;
          }
          if (performance.now() - lastUiYield > 30) {
            await new Promise((r) => setTimeout(r, 0));
            lastUiYield = performance.now();
          }
        }
      });

      if (triggerBtn) {
        triggerBtn.innerHTML = "<span>📦 正在封装 MP4 视频文件...</span>";
      }

      await videoEncoder.flush();
      muxer.finalize();

      const buffer = muxer.target.buffer;
      const mp4Blob = new Blob([buffer], { type: "video/mp4" });
      displayMp4Result(mp4Blob);
    } else {
      // 兼容兜底模式：MediaRecorder
      await recordViaMediaRecorder(width, height, totalFrames, fps, triggerBtn);
    }
  } catch (err) {
    console.error("Record MP4 video error:", err);
    alert("导出 1080P MP4 视频失败: " + err.message);
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origHtml;
    }
  }
}

// MediaRecorder 兼容兜底方案
async function recordViaMediaRecorder(width, height, totalFrames, fps, triggerBtn) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const stream = canvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E"')
    ? 'video/mp4; codecs="avc1.42E01E"'
    : (MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm");

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordPromise = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };
  });

  recorder.start();

  await window.__holo.recordVideoFrames(width, height, totalFrames, async (frameCanvas, i, total) => {
    ctx.drawImage(frameCanvas, 0, 0);
    if (i % 12 === 0 && triggerBtn) {
      const pct = Math.round(((i + 1) / total) * 90);
      triggerBtn.innerHTML = `<span>⚡ 正在录制视频 ${i + 1}/${total} 帧 (${pct}%)...</span>`;
      await new Promise((r) => setTimeout(r, 0));
    }
  });

  recorder.stop();
  const videoBlob = await recordPromise;
  displayMp4Result(videoBlob);
}

function displayMp4Result(blob) {
  const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
  const videoEl = $("mp4-preview-video");
  const sizeBadge = $("mp4-filesize-badge");
  const downloadBtn = $("btn-download-mp4");

  const videoUrl = URL.createObjectURL(blob);
  if (videoEl) {
    videoEl.src = videoUrl;
    videoEl.load();
    videoEl.play().catch(() => {});
  }
  if (sizeBadge) {
    sizeBadge.textContent = `约 ${sizeMb} MB · 1080P 60FPS`;
  }
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = videoUrl;
      const cName = state.title || "card";
      a.download = `holo-card-${cName}-1080p-60fps.mp4`;
      a.click();
      showToast("1080P MP4 视频已开始下载！");
    };
  }

  openMp4Modal();
  showToast("🎬 1080P 60帧全息卡牌短视频已生成！");
}


// 导出包含工坊与展台的完整整套网站部署包 (将当前配置固化为整站默认设置)
async function exportFullWebsiteZip(triggerBtn) {
  const origHtml = triggerBtn ? triggerBtn.innerHTML : "";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = "<span>正在打包整站部署包...</span>";
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
        cardEffect: state.cardEffect || "none",
        backStyle: state.backStyle || "ambient"
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

      if (!isPageB) render2DPreview();
      if (isPageB) syncTextAndBack3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncTextAndBack3D();
    };
  }

  const themeEl = $(prefix + "-theme");
  if (themeEl) {
    themeEl.value = state.colorTheme;
    themeEl.onchange = (e) => {
      state.colorTheme = e.target.value;
      const other = $(prefix === "ws" ? "b-theme" : "ws-theme");
      if (other) other.value = e.target.value;
      if (!isPageB) render2DPreview();
      if (isPageB) syncTextAndBack3D();
    };
  }

  const backStyleEl = $(prefix + "-back-style");
  if (backStyleEl) {
    backStyleEl.value = state.backStyle || "ambient";
    backStyleEl.onchange = (e) => {
      state.backStyle = e.target.value;
      const other = $(prefix === "ws" ? "b-back-style" : "ws-back-style");
      if (other) other.value = e.target.value;

      const showBackRename = state.backStyle.startsWith("custom");
      if (showBackRename) {
        const backId = state.backStyle === "custom" ? state.activeCustomBackId : state.backStyle.replace("custom_", "");
        const found = customBackLibrary.find(x => x.id === backId);
        if (found) {
          state.activeCustomBackId = found.id;
          state.customBackName = found.name;
          customBackImg = found.img;
          hasCustomBack = true;
          localStorage.setItem("holo_card_active_back_id", found.id);
        }
      }
      ["ws", "b"].forEach((p) => {
        const rb = $(p + "-back-rename-box");
        if (rb) rb.style.display = showBackRename ? "flex" : "none";
        const nameInp = $(p + "-custom-back-name");
        if (nameInp && showBackRename) nameInp.value = state.customBackName || "自定义卡背";
      });

      if (!isPageB) render2DPreview();
      if (isPageB) syncTextAndBack3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncSubject3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncSubject3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncSubject3D();
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
      if (isPageB) syncSubject3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncBackground3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncBackground3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncBackground3D();
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
      if (!isPageB) render2DPreview();
      if (isPageB) syncBackground3D();
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
      if (isPageB) syncBackground3D();
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
      if (isPageB) sync3DUniforms();
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
      if (isPageB) sync3DUniforms();
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
      if (isPageB) sync3DUniforms();
    };
  }

  // 7. 特效悬浮深度调节 (3D 景深视差)
  const fxDepth = $(prefix + "-fx-depth");
  const fxDepthVal = $(prefix + "-val-fx-depth");
  if (fxDepth) {
    fxDepth.value = state.effectsDepth ?? 0.14;
    if (fxDepthVal) fxDepthVal.textContent = (state.effectsDepth ?? 0.14).toFixed(2);
    fxDepth.oninput = (e) => {
      state.effectsDepth = parseFloat(e.target.value);
      if (fxDepthVal) fxDepthVal.textContent = state.effectsDepth.toFixed(2);
      const other = $(prefix === "ws" ? "b-fx-depth" : "ws-fx-depth");
      const otherVal = $(prefix === "ws" ? "b-val-fx-depth" : "ws-val-fx-depth");
      if (other) other.value = state.effectsDepth;
      if (otherVal) otherVal.textContent = fxDepthVal.textContent;
      if (isPageB) sync3DUniforms();
    };
  }

  // 7.5 特效破框与构图微调 (缩放、水平X、垂直Y与重置)
  const fxScale = $(prefix + "-fx-scale");
  const fxScaleVal = $(prefix + "-val-fx-scale");
  if (fxScale) {
    fxScale.value = state.fxScale ?? 1.0;
    if (fxScaleVal) fxScaleVal.textContent = (state.fxScale ?? 1.0).toFixed(2) + "x";
    fxScale.oninput = (e) => {
      state.fxScale = parseFloat(e.target.value);
      if (fxScaleVal) fxScaleVal.textContent = state.fxScale.toFixed(2) + "x";
      const other = $(prefix === "ws" ? "b-fx-scale" : "ws-fx-scale");
      const otherVal = $(prefix === "ws" ? "b-val-fx-scale" : "ws-val-fx-scale");
      if (other) other.value = state.fxScale;
      if (otherVal) otherVal.textContent = fxScaleVal.textContent;
      if (!isPageB) render2DPreview();
      if (isPageB) sync3DUniforms();
    };
  }

  const fxX = $(prefix + "-fx-x");
  const fxXVal = $(prefix + "-val-fx-x");
  if (fxX) {
    fxX.value = state.fxX ?? 0;
    if (fxXVal) fxXVal.textContent = (state.fxX ?? 0) + "px";
    fxX.oninput = (e) => {
      state.fxX = parseInt(e.target.value);
      if (fxXVal) fxXVal.textContent = state.fxX + "px";
      const other = $(prefix === "ws" ? "b-fx-x" : "ws-fx-x");
      const otherVal = $(prefix === "ws" ? "b-val-fx-x" : "ws-val-fx-x");
      if (other) other.value = state.fxX;
      if (otherVal) otherVal.textContent = fxXVal.textContent;
      if (!isPageB) render2DPreview();
      if (isPageB) sync3DUniforms();
    };
  }

  const fxY = $(prefix + "-fx-y");
  const fxYVal = $(prefix + "-val-fx-y");
  if (fxY) {
    fxY.value = state.fxY ?? 0;
    if (fxYVal) fxYVal.textContent = (state.fxY ?? 0) + "px";
    fxY.oninput = (e) => {
      state.fxY = parseInt(e.target.value);
      if (fxYVal) fxYVal.textContent = state.fxY + "px";
      const other = $(prefix === "ws" ? "b-fx-y" : "ws-fx-y");
      const otherVal = $(prefix === "ws" ? "b-val-fx-y" : "ws-val-fx-y");
      if (other) other.value = state.fxY;
      if (otherVal) otherVal.textContent = fxYVal.textContent;
      if (!isPageB) render2DPreview();
      if (isPageB) sync3DUniforms();
    };
  }

  const resetFx = $(prefix + "-reset-fx-pos");
  if (resetFx) {
    resetFx.onclick = () => {
      state.fxScale = 1.0;
      state.fxX = 0;
      state.fxY = 0;
      ["ws", "b"].forEach((p) => {
        const sc = $(p + "-fx-scale");
        const scV = $(p + "-val-fx-scale");
        const x = $(p + "-fx-x");
        const xV = $(p + "-val-fx-x");
        const y = $(p + "-fx-y");
        const yV = $(p + "-val-fx-y");
        if (sc) sc.value = 1.0;
        if (scV) scV.textContent = "1.00x";
        if (x) x.value = 0;
        if (xV) xV.textContent = "0px";
        if (y) y.value = 0;
        if (yV) yV.textContent = "0px";
      });
      render2DPreview();
      if (isPageB) sync3DUniforms();
    };
  }

  // 7.6 自定义特效与卡背重命名输入 (实时持久化至 IndexedDB 库)
  const customFxNameInput = $(prefix + "-custom-fx-name");
  if (customFxNameInput) {
    customFxNameInput.value = state.customFxName || "自定义特效";
    customFxNameInput.oninput = async (e) => {
      state.customFxName = e.target.value.trim() || "自定义特效";
      const other = $(prefix === "ws" ? "b-custom-fx-name" : "ws-custom-fx-name");
      if (other) other.value = e.target.value;

      localStorage.setItem("holo_card_custom_fx_name_" + (state.activeCustomFxId || ""), state.customFxName);
      if (state.activeCustomFxId) {
        const found = customFxLibrary.find(x => x.id === state.activeCustomFxId);
        if (found) {
          found.name = state.customFxName;
          await dbSaveCustomFx(found);
        }
      }
      renderCustomFxPills();
      if (state.cardEffect.startsWith("custom")) {
        document.querySelectorAll(".effect-name-val").forEach((el) => {
          el.textContent = state.customFxName;
        });
      }
    };
  }

  const customBackNameInput = $(prefix + "-custom-back-name");
  if (customBackNameInput) {
    customBackNameInput.value = state.customBackName || "自定义卡背";
    customBackNameInput.oninput = async (e) => {
      state.customBackName = e.target.value.trim() || "自定义卡背";
      const other = $(prefix === "ws" ? "b-custom-back-name" : "ws-custom-back-name");
      if (other) other.value = e.target.value;

      localStorage.setItem("holo_card_custom_back_name_" + (state.activeCustomBackId || ""), state.customBackName);
      if (state.activeCustomBackId) {
        const found = customBackLibrary.find(x => x.id === state.activeCustomBackId);
        if (found) {
          found.name = state.customBackName;
          await dbSaveCustomBack(found);
        }
      }
      renderCustomBackOptions();
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
      // 阻止触摸滑条手势冒泡至轮播容器，彻底杜绝向左滑动调参误切换至第2页导出中心
      input.addEventListener("touchstart", (e) => {
        e.stopPropagation();
      }, { passive: true });
      input.addEventListener("touchmove", (e) => {
        e.stopPropagation();
      }, { passive: true });
      input.addEventListener("touchend", (e) => {
        e.stopPropagation();
        clearTimeout(activeTimer);
        activeTimer = setTimeout(lockAll, 2500);
      }, { passive: true });

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


// ==========================================================================
// 精修侧边栏左右双分屏与 Tab 切换系统 (Two-Page Carousel & Tab System)
// ==========================================================================
let currentBSidebarPage = 1;

function switchBSidebarPage(pageNum, immediate = false) {
  currentBSidebarPage = pageNum === 2 ? 2 : 1;
  const carousel = $("b-sidebar-carousel");
  const tabAdjust = $("b-tab-adjust");
  const tabExport = $("b-tab-export");
  const dotAdjust = $("dot-page-adjust");
  const dotExport = $("dot-page-export");

  if (immediate && carousel) {
    carousel.classList.add("no-transition");
  }

  if (currentBSidebarPage === 1) {
    if (carousel) carousel.classList.remove("show-page-2");
    if (tabAdjust) {
      tabAdjust.classList.add("active");
      tabAdjust.setAttribute("aria-selected", "true");
    }
    if (tabExport) {
      tabExport.classList.remove("active");
      tabExport.setAttribute("aria-selected", "false");
    }
    if (dotAdjust) dotAdjust.classList.add("active");
    if (dotExport) dotExport.classList.remove("active");
  } else {
    if (carousel) carousel.classList.add("show-page-2");
    if (tabAdjust) {
      tabAdjust.classList.remove("active");
      tabAdjust.setAttribute("aria-selected", "false");
    }
    if (tabExport) {
      tabExport.classList.add("active");
      tabExport.setAttribute("aria-selected", "true");
    }
    if (dotAdjust) dotAdjust.classList.remove("active");
    if (dotExport) dotExport.classList.add("active");
  }

  if (immediate && carousel) {
    void carousel.offsetHeight; // 强制回流
    carousel.classList.remove("no-transition");
  }
}

// 触摸手势左右滑动监听 (Swipe View) - 严格防止滑块拖拽误触切页
function initBSidebarSwipe() {
  const carousel = $("b-sidebar-carousel");
  if (!carousel) return;

  let startX = 0;
  let startY = 0;
  let isSwiping = false;

  carousel.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    // 如果触摸起点落在滑条、输入控件、按钮或选择器上，坚决不触发轮播切页手势
    if (e.target.closest('input, select, button, label, .slider-row, .drawer-range, .swatches, .swatch, .effect-pill, .custom-rename-row, .effect-select-row, .form-field')) {
      isSwiping = false;
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwiping = true;
  }, { passive: true });

  carousel.addEventListener("touchend", (e) => {
    if (!isSwiping || e.changedTouches.length !== 1) return;
    isSwiping = false;
    // 检查抬起点是否在滑条或交互控件上
    if (e.target.closest('input, select, button, label, .slider-row, .drawer-range, .swatches, .swatch, .effect-pill')) {
      return;
    }
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - startX;
    const diffY = endY - startY;

    // 水平滑动距离阈值提升至 75px，且横向位移必须显著大于纵向位移 (1.6倍)，防止斜向滑动与滑动调参误触发切页
    if (Math.abs(diffX) > 75 && Math.abs(diffX) > Math.abs(diffY) * 1.6) {
      if (diffX < 0 && currentBSidebarPage === 1) {
        // 向左轻扫：进入第 2 页（导出与发布）
        switchBSidebarPage(2);
      } else if (diffX > 0 && currentBSidebarPage === 2) {
        // 向右轻扫：返回第 1 页（参数排版）
        switchBSidebarPage(1);
      }
    }
  }, { passive: true });
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
    switchBSidebarPage(1, true); // 静默确保是第1页，无多余卡顿
    bSidebar?.classList.add("open");
    setBackdrops(true);
  };
  const closeB = () => {
    bSidebar?.classList.remove("open");
    setBackdrops(false);
    // 抽屉完全滑出屏幕后，在后台静默归位第 1 页
    setTimeout(() => {
      switchBSidebarPage(1, true);
    }, 320);
  };

  if (wsOpenBtn) wsOpenBtn.onclick = openWs;
  if (wsHeaderBtn) wsHeaderBtn.onclick = openWs;
  if (wsCloseBtn) wsCloseBtn.onclick = closeWs;

  if (bFloatBtn) bFloatBtn.onclick = openB;
  if (bHeaderBtn) bHeaderBtn.onclick = openB;
  if (bCloseBtn) bCloseBtn.onclick = closeB;

  // B 侧边栏双 Tab 标签、跳转按钮与滑动监听
  const tabAdjust = $("b-tab-adjust");
  const tabExport = $("b-tab-export");
  if (tabAdjust) tabAdjust.onclick = () => switchBSidebarPage(1);
  if (tabExport) tabExport.onclick = () => switchBSidebarPage(2);

  const jumpToExport = $("btn-jump-to-export");
  if (jumpToExport) jumpToExport.onclick = () => switchBSidebarPage(2);

  const jumpToAdjust = $("btn-jump-to-adjust");
  if (jumpToAdjust) jumpToAdjust.onclick = () => switchBSidebarPage(1);

  const dotAdjust = $("dot-page-adjust");
  const dotExport = $("dot-page-export");
  if (dotAdjust) dotAdjust.onclick = () => switchBSidebarPage(1);
  if (dotExport) dotExport.onclick = () => switchBSidebarPage(2);

  initBSidebarSwipe();

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


// 初始化卡面特效控制器 (支持多自制特效库与药丸命名动态高亮)
function setCardEffect(eff) {
  state.cardEffect = eff || "none";
  document.querySelectorAll("[data-effect]").forEach((b) => {
    const isActive = b.dataset.effect === state.cardEffect;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", String(isActive));
  });

  const isCustom = state.cardEffect.startsWith("custom");
  const displayName = isCustom
    ? (state.customFxName || "★ 自定义特效")
    : (effectNames[state.cardEffect] || state.cardEffect);
  document.querySelectorAll(".effect-name-val").forEach((el) => {
    el.textContent = displayName;
  });

  const hasCustom = customFxLibrary.length > 0 || Boolean(customFxImg);
  ["ws", "b"].forEach((p) => {
    const renameBox = $(p + "-fx-rename-box");
    const nameInput = $(p + "-custom-fx-name");
    if (renameBox) {
      renameBox.style.display = (hasCustom && isCustom) ? "flex" : "none";
    }
    if (nameInput && isCustom) {
      nameInput.value = state.customFxName || "自定义特效";
    }
  });

  renderCustomFxPills();
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
window.showToast = showToast;

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

function imageToDataUrl(img) {
  if (!img) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width || 1024;
      c.height = img.naturalHeight || img.height || 1536;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL("image/png"));
    } catch (e) {
      console.warn("imageToDataUrl error:", e);
      resolve(null);
    }
  });
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return Promise.resolve(null);
  }
  try {
    const parts = dataUrl.split(",");
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return Promise.resolve(new Blob([u8arr], { type: mime }));
  } catch (e) {
    return fetch(dataUrl).then((r) => r.blob()).catch(() => null);
  }
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
    triggerBtn.innerHTML = "<span>正在导出卡牌...</span>";
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

    const activeCustomFx = customFxLibrary.find(x => x.id === state.activeCustomFxId);
    const fxImgToExport = activeCustomFx?.img || customFxImg;
    const isFxCustom = state.cardEffect?.startsWith("custom") || hasCustomFx;

    const activeCustomBack = customBackLibrary.find(x => x.id === state.activeCustomBackId);
    const backImgToExport = activeCustomBack?.img || customBackImg;
    const isBackCustom = state.backStyle?.startsWith("custom") || hasCustomBack;

    const [subjBlob, bgBlob, fxBlob, backBlob] = await Promise.all([
      rawSubjectImg ? imageToBlob(rawSubjectImg) : Promise.resolve(null),
      rawBgImg ? imageToBlob(rawBgImg) : Promise.resolve(null),
      (isFxCustom && fxImgToExport) ? imageToBlob(fxImgToExport) : Promise.resolve(null),
      (isBackCustom && backImgToExport) ? imageToBlob(backImgToExport) : Promise.resolve(null)
    ]);
    const [subjUrl, bgUrl, fxUrl, backUrl] = await Promise.all([
      blobToDataUrl(subjBlob),
      blobToDataUrl(bgBlob),
      blobToDataUrl(fxBlob),
      blobToDataUrl(backBlob)
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
        collection: state.collection || "水王级",
        technique: state.technique || "",
        tagline: state.tagline || "",
        edition: state.edition || "001 / 001",
        borderStyle: state.borderStyle || "ornamental",
        colorTheme: state.colorTheme || "cyan",
        backStyle: state.backStyle || "ambient",
        finish: state.finish || "pearl",
        cardEffect: state.cardEffect || "star_glint",
        customFxName: state.customFxName || "自定义特效",
        customBackName: state.customBackName || "自定义卡背",
        effectsDepth: state.effectsDepth ?? 0.14,
        fxScale: state.fxScale ?? 1.0,
        fxX: state.fxX ?? 0,
        fxY: state.fxY ?? 0,
        activeCustomFxId: state.activeCustomFxId,
        activeCustomBackId: state.activeCustomBackId,
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
        fxGlow: state.fxGlow ?? 0.5,
        thumbDataUrl,
        subjectDataUrl: subjUrl,
        bgDataUrl: bgUrl,
        fxDataUrl: fxUrl,
        backDataUrl: backUrl,
        isCustomSubject: Boolean(rawSubjectImg),
        isCustomBg: Boolean(rawBgImg),
        isCustomFx: Boolean(fxBlob),
        isCustomBack: Boolean(backBlob)
      }
    };

    downloadJson(exportData, "holo-card-" + cName + ".json");
    showToast("🎉 卡牌「" + cName + "」已成功导出！可在牌库一键导入");

    if (triggerBtn) {
      triggerBtn.innerHTML = "<span>导出卡牌成功！</span>";
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
    const [subjUrl, bgUrl, fxUrl, backUrl] = await Promise.all([
      blobToDataUrl(card.subjectBlob),
      blobToDataUrl(card.bgBlob),
      blobToDataUrl(card.fxBlob),
      blobToDataUrl(card.backBlob)
    ]);
    const exportData = {
      version: "1.0",
      type: "single",
      exportedAt: Date.now(),
      card: {
        ...card,
        subjectBlob: null,
        bgBlob: null,
        fxBlob: null,
        backBlob: null,
        subjectDataUrl: subjUrl,
        bgDataUrl: bgUrl,
        fxDataUrl: fxUrl,
        backDataUrl: backUrl
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
        const [subjUrl, bgUrl, fxUrl, backUrl] = await Promise.all([
          blobToDataUrl(card.subjectBlob),
          blobToDataUrl(card.bgBlob),
          blobToDataUrl(card.fxBlob),
          blobToDataUrl(card.backBlob)
        ]);
        return {
          ...card,
          subjectBlob: null,
          bgBlob: null,
          fxBlob: null,
          backBlob: null,
          subjectDataUrl: subjUrl,
          bgDataUrl: bgUrl,
          fxDataUrl: fxUrl,
          backDataUrl: backUrl
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
      const [subjBlob, bgBlob, fxBlob, backBlob] = await Promise.all([
        raw.subjectDataUrl ? dataUrlToBlob(raw.subjectDataUrl) : Promise.resolve(raw.subjectBlob || null),
        raw.bgDataUrl ? dataUrlToBlob(raw.bgDataUrl) : Promise.resolve(raw.bgBlob || null),
        raw.fxDataUrl ? dataUrlToBlob(raw.fxDataUrl) : Promise.resolve(raw.fxBlob || null),
        raw.backDataUrl ? dataUrlToBlob(raw.backDataUrl) : Promise.resolve(raw.backBlob || null)
      ]);

      const isSubjCustom = raw.isCustomSubject !== undefined ? raw.isCustomSubject : (raw.subjectDataUrl ? true : !isDefaultSubjectBlob(subjBlob));
      const isBgCustom = raw.isCustomBg !== undefined ? raw.isCustomBg : (raw.bgDataUrl ? true : !isDefaultBgBlob(bgBlob));
      const cardId = "card_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

      // 自动将导入卡牌的自制卡背与特效注册至本地资产库，确保立即生效且可复用
      if (backBlob) {
        const backId = raw.activeCustomBackId || ("back_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6));
        const backName = raw.customBackName || (raw.title ? raw.title + "卡背" : "自制卡背");
        const backDataUrl = raw.backDataUrl || await blobToDataUrl(backBlob);
        const backItem = { id: backId, name: backName, dataUrl: backDataUrl, createdAt: Date.now() };
        await dbSaveCustomBack(backItem);
        if (!customBackLibrary.some(x => x.id === backId)) {
          const img = await blobToImage(backBlob);
          customBackLibrary.push({ ...backItem, img });
        }
      }

      if (fxBlob) {
        const fxId = raw.activeCustomFxId || ("fx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6));
        const fxName = raw.customFxName || (raw.title ? raw.title + "特效" : "自制特效");
        const fxDataUrl = raw.fxDataUrl || await blobToDataUrl(fxBlob);
        const fxItem = { id: fxId, name: fxName, dataUrl: fxDataUrl, createdAt: Date.now() };
        await dbSaveCustomFx(fxItem);
        if (!customFxLibrary.some(x => x.id === fxId)) {
          const img = await blobToImage(fxBlob);
          customFxLibrary.push({ ...fxItem, img });
        }
      }

      const cardRecord = {
        ...raw,
        id: cardId,
        name: raw.name || raw.title || "导入卡牌",
        title: raw.title || raw.name || "导入卡牌",
        backStyle: raw.backStyle || (backBlob ? "custom" : "ambient"),
        subjectBlob: subjBlob,
        bgBlob: bgBlob,
        fxBlob: fxBlob,
        backBlob: backBlob,
        isCustomSubject: isSubjCustom,
        isCustomBg: isBgCustom,
        isCustomFx: Boolean(fxBlob),
        isCustomBack: Boolean(backBlob),
        subjectDataUrl: undefined,
        bgDataUrl: undefined,
        fxDataUrl: undefined,
        backDataUrl: undefined,
        createdAt: raw.createdAt || Date.now()
      };

      await dbSaveCard(cardRecord);
    }

    renderCustomFxPills();
    renderCustomBackOptions();
    await renderDeckGrid();
    await updateDeckBadge();
    showToast("✅ 成功导入 " + incomingCards.length + " 张卡牌！");
  } catch (err) {
    console.error("Import cards error:", err);
    alert("导入卡牌失败: " + err.message);
  }
}

const DB_NAME = "HoloCardVaultDB";
const DB_VERSION = 2;
const STORE_NAME = "cards";
const STORE_FX = "custom_fx";
const STORE_BACKS = "custom_backs";
let memoryDeckStore = null;
let memoryFxStore = new Map();
let memoryBacksStore = new Map();

function isIndexedDBAvailable() {
  try {
    return typeof window !== "undefined" && "indexedDB" in window && window.indexedDB !== null;
  } catch (e) {
    return false;
  }
}

function openDeckDB() {
  return new Promise((resolve) => {
    if (!isIndexedDBAvailable()) {
      if (!memoryDeckStore) memoryDeckStore = new Map();
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_FX)) {
          db.createObjectStore(STORE_FX, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_BACKS)) {
          db.createObjectStore(STORE_BACKS, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn("IndexedDB open error, falling back to in-memory store:", req.error);
        if (!memoryDeckStore) memoryDeckStore = new Map();
        resolve(null);
      };
    } catch (e) {
      console.warn("IndexedDB access blocked, falling back to in-memory store:", e);
      if (!memoryDeckStore) memoryDeckStore = new Map();
      resolve(null);
    }
  });
}

async function dbSaveCard(card) {
  const db = await openDeckDB();
  if (!db) {
    if (!memoryDeckStore) memoryDeckStore = new Map();
    memoryDeckStore.set(card.id, card);
    return card;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(card);
      req.onsuccess = () => resolve(card);
      req.onerror = () => {
        if (req.error && req.error.name === "QuotaExceededError") {
          reject(new Error("本地存储空间已满（IndexedDB 配额超出）。建议先导出备份或清理部分旧卡牌。"));
        } else {
          reject(req.error || new Error("保存卡牌失败"));
        }
      };
    } catch (e) {
      if (e.name === "QuotaExceededError") {
        reject(new Error("本地存储空间已满（IndexedDB 配额超出）。建议先导出备份或清理部分旧卡牌。"));
      } else {
        reject(e);
      }
    }
  });
}

async function dbGetAllCards() {
  const db = await openDeckDB();
  if (!db) {
    return memoryDeckStore ? Array.from(memoryDeckStore.values()) : [];
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(memoryDeckStore ? Array.from(memoryDeckStore.values()) : []);
    } catch (e) {
      resolve(memoryDeckStore ? Array.from(memoryDeckStore.values()) : []);
    }
  });
}

async function dbGetCard(id) {
  const db = await openDeckDB();
  if (!db) {
    return memoryDeckStore ? (memoryDeckStore.get(id) || null) : null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || (memoryDeckStore ? memoryDeckStore.get(id) : null));
      req.onerror = () => resolve(memoryDeckStore ? (memoryDeckStore.get(id) || null) : null);
    } catch (e) {
      resolve(memoryDeckStore ? (memoryDeckStore.get(id) || null) : null);
    }
  });
}

async function dbDeleteCard(id) {
  const db = await openDeckDB();
  if (!db) {
    if (memoryDeckStore) memoryDeckStore.delete(id);
    return true;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch (e) {
      if (memoryDeckStore) memoryDeckStore.delete(id);
      resolve(true);
    }
  });
}

// ==========================================================================
// 自定义特效与卡背本地永久资产库 (Persistent Custom FX & Backs Vault)
// ==========================================================================

async function dbSaveCustomFx(item) {
  const db = await openDeckDB();
  const cleanItem = {
    id: item.id,
    name: item.name || "自定义特效",
    dataUrl: item.dataUrl,
    createdAt: item.createdAt || Date.now()
  };
  if (!db) {
    memoryFxStore.set(cleanItem.id, cleanItem);
    return cleanItem;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_FX, "readwrite");
      const store = tx.objectStore(STORE_FX);
      const req = store.put(cleanItem);
      req.onsuccess = () => resolve(cleanItem);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

async function dbGetAllCustomFx() {
  const db = await openDeckDB();
  if (!db) return Array.from(memoryFxStore.values());
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_FX, "readonly");
      const store = tx.objectStore(STORE_FX);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function dbDeleteCustomFx(id) {
  const db = await openDeckDB();
  if (!db) {
    memoryFxStore.delete(id);
    return true;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_FX, "readwrite");
      const store = tx.objectStore(STORE_FX);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

async function dbSaveCustomBack(item) {
  const db = await openDeckDB();
  const cleanItem = {
    id: item.id,
    name: item.name || "自定义卡背",
    dataUrl: item.dataUrl,
    createdAt: item.createdAt || Date.now()
  };
  if (!db) {
    memoryBacksStore.set(cleanItem.id, cleanItem);
    return cleanItem;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_BACKS, "readwrite");
      const store = tx.objectStore(STORE_BACKS);
      const req = store.put(cleanItem);
      req.onsuccess = () => resolve(cleanItem);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

async function dbGetAllCustomBacks() {
  const db = await openDeckDB();
  if (!db) return Array.from(memoryBacksStore.values());
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_BACKS, "readonly");
      const store = tx.objectStore(STORE_BACKS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function dbDeleteCustomBack(id) {
  const db = await openDeckDB();
  if (!db) {
    memoryBacksStore.delete(id);
    return true;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_BACKS, "readwrite");
      const store = tx.objectStore(STORE_BACKS);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

let customFxLibrary = [];
let customBackLibrary = [];

async function loadCustomAssetsFromDB() {
  try {
    const [fxList, backList] = await Promise.all([
      dbGetAllCustomFx(),
      dbGetAllCustomBacks()
    ]);

    customFxLibrary = await Promise.all(
      (fxList || []).map(async (item) => {
        let img = null;
        if (item.dataUrl) {
          img = await new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => res(null);
            i.src = item.dataUrl;
          });
        }
        return { ...item, img };
      })
    );

    customBackLibrary = await Promise.all(
      (backList || []).map(async (item) => {
        let img = null;
        if (item.dataUrl) {
          img = await new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => res(null);
            i.src = item.dataUrl;
          });
        }
        return { ...item, img };
      })
    );

    renderCustomFxPills();
    renderCustomBackOptions();

    // 检查并恢复上次选中的自定义特效 (持久化记忆恢复)
    const savedActiveFxId = localStorage.getItem("holo_card_active_fx_id");
    let targetFx = savedActiveFxId ? customFxLibrary.find(x => x.id === savedActiveFxId) : null;
    if (!targetFx && customFxLibrary.length > 0 && (state.cardEffect?.startsWith("custom") || state.cardEffect === "custom")) {
      targetFx = customFxLibrary.find(x => x.id === state.cardEffect.replace("custom_", "")) || customFxLibrary[0];
    }
    if (targetFx && targetFx.img) {
      selectCustomFx(targetFx.id, true);
    }

    // 检查并恢复上次选中的自定义卡背 (持久化记忆恢复)
    const savedActiveBackId = localStorage.getItem("holo_card_active_back_id");
    let targetBack = savedActiveBackId ? customBackLibrary.find(x => x.id === savedActiveBackId) : null;
    if (!targetBack && customBackLibrary.length > 0 && (state.backStyle?.startsWith("custom") || state.backStyle === "custom")) {
      targetBack = customBackLibrary.find(x => x.id === state.backStyle.replace("custom_", "")) || customBackLibrary[0];
    }
    if (targetBack && targetBack.img) {
      selectCustomBack(targetBack.id, true);
    }
  } catch (err) {
    console.warn("Load custom assets from IndexedDB failed:", err);
  }
}

function renderCustomFxPills() {
  ["ws", "b"].forEach((prefix) => {
    const container = $(prefix + "-custom-fx-pills-list");
    if (!container) return;
    container.innerHTML = "";
    customFxLibrary.forEach((item) => {
      const pill = document.createElement("button");
      const effKey = "custom_" + item.id;
      const isActive = state.cardEffect === effKey || (state.cardEffect === "custom" && state.activeCustomFxId === item.id);
      pill.className = "effect-pill custom-pill" + (isActive ? " active" : "");
      pill.dataset.effect = effKey;
      pill.type = "button";
      pill.setAttribute("aria-pressed", String(isActive));
      pill.innerHTML = `★ <span class="custom-name">${item.name}</span>`;

      pill.addEventListener("click", () => {
        selectCustomFx(item.id);
      });
      container.appendChild(pill);
    });
  });
}

function renderCustomBackOptions() {
  ["ws", "b"].forEach((prefix) => {
    const group = $(prefix + "-custom-backs-group");
    if (!group) return;
    group.innerHTML = "";
    customBackLibrary.forEach((item) => {
      const opt = document.createElement("option");
      const val = "custom_" + item.id;
      opt.value = val;
      opt.textContent = "★ " + item.name;
      group.appendChild(opt);
    });
    const sel = $(prefix + "-back-style");
    if (sel && state.backStyle) {
      sel.value = state.backStyle;
    }
  });
}

function selectCustomFx(fxId, silent = false) {
  const item = customFxLibrary.find((x) => x.id === fxId);
  if (!item) return;
  state.activeCustomFxId = item.id;
  state.customFxName = item.name;
  state.cardEffect = "custom_" + item.id;
  customFxImg = item.img;
  hasCustomFx = true;
  setCardEffect(state.cardEffect);
  localStorage.setItem("holo_card_active_fx_id", item.id);
  ["ws", "b"].forEach((p) => {
    const nameInput = $(p + "-custom-fx-name");
    if (nameInput) nameInput.value = item.name;
    const rb = $(p + "-fx-rename-box");
    if (rb) rb.style.display = "flex";
  });
  if (!silent) showToast(`已应用自定义特效「${item.name}」`);
}

function selectCustomBack(backId, silent = false) {
  const item = customBackLibrary.find((x) => x.id === backId);
  if (!item) return;
  state.activeCustomBackId = item.id;
  state.customBackName = item.name;
  state.backStyle = "custom_" + item.id;
  customBackImg = item.img;
  hasCustomBack = true;
  ["ws", "b"].forEach((p) => {
    const sel = $(p + "-back-style");
    if (sel) sel.value = state.backStyle;
    const rb = $(p + "-back-rename-box");
    if (rb) rb.style.display = "flex";
    const ni = $(p + "-custom-back-name");
    if (ni) ni.value = item.name;
  });
  render2DPreview();
  syncTo3D();
  localStorage.setItem("holo_card_active_back_id", item.id);
  if (!silent) showToast(`已应用自定义卡背「${item.name}」`);
}

async function deleteCustomFxItem(fxId) {
  const item = customFxLibrary.find((x) => x.id === fxId);
  const name = item ? item.name : "特效";
  if (!confirm(`确认从本地特效库中删除「${name}」吗？`)) return;
  await dbDeleteCustomFx(fxId);
  customFxLibrary = customFxLibrary.filter((x) => x.id !== fxId);
  if (state.activeCustomFxId === fxId || state.cardEffect === "custom_" + fxId) {
    if (customFxLibrary.length > 0) {
      selectCustomFx(customFxLibrary[0].id);
    } else {
      state.activeCustomFxId = null;
      customFxImg = null;
      hasCustomFx = false;
      state.cardEffect = "none";
      setCardEffect("none");
      ["ws", "b"].forEach(p => {
        const rb = $(p + "-fx-rename-box");
        if (rb) rb.style.display = "none";
      });
      localStorage.removeItem("holo_card_active_fx_id");
    }
  } else {
    renderCustomFxPills();
  }
  showToast(`已从本地特效库删除「${name}」`);
}

async function deleteCustomBackItem(backId) {
  const item = customBackLibrary.find((x) => x.id === backId);
  const name = item ? item.name : "卡背";
  if (!confirm(`确认从本地卡背库中删除「${name}」吗？`)) return;
  await dbDeleteCustomBack(backId);
  customBackLibrary = customBackLibrary.filter((x) => x.id !== backId);
  if (state.activeCustomBackId === backId || state.backStyle === "custom_" + backId) {
    if (customBackLibrary.length > 0) {
      selectCustomBack(customBackLibrary[0].id);
    } else {
      state.activeCustomBackId = null;
      customBackImg = null;
      hasCustomBack = false;
      state.backStyle = "ambient";
      ["ws", "b"].forEach((p) => {
        const sel = $(p + "-back-style");
        if (sel) sel.value = "ambient";
        const rb = $(p + "-back-rename-box");
        if (rb) rb.style.display = "none";
      });
      render2DPreview();
      syncTo3D();
      localStorage.removeItem("holo_card_active_back_id");
    }
  }
  renderCustomBackOptions();
  showToast(`已从本地卡背库删除「${name}」`);
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
    triggerBtn.innerHTML = "<span>正在保存...</span>";
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

    // 2. 将4大素材全部转为无损 Blob 永久保留在牌库中
    const [subjBlob, bgBlob, fxBlob, backBlob] = await Promise.all([
      rawSubjectImg ? imageToBlob(rawSubjectImg) : Promise.resolve(null),
      rawBgImg ? imageToBlob(rawBgImg) : Promise.resolve(null),
      (customFxImg && (state.cardEffect.startsWith("custom") || hasCustomFx)) ? imageToBlob(customFxImg) : Promise.resolve(null),
      (customBackImg && (state.backStyle.startsWith("custom") || hasCustomBack)) ? imageToBlob(customBackImg) : Promise.resolve(null)
    ]);

    // 3. 构建卡牌数据体 (完整持久化保存材质、特效、卡背及全套独立参数)
    const cardId = "card_" + Date.now();
    const cardData = {
      id: cardId,
      createdAt: Date.now(),
      name: state.title || DEFAULTS.title,
      title: state.title || DEFAULTS.title,
      subtitle: state.subtitle || "",
      collection: state.collection || DEFAULTS.collection,
      technique: state.technique || "",
      tagline: state.tagline || "",
      edition: state.edition || "001 / 001",
      borderStyle: state.borderStyle || DEFAULTS.borderStyle,
      colorTheme: state.colorTheme || DEFAULTS.colorTheme,
      backStyle: state.backStyle || DEFAULTS.backStyle,
      finish: state.finish || DEFAULTS.finish,
      cardEffect: state.cardEffect || DEFAULTS.cardEffect,
      customFxName: state.customFxName || DEFAULTS.customFxName,
      customBackName: state.customBackName || DEFAULTS.customBackName,
      subjectScale: state.subjectScale ?? DEFAULTS.subjectScale,
      subjectX: state.subjectX ?? DEFAULTS.subjectX,
      subjectY: state.subjectY ?? DEFAULTS.subjectY,
      bgScale: state.bgScale ?? DEFAULTS.bgScale,
      bgX: state.bgX ?? DEFAULTS.bgX,
      bgY: state.bgY ?? DEFAULTS.bgY,
      bgBlur: state.bgBlur ?? DEFAULTS.bgBlur,
      depth: state.depth ?? DEFAULTS.depth,
      bgDepth: state.bgDepth ?? DEFAULTS.bgDepth,
      diff: state.diff ?? DEFAULTS.diff,
      foil: state.foil ?? DEFAULTS.foil,
      fxGlow: state.fxGlow ?? DEFAULTS.fxGlow,
      effectsDepth: state.effectsDepth ?? DEFAULTS.effectsDepth,
      fxScale: state.fxScale ?? DEFAULTS.fxScale,
      fxX: state.fxX ?? DEFAULTS.fxX,
      fxY: state.fxY ?? DEFAULTS.fxY,
      activeCustomFxId: state.activeCustomFxId || null,
      activeCustomBackId: state.activeCustomBackId || null,
      thumbDataUrl,
      subjectBlob: subjBlob,
      bgBlob: bgBlob,
      fxBlob: fxBlob,
      backBlob: backBlob,
      isCustomSubject: Boolean(rawSubjectImg),
      isCustomBg: Boolean(rawBgImg),
      isCustomFx: Boolean(fxBlob),
      isCustomBack: Boolean(backBlob)
    };

    await dbSaveCard(cardData);
    activeCardId = cardId;
    await updateDeckBadge();

    showToast("🎉 卡牌「" + cardData.title + "」已成功保存至您的牌库！");

    if (triggerBtn) {
      triggerBtn.innerHTML = "<span>已保存至牌库</span>";
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
        <button class="btn-deck-clone" data-id="${card.id}" type="button" title="复制卡牌副本">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
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

    const cloneBtn = item.querySelector(".btn-deck-clone");
    if (cloneBtn) {
      cloneBtn.onclick = async (e) => {
        e.stopPropagation();
        const baseName = card.name || card.title || "未命名";
        const copyName = baseName.includes("副本") ? baseName : baseName + " (副本)";
        const newCard = {
          ...card,
          id: "card_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          createdAt: Date.now(),
          name: copyName,
          title: copyName
        };
        await dbSaveCard(newCard);
        await renderDeckGrid();
        showToast("✨ 已创建卡牌副本「" + copyName + "」！");
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
    setVal("back-style", state.backStyle || "ambient");

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
    setVal("fx-depth", state.effectsDepth ?? 0.14);
    setTxt("val-fx-depth", (state.effectsDepth ?? 0.14).toFixed(2));

    setVal("fx-scale", state.fxScale ?? 1.0);
    setTxt("val-fx-scale", (state.fxScale ?? 1.0).toFixed(2) + "x");
    setVal("fx-x", state.fxX ?? 0);
    setTxt("val-fx-x", (state.fxX ?? 0) + "px");
    setVal("fx-y", state.fxY ?? 0);
    setTxt("val-fx-y", (state.fxY ?? 0) + "px");

    setVal("custom-fx-name", state.customFxName || "自定义特效");
    setVal("custom-back-name", state.customBackName || "自定义卡背");

    const opt = $(p + "-opt-custom-back");
    if (opt) {
      opt.style.display = (hasCustomBack || customBackImg) ? "block" : "none";
      opt.textContent = "★ " + (state.customBackName || "自定义卡背");
    }

    const pill = $(p + "-pill-custom-fx");
    if (pill) {
      pill.style.display = (hasCustomFx || customFxImg) ? "inline-flex" : "none";
      const nameSpan = $(p + "-pill-custom-fx-name");
      if (nameSpan) nameSpan.textContent = state.customFxName || "自定义";
    }

    const fxRb = $(p + "-fx-rename-box");
    if (fxRb) fxRb.style.display = (hasCustomFx || customFxImg) && state.cardEffect === "custom" ? "flex" : "none";

    const bkRb = $(p + "-back-rename-box");
    if (bkRb) bkRb.style.display = (hasCustomBack || customBackImg) && state.backStyle === "custom" ? "flex" : "none";
  });

  const statusSubj = $("ws-status-subject");
  const delSubj = $("ws-del-subject");
  if (statusSubj) {
    statusSubj.textContent = rawSubjectImg ? "已就绪 (可移除)" : "未添加 (已清空)";
  }
  if (delSubj) {
    delSubj.classList.toggle("is-cleared", !rawSubjectImg);
  }

  const statusBg = $("ws-status-bg");
  const delBg = $("ws-del-bg");
  if (statusBg) {
    statusBg.textContent = rawBgImg ? "已就绪 (可移除)" : "未添加 (已清空)";
  }
  if (delBg) {
    delBg.classList.toggle("is-cleared", !rawBgImg);
  }

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

    // 1. 彻底清空上一张卡牌的状态与图像引用，确保各卡牌设置 100% 独立隔离
    rawSubjectImg = null;
    hasCustomSubject = false;
    rawBgImg = null;
    hasCustomBg = false;
    customFxImg = null;
    hasCustomFx = false;
    customBackImg = null;
    hasCustomBack = false;

    // 2. 提取配置（兼容扁平字段与 parameters/appearance 嵌套结构），缺失属性严谨回退至官方默认，绝不残留上一张卡的设置
    const p = card.parameters || {};
    const app = card.appearance || {};

    state.title = card.name || card.title || DEFAULTS.title;
    state.subtitle = card.subtitle ?? DEFAULTS.subtitle;
    state.collection = card.collection ?? DEFAULTS.collection;
    state.technique = card.technique ?? DEFAULTS.technique;
    state.tagline = card.tagline ?? DEFAULTS.tagline;
    state.edition = card.edition ?? DEFAULTS.edition;

    state.borderStyle = card.borderStyle ?? app.borderStyle ?? DEFAULTS.borderStyle;
    state.colorTheme = card.colorTheme ?? app.colorTheme ?? DEFAULTS.colorTheme;
    state.finish = card.finish ?? app.finish ?? DEFAULTS.finish;
    state.cardEffect = card.cardEffect ?? app.cardEffect ?? DEFAULTS.cardEffect;
    state.backStyle = card.backStyle ?? app.backStyle ?? DEFAULTS.backStyle;

    state.subjectScale = card.subjectScale ?? p.subjectScale ?? DEFAULTS.subjectScale;
    state.subjectX = card.subjectX ?? p.subjectX ?? DEFAULTS.subjectX;
    state.subjectY = card.subjectY ?? p.subjectY ?? DEFAULTS.subjectY;

    state.bgScale = card.bgScale ?? p.bgScale ?? DEFAULTS.bgScale;
    state.bgX = card.bgX ?? p.bgX ?? DEFAULTS.bgX;
    state.bgY = card.bgY ?? p.bgY ?? DEFAULTS.bgY;
    state.bgBlur = card.bgBlur ?? p.bgBlur ?? DEFAULTS.bgBlur;

    state.depth = card.depth ?? p.subjectDepth ?? DEFAULTS.depth;
    state.bgDepth = card.bgDepth ?? p.backgroundDepth ?? DEFAULTS.bgDepth;
    state.diff = card.diff ?? p.diff ?? DEFAULTS.diff;
    state.foil = card.foil ?? p.foil ?? DEFAULTS.foil;
    state.fxGlow = card.fxGlow ?? p.fxGlow ?? DEFAULTS.fxGlow;
    state.effectsDepth = card.effectsDepth ?? p.effectsDepth ?? DEFAULTS.effectsDepth;
    state.fxScale = card.fxScale ?? p.fxScale ?? DEFAULTS.fxScale;
    state.fxX = card.fxX ?? p.fxX ?? DEFAULTS.fxX;
    state.fxY = card.fxY ?? p.fxY ?? DEFAULTS.fxY;
    state.customFxName = card.customFxName ?? p.customFxName ?? DEFAULTS.customFxName;
    state.customBackName = card.customBackName ?? p.customBackName ?? DEFAULTS.customBackName;

    // 3. 恢复卡牌专属素材 (若无则保持为 null，杜绝串图)
    if (card.subjectBlob) {
      const sImg = await blobToImage(card.subjectBlob);
      if (sImg) {
        hasCustomSubject = card.isCustomSubject !== undefined ? card.isCustomSubject : !isDefaultSubjectBlob(card.subjectBlob);
        sImg._isCustom = hasCustomSubject;
        sImg._isDefault = !hasCustomSubject;
        rawSubjectImg = sImg;
      }
    }

    if (card.bgBlob) {
      const bImg = await blobToImage(card.bgBlob);
      if (bImg) {
        hasCustomBg = card.isCustomBg !== undefined ? card.isCustomBg : !isDefaultBgBlob(card.bgBlob);
        bImg._isCustom = hasCustomBg;
        bImg._isDefault = !hasCustomBg;
        rawBgImg = bImg;
      }
    }

    if (card.backBlob) {
      const kImg = await blobToImage(card.backBlob);
      if (kImg) {
        customBackImg = kImg;
        hasCustomBack = true;
        const bId = card.activeCustomBackId || (card.backStyle?.startsWith("custom_") ? card.backStyle.replace("custom_", "") : "back_deck_" + id);
        state.activeCustomBackId = bId;
        state.customBackName = card.customBackName || (card.name ? card.name + "卡背" : "自制卡背");
        state.backStyle = "custom_" + bId;
        if (!customBackLibrary.some(x => x.id === bId)) {
          const bDataUrl = await imageToDataUrl(kImg);
          const bItem = { id: bId, name: state.customBackName, dataUrl: bDataUrl, createdAt: Date.now(), img: kImg };
          customBackLibrary.push(bItem);
          await dbSaveCustomBack({ id: bItem.id, name: bItem.name, dataUrl: bItem.dataUrl, createdAt: bItem.createdAt });
        }
      }
    }

    if (card.fxBlob) {
      const fImg = await blobToImage(card.fxBlob);
      if (fImg) {
        customFxImg = fImg;
        hasCustomFx = true;
        const fId = card.activeCustomFxId || (card.cardEffect?.startsWith("custom_") ? card.cardEffect.replace("custom_", "") : "fx_deck_" + id);
        state.activeCustomFxId = fId;
        state.customFxName = card.customFxName || (card.name ? card.name + "特效" : "自制特效");
        state.cardEffect = "custom_" + fId;
        if (!customFxLibrary.some(x => x.id === fId)) {
          const fDataUrl = await imageToDataUrl(fImg);
          const fItem = { id: fId, name: state.customFxName, dataUrl: fDataUrl, createdAt: Date.now(), img: fImg };
          customFxLibrary.push(fItem);
          await dbSaveCustomFx({ id: fItem.id, name: fItem.name, dataUrl: fItem.dataUrl, createdAt: fItem.createdAt });
        }
      }
    }

    // 4. 刷新自制库、材质界面、侧边栏全控件与2D/3D渲染
    applyFinishUI(state.finish);
    setCardEffect(state.cardEffect);
    renderCustomFxPills();
    renderCustomBackOptions();
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
      backStyle: state.backStyle,
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
      fxGlow: state.fxGlow ?? 0.5,
      effectsDepth: state.effectsDepth ?? 0.14,
      fxScale: state.fxScale ?? 1.0,
      fxX: state.fxX ?? 0,
      fxY: state.fxY ?? 0,
      customFxName: state.customFxName || "自定义特效",
      customBackName: state.customBackName || "自定义卡背"
    };

    // 1. 存入 localStorage 设为后续进站的默认配置
    localStorage.setItem("holo_card_custom_default_settings", JSON.stringify(currentSettings));

    // 同步发送至服务端落盘，使打包出的整站 ZIP 默认配置实时对齐
    fetch("/api/save-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentSettings)
    }).catch(() => {});

    // 2. 仅当当前正在编辑牌库中的某张指定卡牌时，更新该特定卡牌，坚决杜绝误伤或串改其他卡牌
    try {
      if (activeCardId) {
        const targetCard = await dbGetCard(activeCardId);
        if (targetCard) {
          Object.assign(targetCard, currentSettings);
          targetCard.name = state.title || targetCard.name;
          targetCard.title = state.title || targetCard.title;
          targetCard.updatedAt = Date.now();
          const previewCanvas = $("preview-canvas");
          if (previewCanvas) {
            targetCard.thumbDataUrl = previewCanvas.toDataURL("image/jpeg", 0.75);
          }
          if (rawSubjectImg) {
            targetCard.subjectBlob = await imageToBlob(rawSubjectImg);
            targetCard.isCustomSubject = hasCustomSubject;
          } else {
            delete targetCard.subjectBlob;
            targetCard.isCustomSubject = false;
          }
          if (rawBgImg) {
            targetCard.bgBlob = await imageToBlob(rawBgImg);
            targetCard.isCustomBg = hasCustomBg;
          } else {
            delete targetCard.bgBlob;
            targetCard.isCustomBg = false;
          }
          if (customFxImg && (state.cardEffect.startsWith("custom") || hasCustomFx)) {
            targetCard.fxBlob = await imageToBlob(customFxImg);
            targetCard.isCustomFx = true;
          } else {
            delete targetCard.fxBlob;
            targetCard.isCustomFx = false;
          }
          if (customBackImg && (state.backStyle.startsWith("custom") || hasCustomBack)) {
            targetCard.backBlob = await imageToBlob(customBackImg);
            targetCard.isCustomBack = true;
          } else {
            delete targetCard.backBlob;
            targetCard.isCustomBack = false;
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

    showToast("当前卡牌修改已成功保存为默认设置！");
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

  // 0. 首先载入本地 IndexedDB 中永久保存的自定义特效库与卡背库
  await loadCustomAssetsFromDB();

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
      if (cfg.appearance?.backStyle) state.backStyle = cfg.appearance.backStyle;
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
        if (p.effectsDepth !== undefined) state.effectsDepth = p.effectsDepth;
        if (p.fxScale !== undefined) state.fxScale = p.fxScale;
        if (p.fxX !== undefined) state.fxX = p.fxX;
        if (p.fxY !== undefined) state.fxY = p.fxY;
        if (p.customFxName !== undefined) state.customFxName = p.customFxName;
        if (p.customBackName !== undefined) state.customBackName = p.customBackName;
      }
      applyFinishUI(state.finish);
      setCardEffect(state.cardEffect);
    }
  } catch (e) {
    console.warn("Load card-config.json failed:", e);
  }

  // 2. 侧边栏初始状态严格以网站官方标准基准 (card-config.json) 为准，确保开箱即为官方预设
  try {
    // 清除可能残留的旧版覆盖缓存，确保进站展示官方基准
    localStorage.removeItem("holo_card_custom_default_settings");
  } catch (e) {}

  // 载入网站官方默认素材与排版 (保证进站与刷新时 100% 对齐官方基准预设)
  async function loadInitialCard() {
    let loadedAssetCount = 0;
    const checkAssetsDone = () => {
      loadedAssetCount++;
      if (loadedAssetCount >= 2) {
        hideWorkshopLoading();
        syncAllInputsFromState();
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

  // A 页面上传与删除主体素材
  const uploadSubj = $("ws-upload-subject");
  const delSubj = $("ws-del-subject");
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
          const statusEl = $("ws-status-subject");
          if (statusEl) statusEl.textContent = "已就绪 (可移除)";
          if (delSubj) delSubj.classList.remove("is-cleared");
          render2DPreview();
          syncTo3D();
          showToast("已成功载入主体素材！");
        };
      };
      reader.readAsDataURL(file);
    };
  }
  if (delSubj) {
    delSubj.onclick = () => {
      rawSubjectImg = null;
      hasCustomSubject = false;
      const statusEl = $("ws-status-subject");
      if (statusEl) statusEl.textContent = "未添加 (已清空)";
      delSubj.classList.add("is-cleared");
      render2DPreview();
      syncTo3D();
      showToast("已移除人物主体，当前将以纯背景模式生成卡牌");
    };
  }

  // A 页面上传与删除背景素材
  const uploadBg = $("ws-upload-bg");
  const delBg = $("ws-del-bg");
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
          const statusEl = $("ws-status-bg");
          if (statusEl) statusEl.textContent = "已就绪 (可移除)";
          if (delBg) delBg.classList.remove("is-cleared");
          render2DPreview();
          syncTo3D();
          showToast("已成功载入背景插画！");
        };
      };
      reader.readAsDataURL(file);
    };
  }
  if (delBg) {
    delBg.onclick = () => {
      rawBgImg = null;
      hasCustomBg = false;
      const statusEl = $("ws-status-bg");
      if (statusEl) statusEl.textContent = "未添加 (已清空)";
      delBg.classList.add("is-cleared");
      render2DPreview();
      syncTo3D();
      showToast("已移除背景素材");
    };
  }

  // 侧边栏卡面特效与卡背贴图上传及清空 (Page A 与 Page B 双向完全同步)
  ["ws", "b"].forEach((prefix) => {
    const uploadFx = $(prefix + "-upload-fx");
    if (uploadFx) {
      uploadFx.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          const dataUrl = evt.target.result;
          const img = new Image();
          img.src = dataUrl;
          img.onload = async () => {
            const fxId = "fx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
            const count = customFxLibrary.length + 1;
            const defaultName = "自制特效 " + count;
            const newItem = {
              id: fxId,
              name: defaultName,
              dataUrl: dataUrl,
              createdAt: Date.now(),
              img: img
            };
            await dbSaveCustomFx({ id: newItem.id, name: newItem.name, dataUrl: newItem.dataUrl, createdAt: newItem.createdAt });
            customFxLibrary.push(newItem);
            selectCustomFx(fxId);
            showToast("✨ 已永久保存「" + defaultName + "」到本地特效库！可继续上传更多");
            uploadFx.value = "";
          };
        };
        reader.readAsDataURL(file);
      };
    }

    const delFx = $(prefix + "-del-fx");
    if (delFx) {
      delFx.onclick = () => {
        if (state.activeCustomFxId) {
          deleteCustomFxItem(state.activeCustomFxId);
        } else {
          state.cardEffect = "none";
          setCardEffect("none");
        }
      };
    }

    const uploadBack = $(prefix + "-upload-back");
    if (uploadBack) {
      uploadBack.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          const dataUrl = evt.target.result;
          const img = new Image();
          img.src = dataUrl;
          img.onload = async () => {
            const backId = "back_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
            const count = customBackLibrary.length + 1;
            const defaultName = "自制卡背 " + count;
            const newItem = {
              id: backId,
              name: defaultName,
              dataUrl: dataUrl,
              createdAt: Date.now(),
              img: img
            };
            await dbSaveCustomBack({ id: newItem.id, name: newItem.name, dataUrl: newItem.dataUrl, createdAt: newItem.createdAt });
            customBackLibrary.push(newItem);
            selectCustomBack(backId);
            showToast("✨ 已永久保存「" + defaultName + "」到本地卡背库！可继续上传更多");
            uploadBack.value = "";
          };
        };
        reader.readAsDataURL(file);
      };
    }

    const delBack = $(prefix + "-del-back");
    if (delBack) {
      delBack.onclick = () => {
        if (state.activeCustomBackId) {
          deleteCustomBackItem(state.activeCustomBackId);
        } else {
          state.backStyle = "ambient";
          ["ws", "b"].forEach((p) => {
            const sel = $(p + "-back-style");
            if (sel) sel.value = "ambient";
            const rb = $(p + "-back-rename-box");
            if (rb) rb.style.display = "none";
          });
          render2DPreview();
          syncTo3D();
        }
      };
    }
  });

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

  // Netlify 一键部署双阶段向导绑定
  const autoDeployBtn = $("btn-auto-deploy-netlify");
  if (autoDeployBtn) {
    autoDeployBtn.onclick = () => openDeployModal(1);
  }

  const exportViewerBtn = $("btn-export-netlify-viewer");
  if (exportViewerBtn) {
    exportViewerBtn.onclick = () => openDeployModal(1);
  }

  // 3秒全息动态检视 GIF 录制按钮与弹窗绑定
  const recordGifBtn = $("btn-record-card-gif");
  if (recordGifBtn) {
    recordGifBtn.onclick = () => recordCardGif(recordGifBtn);
  }

  const closeGifModalBtn = $("btn-close-gif-modal");
  if (closeGifModalBtn) closeGifModalBtn.onclick = closeGifModal;

  const gifBackdrop = $("gif-backdrop");
  if (gifBackdrop) gifBackdrop.onclick = closeGifModal;

  // 1080P 60帧 MP4 动态短视频录制按钮与弹窗绑定
  const recordMp4Btn = $("btn-record-card-mp4");
  if (recordMp4Btn) {
    recordMp4Btn.onclick = () => recordCardMp4(recordMp4Btn);
  }

  const closeMp4ModalBtn = $("btn-close-mp4-modal");
  if (closeMp4ModalBtn) closeMp4ModalBtn.onclick = closeMp4Modal;

  const mp4Backdrop = $("mp4-backdrop");
  if (mp4Backdrop) mp4Backdrop.onclick = closeMp4Modal;

  // 部署向导弹窗内部交互
  const deployDownloadBtn = $("btn-deploy-download-pkg");
  if (deployDownloadBtn) {
    deployDownloadBtn.onclick = () => handleDeployStep1Download(deployDownloadBtn);
  }

  const directDropLink = $("link-direct-netlify-drop");
  if (directDropLink) {
    directDropLink.onclick = () => {
      showToast("正在前往 Netlify Drop，将刚才下载的 zip 直接拖入即可上线！");
    };
  }

  const copyDropLinkBtn = $("btn-copy-drop-link");
  if (copyDropLinkBtn) {
    copyDropLinkBtn.onclick = () => {
      const url = "https://app.netlify.com/drop";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast("已复制 Netlify Drop 部署网址到剪贴板！");
        }).catch(() => {
          window.open(url, "_blank");
        });
      } else {
        window.open(url, "_blank");
      }
    };
  }

  const closeDeployX = $("btn-close-deploy-x");
  if (closeDeployX) closeDeployX.onclick = closeDeployModal;

  const closeDeployDone = $("btn-close-deploy-done");
  if (closeDeployDone) closeDeployDone.onclick = closeDeployModal;

  const deployBackdrop = $("deploy-backdrop");
  if (deployBackdrop) deployBackdrop.onclick = closeDeployModal;

  const copyNetlifyUrl = $("btn-copy-netlify-url");
  if (copyNetlifyUrl) {
    copyNetlifyUrl.onclick = () => {
      const url = "https://app.netlify.com/drop";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast("已复制 Netlify Drop 部署网址到剪贴板！");
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

  // 主功能初始化完成后异步加载第三方统计，故障时自动隐藏。
  initVisitCounter();

  // 初始化展台卡牌放大切换
  initCardZoom();

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
