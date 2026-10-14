import http from 'node:http';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {exec} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip'
};

http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // API: 本地网页端点击「保存当前修改」时同步落盘为整站默认设置
    if (req.method === 'POST' && (pathname === '/api/save-settings' || pathname === '/api/sync-settings')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const settings = JSON.parse(body);
          const cfgPath = path.join(root, 'card-config.json');
          let currentCfg = {};
          try {
            currentCfg = JSON.parse(await readFile(cfgPath, 'utf8'));
          } catch (e) {}

          if (settings.title) currentCfg.title = settings.title;
          if (settings.subtitle !== undefined) currentCfg.subtitle = settings.subtitle;
          if (settings.collection) currentCfg.collection = settings.collection;
          if (settings.technique) currentCfg.technique = settings.technique;
          if (settings.tagline) currentCfg.tagline = settings.tagline;
          if (settings.edition) currentCfg.edition = settings.edition;
          currentCfg.appearance = currentCfg.appearance || {};
          if (settings.finish) currentCfg.appearance.finish = settings.finish;
          if (settings.borderStyle) currentCfg.appearance.borderStyle = settings.borderStyle;
          if (settings.colorTheme) currentCfg.appearance.colorTheme = settings.colorTheme;
          if (settings.cardEffect) currentCfg.appearance.cardEffect = settings.cardEffect;
          if (settings.backStyle) currentCfg.appearance.backStyle = settings.backStyle;

          currentCfg.parameters = currentCfg.parameters || {};
          if (settings.subjectScale !== undefined) currentCfg.parameters.subjectScale = settings.subjectScale;
          if (settings.subjectX !== undefined) currentCfg.parameters.subjectX = settings.subjectX;
          if (settings.subjectY !== undefined) currentCfg.parameters.subjectY = settings.subjectY;
          if (settings.bgScale !== undefined) currentCfg.parameters.bgScale = settings.bgScale;
          if (settings.bgX !== undefined) currentCfg.parameters.bgX = settings.bgX;
          if (settings.bgY !== undefined) currentCfg.parameters.bgY = settings.bgY;
          if (settings.bgBlur !== undefined) currentCfg.parameters.bgBlur = settings.bgBlur;
          if (settings.depth !== undefined) currentCfg.parameters.subjectDepth = settings.depth;
          if (settings.bgDepth !== undefined) currentCfg.parameters.backgroundDepth = settings.bgDepth;
          if (settings.diff !== undefined) currentCfg.parameters.diff = settings.diff;
          if (settings.foil !== undefined) currentCfg.parameters.foil = settings.foil;
          if (settings.fxGlow !== undefined) currentCfg.parameters.fxGlow = settings.fxGlow;
          if (settings.effectsDepth !== undefined) currentCfg.parameters.effectsDepth = settings.effectsDepth;

          await writeFile(cfgPath, JSON.stringify(currentCfg, null, 2), 'utf8');

          // 自动重打 ZIP 包，使导出的 ZIP 默认设置与当前保存设置完全一致
          exec('zip -r /root/projects/card/holo-card-website.zip index.html style.css workshop.css app.bundle.js site.bundle.js card-config.json _headers _redirects assets/ netlify/ -x "assets/*.orig.png" "assets/effects/*.orig.png" && cp -f /root/projects/card/holo-card-website.zip /root/holo-card-website.zip && cp -f /root/projects/card/holo-card-website.zip /root/projects/card/web/holo-card-website.zip && chmod 644 /root/holo-card-website.zip /root/projects/card/holo-card-website.zip /root/projects/card/web/holo-card-website.zip', { cwd: root });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: "Settings saved to disk and zip updated" }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // API: 一键自动部署纯享展台到 Netlify Drop (免登录临时预览站)
    if (req.method === 'POST' && (pathname === '/api/deploy-temp-site' || pathname === '/.netlify/functions/deploy-temp-site')) {
      const chunks = [];
      req.on('data', chunk => { chunks.push(chunk); });
      req.on('end', async () => {
        try {
          const rawBuffer = Buffer.concat(chunks);
          let zipBuffer = rawBuffer;
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('boundary=')) {
            const boundary = contentType.split('boundary=')[1].trim();
            const boundaryBuffer = Buffer.from('--' + boundary);
            const pkIdx = rawBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
            if (pkIdx !== -1) {
              const endBoundaryIdx = rawBuffer.lastIndexOf(boundaryBuffer);
              zipBuffer = rawBuffer.subarray(pkIdx, endBoundaryIdx > pkIdx ? endBoundaryIdx - 2 : rawBuffer.length);
            }
          }

          const zip = await JSZip.loadAsync(zipBuffer);
          const filesMap = {};
          const shaMap = {};

          for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const content = await zipEntry.async('nodebuffer');
            const cleanPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
            const sha = crypto.createHash('sha1').update(content).digest('hex');
            filesMap[cleanPath] = sha;
            shaMap[cleanPath] = { sha, content };
          }

          const userAgent = "Netlify-CLI/17.0.0";
          const apiBase = "https://api.netlify.com/api/v1";

          // 1. 获取 Drop Token
          const tokenRes = await fetch(`${apiBase}/drop/token`, {
            method: "POST",
            headers: {
              "User-Agent": userAgent,
              "Referer": "https://app.netlify.com",
              "Content-Type": "application/json"
            }
          });

          if (!tokenRes.ok) {
            const tokenErr = await tokenRes.text();
            throw new Error(`Netlify Token 响应异常 (${tokenRes.status}): ${tokenErr}`);
          }
          const { token } = await tokenRes.json();

          // 2. 创建 Drop Deploy
          const createRes = await fetch(`${apiBase}/drop`, {
            method: "POST",
            headers: {
              "User-Agent": userAgent,
              "Referer": "https://app.netlify.com",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              files: filesMap,
              token: token,
              created_via: "drop"
            })
          });

          if (!createRes.ok) {
            const createErr = await createRes.text();
            let parsedErr = {};
            try { parsedErr = JSON.parse(createErr); } catch(e){}
            if (createRes.status === 429 || (parsedErr.message && parsedErr.message.includes("limit"))) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                ok: false,
                code: "RATE_LIMITED",
                message: "Netlify 匿名部署接口触发了官方每日限额。"
              }));
            }
            throw new Error(`创建部署失败 (${createRes.status}): ${createErr}`);
          }

          const deployInfo = await createRes.json();

          // 3. 上传所需文件
          for (const [cleanPath, item] of Object.entries(shaMap)) {
            if (deployInfo.required && deployInfo.required.includes(item.sha)) {
              await fetch(`${apiBase}/deploys/${deployInfo.deploy_id}/files${encodeURI(cleanPath)}`, {
                method: "PUT",
                headers: {
                  "User-Agent": userAgent,
                  "Referer": "https://app.netlify.com",
                  "Content-Type": "application/octet-stream",
                  "Authorization": `Bearer ${token}`
                },
                body: item.content
              });
            }
          }

          const liveUrl = `https://${deployInfo.subdomain}.netlify.app`;
          const claimUrl = `https://app.netlify.com/drop/${deployInfo.subdomain}#drop_token=${token}`;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            subdomain: deployInfo.subdomain,
            url: liveUrl,
            claimUrl: claimUrl
          }));
        } catch (err) {
          console.error("Deploy temp site error:", err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: err.message,
            message: "Netlify 部署接口响应异常: " + err.message
          }));
        }
      });
      return;
    }

    let filename = path.resolve(root, '.' + pathname);
    if (filename !== root && !filename.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if ((await stat(filename)).isDirectory()) {
      filename = path.join(filename, 'index.html');
    }
    const data = await readFile(filename);
    const ext = path.extname(filename);
    const headers = {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    };
    if (ext === '.zip') {
      headers['Content-Disposition'] = `attachment; filename="${path.basename(filename)}"`;
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Holo Card Studio: http://127.0.0.1:${port}`));
