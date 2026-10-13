# Holo Card Studio · 3D 全息交互典藏卡牌工坊

<p align="center">
  <img src="./assets/subject.png" width="180" alt="Holo Card Studio" />
</p>

<p align="center">
  <strong>基于 WebGL 与 Three.js 的下一代 3D 沉浸式全息典藏卡牌制作工坊与鉴赏展台</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
  <a href="https://threejs.org/"><img src="https://img.shields.io/badge/Three.js-0.180.0-black.svg" alt="Three.js" /></a>
  <a href="https://www.netlify.com/"><img src="https://img.shields.io/badge/Deploy-Netlify%20Ready-00C7B7.svg" alt="Netlify" /></a>
  <img src="https://img.shields.io/badge/Platform-Web%20%7C%20Mobile%20%7C%20Desktop-green.svg" alt="Platform" />
</p>

---

## 🌟 项目简介

**Holo Card Studio** 是一套开箱即用的 Web 3D 全息实体质感卡牌创作工坊与鉴赏平台。用户可以自由上传任意动漫角色、摄影作品或原创插画，自主定制卡面标题、典藏系列编号、镭射折射率、全息光效、浮雕深度以及烫金边框工艺，并在 3D 展台中体验如同握持真实实体卡牌般的物理视差与微粒折射光影。

项目采用纯原生 JavaScript (ESM) + Three.js 构建，兼具极限轻量的加载性能（核心包经极致优化压缩，首屏加载仅需数百毫秒）与移动端深度适配（支持手机重力感应陀螺仪）。

---

## ✨ 核心特性

- 🔮 **物理视差与多层全息材质引擎**：
  - 基于真实三维深度的前后景分离（主体悬浮、背景深陷）；
  - 动态计算光照反射，支持珠光（Pearl）、烫金（Gold）、银箔（Silver）、磨砂（Matte）、清漆（Gloss）、拉丝（Brushed）与光栅（Holo）等多种顶级工艺质感；
  - 包含银河碎钻、璀璨星芒、梦幻光尘、灵动光烬等 9 款卡面动态三维光效图层。
- 📱 **移动端与交互体验**：
  - **手机陀螺仪体感联动**：晃动手机即可自然触发全息流光与卡牌倾斜；
  - **自适应拖拽旋转**：实时捕获当前物理旋转角，正反面翻转自适应反转手势符号；
  - **双向同步架构**：制作工坊 (Page A) 与 3D 展台 (Page B) 实时双向热同步。
- 💾 **本地离线牌库系统**：
  - 基于浏览器原生的 IndexedDB 本地数据库存储，不设上限；
  - 支持多套卡牌保存、一键载入、卡牌改名重命名、删除管理；
  - 纯前端本地持久化，断网环境下依然可随时鉴赏。
- 📤 **100% 无损卡牌导出与导入**：
  - 支持一键导出单张卡牌为 `.json` 配置文件（内嵌原始无损高清大图与完整 3D 排版参数）；
  - 好友在任何手机或电脑浏览器中打开网站，进入牌库点击「导入卡牌」即可 1:1 无损呈现，永不模糊失真。
- 🚀 **Netlify 自动化一键部署与纯享展台包**：
  - **独立纯享展台包**：一键导出专用于展示该张卡牌的独立纯净网站（移除所有工坊与侧边栏）；
  - **云端一键自动部署**：内置 Netlify Functions 云函数与 Drop 部署通道，一键生成属于该卡牌的独立公网域名（如 `https://xxx.netlify.app`）。

---

## 📂 目录结构

```text
holo-card-studio/
├── assets/                  # 3D 模型、默认高清材质与特效图层
│   ├── card.glb             # 卡片高精度 3D 几何网格
│   ├── subject.png          # 默认主体图层 (经瘦身优化)
│   ├── background.png       # 默认背景图层 (经瘦身优化)
│   ├── lineart.png          # 全息烫金高亮线稿图层
│   ├── text.png             # 卡面矢量装饰文字图层
│   └── effects/             # 9 种卡面全息光效源图层
├── netlify/
│   └── functions/           # Netlify Serverless 云函数后端
│       └── deploy-temp-site.mjs # 自动化创建独立预览站的云端代理
├── _headers                 # Netlify 全局安全跨域头与缓存控制
├── _redirects               # Netlify API 路由重写规则
├── netlify.toml             # Netlify 官方 CI/CD 自动化构建配置文件
├── index.html               # 网页核心入口
├── style.css                # 3D 展台、全局排版与视效样式
├── workshop.css             # 制作工坊侧边栏、牌库与半透明玻璃拟物样式
├── app.js                   # Three.js 3D 全息渲染管线与着色器核心
├── site.js                  # 工坊制作、牌库持久化、打包导出与全局控制
├── server.mjs               # 本地开发服务器 (Node.js)
├── bundle.sh                # 本地 ESBuild 构建脚本
├── card-config.json         # 默认卡牌基础元数据与 3D 初始参数
└── package.json             # 项目元信息与编译依赖
```

---

## 🛠️ 快速开始 (本地开发)

### 环境要求
- **Node.js**: v18.0.0 或更高版本 (推荐 v20+)
- **包管理器**: npm 或 pnpm / yarn

### 1. 克隆仓库与安装依赖
```bash
git clone https://github.com/your-username/holo-card-studio.git
cd holo-card-studio
npm install
```

### 2. 启动本地开发服务
```bash
npm run dev
# 或 npm start
```
服务默认启动于 `http://localhost:4173`（或自定义端口）。打开浏览器即可立即体验制作工坊与 3D 展台。

### 3. 代码打包构建
项目使用 ESBuild 进行零配置极致压缩与模块打包：
```bash
npm run build
```
该命令将自动更新输出 `app.bundle.js` 与 `site.bundle.js`。

---

## 🚀 部署上线至 Netlify (推荐标准流程)

本项目已配置完整的 **Netlify CI/CD 与云函数运行环境**，强烈推荐通过 GitHub 关联托管，体验全自动版本发布：

### 步骤 1：推送到 GitHub
将本项目推送到您自己的 GitHub 账号下的新建仓库（Public 或 Private 均可）。

### 步骤 2：在 Netlify 导入项目
1. 访问 [Netlify 控制台](https://app.netlify.com/) 并登录；
2. 点击 **"Add new site"** -> **"Import an existing project"**；
3. 选择 **GitHub** 并授权选择您刚刚创建的 `holo-card-studio` 仓库；
4. Netlify 会自动检测并读取仓库根目录下的 `netlify.toml`：
   - **Build command**: `npm run build`
   - **Publish directory**: `.`
   - **Functions directory**: `netlify/functions`
5. 点击 **"Deploy holo-card-studio"**！

只需约 30 秒，Netlify 全球边缘 CDN 就会自动完成构建，并为您分配一个免费的专属 HTTPS 域名！

### 步骤 3：绑定自定义独立域名（可选）
在 Netlify 后台的 **"Domain management"** 中，添加您自己的域名（例如 `card.yourdomain.com`），配置 DNS CNAME 指向后即可拥有专属卡牌工坊网站。

---

## 📤 卡牌分享与交流指南

1. **导出完整卡牌文件**：
   在 3D 展台侧边栏点击 **「📤 导出卡牌」**，浏览器会下载一个 `.json` 文件。该文件包含原始超清大图与全套工艺参数。
2. **好友一键导入**：
   好友访问您的线上网站，打开顶栏的 **「牌库」**，点击 **「导入卡牌」** 选中该文件，即可瞬间将该卡牌收入其个人牌库，并在 3D 展台中以 100% 原始画质全屏欣赏。

---

## 📜 开源协议与版权声明

- **源码许可**：本项目前端交互逻辑、3D 着色器管线与工坊架构基于 [MIT License](./LICENSE) 开源；
- **美术素材版权**：仓库内附带的默认示例立绘与背景素材仅供演示学习与个人非商业鉴赏，版权归属原著作权方所有。使用者自行上传与制作的卡牌美术版权归属上传者本人，请勿用于任何商业用途。

---

<p align="center">
  <sub>Made with ❤️ by Holo Card Studio · 光影之间，自有回响</sub>
</p>
