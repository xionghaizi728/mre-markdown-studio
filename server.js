'use strict';

/**
 * MRE · Markdown 读写工作台 —— 零依赖 Node 后端
 * 只用 Node 内置模块，不需要 npm install。
 * 启动：node server.js   （或 npm start）
 * 环境变量：PORT（默认 3000）、HOST（默认 127.0.0.1）、DOCS_DIR（默认 ./docs）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DOCS_DIR = path.resolve(process.env.DOCS_DIR || path.join(__dirname, 'docs'));
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MAX_BODY = 10 * 1024 * 1024; // 10MB
const MD_EXT = /\.(md|markdown)$/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/* ---------------------------------------------------------------- 工具 */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '请求内容过大（上限 10MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, '请求体不是合法的 JSON'));
      }
    });
  });
}

/** 把用户给的相对路径解析成 docs 目录内的绝对路径，越界或非 Markdown 一律拒绝 */
function resolveDocPath(relPath, { mustBeMd = true } = {}) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new HttpError(400, '缺少文件路径');
  }
  let rel = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('\0')) throw new HttpError(400, '非法路径');
  if (rel.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new HttpError(400, '路径不允许包含 . 或 ..');
  }
  if (mustBeMd && !MD_EXT.test(rel)) {
    throw new HttpError(400, '只支持 .md / .markdown 文件');
  }
  const abs = path.resolve(DOCS_DIR, rel);
  const prefix = DOCS_DIR.endsWith(path.sep) ? DOCS_DIR : DOCS_DIR + path.sep;
  if (!abs.startsWith(prefix)) throw new HttpError(400, '路径超出文档目录');
  return { abs, rel: path.relative(DOCS_DIR, abs).replace(/\\/g, '/') };
}

async function ensureDocsDir() {
  await fs.promises.mkdir(DOCS_DIR, { recursive: true });
}

async function walkMarkdown(dir, root, results, depth = 0) {
  if (depth > 8) return;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(abs, root, results, depth + 1);
    } else if (entry.isFile() && MD_EXT.test(entry.name)) {
      const stat = await fs.promises.stat(abs);
      results.push({
        path: path.relative(root, abs).replace(/\\/g, '/'),
        name: entry.name,
        size: stat.size,
        mtime: stat.mtimeMs
      });
    }
  }
}

/* ---------------------------------------------------------------- 静态文件 */

const STATIC_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/styles.css': 'styles.css',
  '/vendor/marked.min.js': 'vendor/marked.min.js'
};

function serveStatic(req, res, pathname) {
  const rel = STATIC_FILES[pathname];
  if (!rel) return false;
  const file = path.join(PUBLIC_DIR, rel);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('静态文件缺失：' + rel);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': rel === 'index.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(data);
  });
  return true;
}

/* ---------------------------------------------------------------- API */

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, docsDir: DOCS_DIR, port: PORT });
  }

  // 文件列表
  if (pathname === '/api/files' && req.method === 'GET') {
    const files = [];
    await walkMarkdown(DOCS_DIR, DOCS_DIR, files);
    files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
    return sendJson(res, 200, { docsDir: DOCS_DIR, files });
  }

  // 读取单个文件
  if (pathname === '/api/file' && req.method === 'GET') {
    const { abs, rel } = resolveDocPath(url.searchParams.get('path'));
    let content;
    try {
      content = await fs.promises.readFile(abs, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new HttpError(404, '文件不存在：' + rel);
      throw err;
    }
    const stat = await fs.promises.stat(abs);
    return sendJson(res, 200, { path: rel, content, size: stat.size, mtime: stat.mtimeMs });
  }

  // 保存（覆盖写入）
  if (pathname === '/api/file' && req.method === 'PUT') {
    const body = await readBody(req);
    const { abs, rel } = resolveDocPath(body.path);
    if (typeof body.content !== 'string') throw new HttpError(400, '缺少 content 字段');
    try {
      await fs.promises.access(abs, fs.constants.W_OK);
    } catch (err) {
      if (err.code === 'ENOENT') throw new HttpError(404, '文件不存在：' + rel);
      throw new HttpError(403, '文件没有写入权限：' + rel);
    }
    await fs.promises.writeFile(abs, body.content, 'utf8');
    const stat = await fs.promises.stat(abs);
    return sendJson(res, 200, { path: rel, size: stat.size, mtime: stat.mtimeMs, saved: true });
  }

  // 新建
  if (pathname === '/api/file' && req.method === 'POST') {
    const body = await readBody(req);
    const { abs, rel } = resolveDocPath(body.path);
    const content = typeof body.content === 'string' ? body.content : '';
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    if (body.overwrite === true) {
      await fs.promises.writeFile(abs, content, 'utf8');
    } else {
      try {
        await fs.promises.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
      } catch (err) {
        if (err.code === 'EEXIST') throw new HttpError(409, '同名文件已存在：' + rel);
        throw err;
      }
    }
    return sendJson(res, 201, { path: rel, created: true });
  }

  // 重命名 / 移动
  if (pathname === '/api/rename' && req.method === 'POST') {
    const body = await readBody(req);
    const from = resolveDocPath(body.from);
    const to = resolveDocPath(body.to);
    try {
      await fs.promises.access(to.abs, fs.constants.F_OK);
      throw new HttpError(409, '目标文件已存在：' + to.rel);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err.code !== 'ENOENT') throw err;
    }
    await fs.promises.mkdir(path.dirname(to.abs), { recursive: true });
    await fs.promises.rename(from.abs, to.abs);
    return sendJson(res, 200, { from: from.rel, to: to.rel, renamed: true });
  }

  // 删除
  if (pathname === '/api/file' && req.method === 'DELETE') {
    const { abs, rel } = resolveDocPath(url.searchParams.get('path'));
    try {
      await fs.promises.unlink(abs);
    } catch (err) {
      if (err.code === 'ENOENT') throw new HttpError(404, '文件不存在：' + rel);
      throw err;
    }
    return sendJson(res, 200, { path: rel, deleted: true });
  }

  throw new HttpError(404, '未知接口：' + req.method + ' ' + pathname);
}

/* ---------------------------------------------------------------- 服务 */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (serveStatic(req, res, url.pathname)) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[MRE]', err);
    if (!res.headersSent) {
      sendJson(res, status, { error: err.message || '服务器内部错误' });
    } else {
      res.end();
    }
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

ensureDocsDir()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log('');
      console.log('  MRE · Markdown 读写工作台已启动');
      console.log('  地址： http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT);
      console.log('  文档： ' + DOCS_DIR);
      console.log('');
    });
  })
  .catch((err) => {
    console.error('初始化文档目录失败：', err);
    process.exit(1);
  });

// 端口被占用时给出清晰提示
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，可用 PORT=3010 node server.js 换一个端口启动。');
    process.exit(1);
  }
  throw err;
});
