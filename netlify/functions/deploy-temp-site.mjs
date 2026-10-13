import crypto from 'node:crypto';
import JSZip from 'jszip';

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const rawBuffer = Buffer.from(await req.arrayBuffer());
    let zipBuffer = rawBuffer;
    const contentType = req.headers.get('content-type') || '';
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
      throw new Error(`Netlify Token 异常: ${tokenErr}`);
    }
    const { token } = await tokenRes.json();

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
        return new Response(JSON.stringify({
          ok: false,
          code: "RATE_LIMITED",
          message: "Netlify 匿名部署接口触发了官方每日限额。"
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      throw new Error(`创建部署失败 (${createRes.status}): ${createErr}`);
    }

    const deployInfo = await createRes.json();

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

    return new Response(JSON.stringify({
      ok: true,
      subdomain: deployInfo.subdomain,
      url: `https://${deployInfo.subdomain}.netlify.app`,
      claimUrl: `https://app.netlify.com/drop/${deployInfo.subdomain}#drop_token=${token}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err.message,
      message: "Netlify 部署异常: " + err.message
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
