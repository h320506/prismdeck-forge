# PrismDeck Forge · 3D 全息交互典藏卡牌工坊

<p align="center">
  <img src="./assets/subject.png" width="180" alt="PrismDeck Forge" />
</p>

<p align="center">
  <strong>基于 WebGL 与 Three.js 的 3D 全息典藏卡牌制作工坊与鉴赏展台</strong>
</p>

<p align="center">
  <a href="https://card.128813.xyz/"><strong>在线演示</strong></a>
  ·
  <a href="https://github.com/h320506/prismdeck-forge"><strong>GitHub 仓库</strong></a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
  <a href="https://threejs.org/"><img src="https://img.shields.io/badge/Three.js-0.180.0-black.svg" alt="Three.js" /></a>
  <a href="https://www.netlify.com/"><img src="https://img.shields.io/badge/Deploy-Netlify%20Ready-00C7B7.svg" alt="Netlify" /></a>
  <img src="https://img.shields.io/badge/Platform-Web%20%7C%20Mobile%20%7C%20Desktop-green.svg" alt="Platform" />
</p>

---

## 🌐 在线演示

- **正式演示站**：<https://card.128813.xyz/>
- 支持桌面与移动端浏览器；移动端可使用陀螺仪检视卡牌。
- 演示站中的默认角色与美术素材仅用于个人学习、技术研究和非商业展示，相关权利归原作者及原权利方所有。

> 若演示站未及时显示最新版本，请强制刷新页面或清除该站点缓存后重试。

---

## 🌟 项目简介

**PrismDeck Forge** 是一套 Web 3D 全息实体质感卡牌创作工坊与鉴赏平台。用户可以自由上传任意动漫角色、摄影作品或原创插画，自主定制卡面标题、典藏系列编号、镭射折射率、全息光效、浮雕深度以及烫金边框工艺，并在 3D 展台中体验如同握持真实实体卡牌般的物理视差与微粒折射光影。

项目采用原生 JavaScript（ES Modules）与 Three.js 构建，并针对桌面端和移动端交互进行适配；支持触控操作与兼容设备上的陀螺仪控制。

---

## ✨ 核心特性

- 🔮 **物理视差与多层全息材质引擎**：
  - 基于真实三维深度的前后景分离（主体悬浮、背景深陷）；
  - 动态计算光照反射，支持珠光（Pearl）、烫金（Gold）、银箔（Silver）、磨砂（Matte）、清漆（Gloss）、拉丝（Brushed）与光栅（Holo）等多种顶级工艺质感；
  - 包含银河碎钻、璀璨星芒、梦幻光尘、灵动光烬等 9 款卡面动态三维光效图层。
- 📱 **移动端与交互体验**：
  - **手机陀螺仪体感联动**：晃动手机即可自然触发全息流光与卡牌倾斜；
  - **自适应拖拽旋转**：实时捕获当前物理旋转角，正反面翻转自适应反转手势符号；
  - **共享状态视图**：制作工坊视图与 3D 展台视图使用同一份前端状态，切换视图时同步呈现。
- 💾 **本地离线牌库系统**：
  - 基于浏览器原生 IndexedDB 保存；实际容量受浏览器、设备空间、隐私模式与站点存储策略限制；
  - 支持多套卡牌保存、一键载入、卡牌改名重命名、删除管理；
  - 牌库数据保存在当前浏览器中；已加载页面内的牌库操作不依赖服务器，但项目未提供 PWA 离线启动保证。
- 📤 **卡牌数据导出与导入**：
  - 支持导出单张卡牌为 `.json` 配置文件；素材以 Data URL 形式随卡牌数据保存，具体格式与尺寸取决于上传素材及浏览器处理流程；
  - 好友可在支持相关 Web API 的现代浏览器中导入卡牌数据；实际呈现效果受浏览器、设备性能和原始素材质量影响。
- 🚀 **Netlify 自动化一键部署与纯享展台包**：
  - **独立纯享展台包**：一键导出专用于展示该张卡牌的独立纯净网站（移除所有工坊与侧边栏）；
  - **部署引导流程**：生成独立展台 ZIP 后，可前往 Netlify Drop 上传；登录并认领站点后可长期保留对应预览站。
- 🎞️ **动态内容导出**：
  - 400 × 560、20 FPS、3 秒循环 GIF；
  - 浏览器支持相应 H.264 WebCodecs 配置时导出 1080 × 1512、60 FPS、3 秒 MP4；否则使用 MediaRecorder，可能生成 MP4 或 WebM；
  - 实际可用性与导出速度取决于浏览器能力和设备性能。
- 🧩 **多素材与双层背景**：
  - 主体、背景、卡面特效、卡背 4 类素材自由组合；
  - A+B 双层背景结合清晰原画层、高斯柔焦底衬层与微量出血位，降低极限视角露底和边缘拉丝；
  - 支持自定义特效、卡背及其浏览器本地素材库。

---

## 📂 目录结构

```text
prismdeck-forge/
├── assets/                  # 3D 模型、默认高清材质与特效图层
│   ├── card.glb             # 卡片高精度 3D 几何网格
│   ├── subject.png          # 默认主体图层 (经瘦身优化)
│   ├── background.png       # 默认背景图层 (经瘦身优化)
│   ├── lineart.png          # 全息烫金高亮线稿图层
│   ├── text.png             # 卡面矢量装饰文字图层
│   └── effects/             # 9 种卡面全息光效源图层
├── _headers                 # Netlify 全局安全跨域头与缓存控制
├── _redirects               # Netlify API 路由重写规则
├── netlify.toml             # Netlify 构建与部署配置
├── wrangler.jsonc           # Cloudflare Workers 静态资源配置
├── .assetsignore            # Cloudflare 静态资源排除规则
├── index.html               # 网页核心入口
├── style.css                # 3D 展台、全局排版与视效样式
├── workshop.css             # 制作工坊侧边栏、牌库与半透明玻璃拟物样式
├── app.js                   # Three.js 3D 全息渲染管线与着色器核心
├── site.js                  # 工坊制作、牌库持久化、打包导出与全局控制
├── server.mjs               # 本地开发服务器 (Node.js)
├── bundle.sh                # 兼容用本地 ESBuild 构建脚本
├── scripts/build.mjs        # 生成 Bundle 并组装 dist 静态发布目录
├── card-config.json         # 默认卡牌基础元数据与 3D 初始参数
├── package.json             # 项目元信息与编译依赖
├── NOTICE.md                # 上游来源与修改说明
├── THIRD_PARTY_NOTICES.md   # 第三方软件许可清单
└── ASSETS_LICENSES.md       # 素材授权状态与公开前阻断说明
```

---

## 🛠️ 快速开始 (本地开发)

### 环境要求
- **Node.js**: v18.0.0 或更高版本 (推荐 v20+)
- **包管理器**: npm 或 pnpm / yarn

### 1. 克隆仓库与安装依赖
```bash
git clone https://github.com/h320506/prismdeck-forge.git
cd prismdeck-forge
npm install
```

### 2. 启动本地开发服务
```bash
npm run dev
# 或 npm start
```
服务默认启动于 `http://localhost:4174`（或通过 `PORT` 环境变量自定义端口）。打开浏览器即可立即体验制作工坊与 3D 展台。

### 3. 代码打包构建
项目使用 ESBuild 打包并压缩 `app.js` 与 `site.js`：
```bash
npm run build
```
该命令会更新 `app.bundle.js` 与 `site.bundle.js`，并将可公开部署的静态文件组装到 `dist/`；请勿直接编辑 Bundle 构建产物。

---

## 📊 配置自己的访问计数器

A 界面底部的“总访问数 / 总访客数”使用 [Saobby 网页计数器](https://www.saobby.com/webcounter/) 提供统计。为避免 Fork 后的站点误用并污染原站数据，项目默认只允许正式域名 `card.128813.xyz` 启用内置计数器；您部署到其他域名时，统计区域会自动隐藏。

### 1. 创建自己的计数器

1. 打开 [Saobby 网页计数器](https://www.saobby.com/webcounter/)；
2. 按页面提示创建一个新计数器并保存；
3. 进入生成的控制面板，在嵌入地址或计数器图片地址中找到计数器 ID。例如地址为 `https://w.saobby.com/w/abcd1234` 时，计数器 ID 就是 `abcd1234`；
4. 控制面板访问密钥只用于管理设置，请勿填写到前端源码或提交到公开仓库。

### 2. 修改项目配置

打开 `site.js`，找到文件顶部的 `VISIT_COUNTER_CONFIG`：

```js
const VISIT_COUNTER_CONFIG = {
  counterId: "替换为你的计数器ID",
  allowedHosts: new Set(["你的正式域名.com", "www.你的正式域名.com"])
};
```

配置说明：

- `counterId`：填写 Saobby 生成的公开计数器 ID，不要填写控制面板访问密钥；
- `allowedHosts`：填写允许启用统计的正式域名，只写主机名，不要带 `https://`、路径或结尾斜杠；
- 有多个正式域名时可以继续添加，例如 `new Set(["example.com", "www.example.com"])`；
- `localhost` 和 `127.0.0.1` 默认不统计，避免本地开发污染线上数据。如确需本地调试，可临时加入白名单，测试完成后请移除。

修改完成后重新构建：

```bash
npm run build
```

若 Saobby 接口故障、请求超时或返回异常，页面会自动隐藏统计区域，不会影响素材上传、卡牌编辑、3D 渲染、牌库及导出功能。

---

## 🚀 线上部署与托管指南 (Netlify / Cloudflare 双平台)

本项目已全面兼容 **Netlify** 与 **Cloudflare (Workers / Pages)** 两大主流全球边缘托管平台，支持通过 GitHub 仓库关联实现代码提交全自动构建发布：

---

### 方案 A：部署上线至 Cloudflare (推荐，全球 Anycast CDN 加速)

Cloudflare 控制台已将 Workers 与 Pages 整合为“Workers 和 Pages”入口。本项目通过 `npm run build` 生成独立的 `dist/`，`wrangler.jsonc` 仅发布该目录。

#### 步骤 1：在 Cloudflare 控制台新建应用
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)；
2. 进入左侧菜单 **「Workers 和 Pages」** -> 点击蓝色的 **「创建应用程序」** 按钮；
3. 选择 **「连接到 Git」**，授权并选中您的 `prismdeck-forge` 仓库。

#### 步骤 2：配置构建与部署参数
- **项目名称 (Project name)**：`prismdeck-forge`
- **构建命令 (Build command)**：`npm run build`
- **部署命令 (Deploy command)**：`npx wrangler deploy`
- **高级设置 - 路径 (Root directory)**：`.`
- **静态资源目录**：由 `wrangler.jsonc` 指向 `./dist`

#### 步骤 3：点击「部署」完成上线
点击“部署”后，Cloudflare 会执行构建并分配 HTTPS 访问地址；实际完成时间取决于依赖安装、网络和平台队列。

> 发布前会先构建独立 `dist/` 目录，源码、开发服务器、依赖目录与本地文件不会作为静态资源上传。

---

### 方案 B：部署上线至 Netlify (传统标准流程)

本项目已配置 Netlify 静态构建，发布目录限定为 `dist/`。站内独立展台发布采用“生成 ZIP → 前往 Netlify Drop 上传并认领”的引导流程，仓库不再暴露匿名部署代理。

#### 步骤 1：在 Netlify 导入项目
1. 访问 [Netlify 控制台](https://app.netlify.com/) 并登录；
2. 点击 **"Add new site"** -> **"Import an existing project"**；
3. 选择 **GitHub** 并授权选择您的 `prismdeck-forge` 仓库；
4. Netlify 会自动检测并读取仓库根目录下的 `netlify.toml`：
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
5. 点击 **"Deploy prismdeck-forge"** 并等待平台完成构建与发布；实际时间取决于网络和平台队列。

---

### 绑定自定义独立域名（可选）
在 Netlify 或 Cloudflare 后台的域名管理中，添加您自己的域名（例如 `card.yourdomain.com`），按提示解析 DNS 即可拥有专属品牌的 3D 卡牌网站。

---

## 📤 卡牌分享与交流指南

1. **导出完整卡牌文件**：
   在 3D 展台侧边栏点击“导出卡牌”，浏览器会下载一个 `.json` 文件。该文件包含卡牌素材数据与工艺参数；最终呈现效果仍受原始素材、浏览器和设备影响。
2. **好友一键导入**：
   好友访问线上网站后，可在牌库中导入该文件并在 3D 展台查看。请只导入来源可信的卡牌文件，并自行确认素材授权。

---

## 📜 开源协议与版权声明

- **源码许可**：软件代码按 [MIT License](./LICENSE) 发布；上游及修改说明见 [NOTICE](./NOTICE.md)；
- **第三方软件**：依赖与许可证清单见 [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES.md)；
- **素材许可**：MIT 不自动覆盖角色、美术素材、商标或用户内容。逐项状态见 [ASSETS_LICENSES](./ASSETS_LICENSES.md)；
- **公开前状态**：当前默认演示美术尚无仓库内可核验的再分发授权记录。在替换为原创/CC0/明确授权素材，或补齐书面授权与来源记录前，不应将包含这些素材的仓库公开；
- **使用责任**：使用者应自行确认上传素材、生成素材及导出内容的版权和使用权限。

---

## 🙏 上游项目与致谢

本项目是在 [HRuiCcc/RuiC-card-skill](https://github.com/HRuiCcc/RuiC-card-skill)（RuiC Card Skill，MIT License）基础上进行的二次开发。当前仓库在其 3D 全息卡牌分层、视差材质与 Three.js 浏览器展示思路之上，继续扩展了可视化工坊、本地牌库、多素材管理、卡背设计、移动端交互、GIF/MP4 导出、部署流程与访问统计等功能。

感谢原项目作者 **HRuiCcc** 及其贡献者。原项目的版权和 MIT 许可声明请参见上游仓库；本仓库的修改部分及完整许可说明见 [LICENSE](./LICENSE)。
