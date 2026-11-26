/*
 * 带鉴权与配额的 AI 机器人服务端代理 (v5 · 2026-11-24 最终重构)
 * 零依赖：仅用 Node.js 内置模块
 *
 * v5 关键修复（彻底终结"已登录却显示未登录/反复改"）：
 *   - v3/v4 的 HMAC 方案根本不成立：前端用 nonce 当签名密钥，后端用 signSecret
 *     验签，两边密钥不同 → 100% 失败；且纯前端无法安全持有密钥（F12 可见）。
 *   - v1 失败真凶：Node 的 fetch 会把 Host 头改写成 127.0.0.1，Halo 会话按域名
 *     绑定 → 带过去的 Cookie 失效。
 *   - v5 正解：后端用【原生 http.request 显式设置 Host 头】把浏览器的 Cookie
 *     原样转发给 Halo 的 users/-，让 Halo 亲自判定身份（可信、不可伪造）。
 *     已本地实测：http.request 自定义 Host + Cookie 均正确透传；fetch 不行。
 *
 * 前端因此彻底简化：只需同源请求 /bot-api/*，浏览器自动带 Cookie，无需签名/nonce。
 *
 * 职责：
 *   1. /bot-api/status  从 Cookie 问 Halo 身份 → 返回配额状态
 *   2. /bot-api/chat    鉴权 → 配额校验扣减 → 代理 DeepSeek
 *   3. /bot-api/health  健康检查（保留，便于运维；ver=v5）
 *   4. /bot-api/auth-nonce 兼容旧前端的空实现（返回 ok:true，新前端不用）
 *   5. 文章（公开接口）与评论（管理接口 + PAT）兑换额度，按 ID 去重
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CFG = {
  port: Number(process.env.PORT || 3001),
  haloBase: (process.env.HALO_BASE || 'http://127.0.0.1:28090').replace(/\/$/, ''),
  haloPAT: process.env.HALO_PAT || '',
  deepseekKey: process.env.DEEPSEEK_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  deepseekBase: (process.env.DEEPSEEK_BASE || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
  ledgerPath: process.env.LEDGER_PATH || '/app/data/ledger.json',
  pageSize: Number(process.env.PAGE_SIZE || 500),
};

const FREE_QUOTA = 1;

function log(...a) { console.log('[bot]', new Date().toISOString().slice(11, 19), ...a); }

/* ---------------- 身份识别：带 Cookie + 显式 Host 问 Halo ---------------- */

function parseHaloHost() {
  // haloBase 形如 http://127.0.0.1:28090，解析出 hostname/port 用于 http.request
  const u = new URL(CFG.haloBase);
  return { hostname: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) };
}

/**
 * 用浏览器的原始 Host + Cookie 请求 Halo，拿到可信身份。
 * @param {string} cookie 浏览器访问 /bot-api 时携带的完整 Cookie 头
 * @param {string} originalHost 浏览器原始 Host（nginx 透传），Halo 会话按此绑定
 */
function whoAmI(cookie, originalHost) {
  return new Promise((resolve) => {
    if (!cookie) return resolve({ name: 'anonymousUser', roles: [], admin: false });
    const target = parseHaloHost();
    const headers = { Cookie: cookie };
    if (originalHost) headers.Host = originalHost; // 关键：显式设置 Host，模拟浏览器原始域名
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: '/apis/api.console.halo.run/v1alpha1/users/-',
      method: 'GET',
      headers,
      timeout: 8000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const name = data && data.user && data.user.metadata && data.user.metadata.name;
          const rolesRaw = Array.isArray(data.roles) ? data.roles : [];
          // Halo 返回角色是对象数组：[{metadata:{name:"super-role"}}]，需取 metadata.name
          const roles = rolesRaw.map((r) => (r && r.metadata && r.metadata.name) || (typeof r === 'string' ? r : '')).filter(Boolean);
          const admin = roles.includes('super-role');
          resolve({ name: name || 'anonymousUser', roles, admin });
        } catch (e) {
          log('身份解析失败:', e.message, raw.slice(0, 120));
          resolve({ name: 'anonymousUser', roles: [], admin: false });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ name: 'anonymousUser', roles: [], admin: false }); });
    req.on('error', (e) => { log('身份请求失败:', e.message); resolve({ name: 'anonymousUser', roles: [], admin: false }); });
    req.end();
  });
}

/* ---------------- 账本：原子读 + 原子写 + 串行锁 ---------------- */

function loadLedger() {
  try {
    const raw = fs.readFileSync(CFG.ledgerPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.users) throw new Error('bad ledger');
    return data;
  } catch (e) {
    log('账本不存在或损坏，初始化空账本:', e.message);
    return { users: {} };
  }
}

function saveLedger(data) {
  const dir = path.dirname(CFG.ledgerPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = CFG.ledgerPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, CFG.ledgerPath); // 原子替换，避免半写
}

function newRecord() {
  return { remaining: FREE_QUOTA, claimedPosts: [], claimedComments: [], createdAt: new Date().toISOString() };
}

let _lock = Promise.resolve();
function withLock(fn) {
  const run = _lock.then(fn, fn);
  _lock = run.catch(() => {});
  return run;
}

/* ---------------- 额度兑换：文章 + 评论 ---------------- */

function fetchJSON(url, headers) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const target = { hostname: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)), path: u.pathname + u.search, method: 'GET', headers: headers || {}, timeout: 8000 };
    const mod = u.protocol === 'https:' ? require('https') : http;
    const req = mod.request(target, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) { log('查询HTTP', res.statusCode, url); return resolve(null); }
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', (e) => { log('查询失败:', e.message); resolve(null); });
    req.end();
  });
}

async function fetchAllPosts() {
  const data = await fetchJSON(CFG.haloBase + '/apis/api.content.halo.run/v1alpha1/posts?size=' + CFG.pageSize);
  return data && Array.isArray(data.items) ? data.items : [];
}

async function fetchAllComments() {
  if (!CFG.haloPAT) return null;
  const data = await fetchJSON(CFG.haloBase + '/apis/api.console.halo.run/v1alpha1/comments?size=' + CFG.pageSize, { Authorization: 'Bearer ' + CFG.haloPAT });
  return data && Array.isArray(data.items) ? data.items : null;
}

function postAuthorName(post) {
  const cs = post.contributors || [];
  for (const c of cs) if (c && c.name && c.name !== 'anonymousUser') return c.name;
  return null;
}

/**
 * Halo 控制台评论 API 返回结构（v2.27.3 实测）：
 * items[i] = { comment: { metadata:{name}, spec:{ owner:{name}, approved } }, owner:{...}, ... }
 * 作者和 ID 都在 items[i].comment 里面，不能读 items[i].spec（那是 undefined）。
 * 这里同时兼容"直接是 comment 对象"的旧结构，避免 Halo 版本差异再次踩坑。
 */
function asComment(item) {
  return item && item.comment ? item.comment : item;
}
function commentAuthorName(item) {
  const c = asComment(item);
  const o = c && c.spec && c.spec.owner;
  if (!o) return null;
  if (o.name) return String(o.name).replace(/^user:/, '');
  if (o.displayName) return String(o.displayName);
  return null;
}
function commentId(item) {
  const c = asComment(item);
  return c && c.metadata && c.metadata.name || null;
}

async function syncQuota(name) {
  const ledger = loadLedger();
  const isNew = !ledger.users[name];
  if (isNew) ledger.users[name] = newRecord();
  const rec = ledger.users[name];
  if (isNew) { saveLedger(ledger); log('新用户建档', name, '赠送', rec.remaining, '次'); }

  const [posts, comments] = await Promise.all([fetchAllPosts(), fetchAllComments()]);

  let gainedPosts = 0, gainedComments = 0;
  for (const p of posts) {
    const author = postAuthorName(p);
    const id = p.metadata && p.metadata.name;
    if (author === name && id && !rec.claimedPosts.includes(id)) {
      rec.claimedPosts.push(id);
      rec.remaining += 1;
      gainedPosts++;
    }
  }
  if (comments) {
    for (const c of comments) {
      const author = commentAuthorName(c);
      const id = commentId(c);
      // 只认审核通过的评论，避免"先刷评论再删"白嫖额度；与前端提示保持一致
      const approved = asComment(c).spec && asComment(c).spec.approved === true;
      if (author === name && id && approved && !rec.claimedComments.includes(id)) {
        rec.claimedComments.push(id);
        rec.remaining += 1;
        gainedComments++;
      }
    }
  }
  if (gainedPosts || gainedComments) {
    saveLedger(ledger);
    log('兑换', name, '文章+', gainedPosts, '评论+', gainedComments, '余额', rec.remaining);
  }
  return { remaining: rec.remaining, gainedPosts, gainedComments, commentAvailable: comments !== null, ledger, rec };
}

/* ---------------- HTTP 工具 ---------------- */

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// 从请求里取浏览器原始 Host（nginx 的 proxy_set_header Host $host 会传入）
function originalHostOf(req) {
  return req.headers['x-forwarded-host'] || req.headers.host || '';
}

/* ---------------- 路由处理 ---------------- */

async function handleStatus(res, identity) {
  if (identity.name === 'anonymousUser') {
    return sendJSON(res, 200, { loggedIn: false, admin: false, remaining: 0, needLogin: true });
  }
  if (identity.admin) {
    return sendJSON(res, 200, {
      loggedIn: true, admin: true, username: identity.name, unlimited: true,
      remaining: -1, needLogin: false,
    });
  }
  const q = await withLock(() => syncQuota(identity.name));
  return sendJSON(res, 200, {
    loggedIn: true, admin: false, username: identity.name, unlimited: false,
    remaining: q.remaining, needLogin: false,
    earned: { posts: q.gainedPosts, comments: q.gainedComments },
    commentAvailable: q.commentAvailable,
  });
}

async function handleChat(req, res, identity) {
  if (!CFG.deepseekKey) return sendJSON(res, 500, { error: '服务端未配置 DeepSeek 密钥，请联系站长' });
  if (identity.name === 'anonymousUser') return sendJSON(res, 401, { error: '请先登录博客账号后再使用', needLogin: true });

  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (e) { return sendJSON(res, 400, { error: '请求格式错误' }); }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return sendJSON(res, 400, { error: '缺少对话内容' });
  const userMessages = messages.filter((m) => m && m.role === 'user' && typeof m.content === 'string');
  if (userMessages.length === 0) return sendJSON(res, 400, { error: '缺少用户消息' });

  // 管理员不限次数：不扣配额，直接调用；失败即返回错误（无配额可回滚）
  if (identity.admin) {
    const ai = await callDeepSeek(userMessages);
    if (ai.ok) return sendJSON(res, 200, { reply: ai.content });
    return sendJSON(res, 502, { error: ai.error, ...(ai.upstream ? { upstream: ai.upstream } : {}) });
  }

  const decision = await withLock(async () => {
    const q = await syncQuota(identity.name);
    if (q.remaining <= 0) return { ok: false, remaining: 0, earned: { posts: q.gainedPosts, comments: q.gainedComments } };
    q.rec.remaining -= 1;
    saveLedger(q.ledger);
    return { ok: true, remaining: q.rec.remaining, earned: { posts: q.gainedPosts, comments: q.gainedComments } };
  });

  if (!decision.ok) {
    return sendJSON(res, 403, {
      error: '聊天次数已用完。发布文章（审核通过）或评论一次，即可再获得一次聊天机会。',
      noQuota: true, remaining: 0, earned: decision.earned,
    });
  }

  // C1 修复：先扣后调，AI 失败则在同一串行锁内把这次扣减退还，避免用户白扣次数。
  // 回滚只加回本次的 1 次（不受其他并发影响，因为账本写入全程在 withLock 内串行）。
  const ai = await callDeepSeek(userMessages);
  if (ai.ok) {
    return sendJSON(res, 200, { reply: ai.content, remaining: decision.remaining });
  }
  const refund = await withLock(() => {
    const ledger = loadLedger();
    const rec = ledger.users[identity.name];
    if (!rec) return 0; // 账本异常时不再写，避免制造错误数据
    rec.remaining = Math.min(rec.remaining + 1, FREE_QUOTA + rec.claimedPosts.length + rec.claimedComments.length);
    saveLedger(ledger);
    log('AI 失败，配额已退还', identity.name, '余额', rec.remaining);
    return rec.remaining;
  });
  return sendJSON(res, 502, {
    error: ai.error,
    ...(ai.upstream ? { upstream: ai.upstream } : {}),
    refunded: true,
    remaining: refund,
  });
}

/**
 * 调用 DeepSeek，只返回结构化结果，不直接写响应。
 * C1 修复：把"扣配额"与"写响应"解耦，使 handleChat 能在 AI 失败时回滚配额。
 * 返回 { ok:true, content } 或 { ok:false, error, upstream? }。
 */
async function callDeepSeek(userMessages) {
  const system = process.env.SYSTEM_PROMPT ||
    '你是「水泽山」个人博客的问答助手。始终用简体中文简洁回答，只依据可见信息，不编造。';
  const payload = {
    model: CFG.deepseekModel,
    messages: [{ role: 'system', content: system }, ...userMessages.slice(-10)],
    temperature: 0.6,
    max_tokens: 800,
    stream: false,
    thinking: { type: 'disabled' },
  };
  try {
    const body = JSON.stringify(payload);
    const u = new URL(CFG.deepseekBase + '/chat/completions');
    const mod = u.protocol === 'https:' ? require('https') : http;
    const out = await new Promise((resolve, reject) => {
      const req = mod.request({
        hostname: u.hostname, port: Number(u.port || 443), path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.deepseekKey, 'Content-Length': Buffer.byteLength(body) },
        timeout: 60000,
      }, (r) => {
        let raw = '';
        r.on('data', (c) => (raw += c));
        r.on('end', () => resolve({ code: r.statusCode, raw }));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek 超时')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (out.code < 200 || out.code >= 300) {
      log('DeepSeek HTTP', out.code, out.raw.slice(0, 200));
      let msg = 'AI 服务暂时不可用（HTTP ' + out.code + '），请稍后再试';
      if (out.code === 401 || out.code === 403) msg = '服务端 API 密钥无效，请联系站长';
      else if (out.code === 429) msg = 'AI 服务繁忙或额度不足，请稍后再试';
      return { ok: false, error: msg, upstream: out.code };
    }
    let data;
    try { data = JSON.parse(out.raw); } catch (e) { return { ok: false, error: 'AI 返回格式异常' }; }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') return { ok: false, error: 'AI 返回内容为空' };
    return { ok: true, content };
  } catch (e) {
    log('DeepSeek 调用失败:', e.message);
    return { ok: false, error: '连接 AI 服务失败，请稍后再试' };
  }
}

/* ---------------- 服务入口 ---------------- */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') return sendJSON(res, 200, { ok: true, model: CFG.deepseekModel, ver: 'v5' });
  // 兼容旧前端：新前端不用，返回无害占位，避免 404
  if (u.pathname === '/auth-nonce') return sendJSON(res, 200, { ok: true, deprecated: true });

  const host = originalHostOf(req);
  const identity = await whoAmI(req.headers.cookie || '', host);

  try {
    if (req.method === 'GET' && u.pathname === '/status') return await handleStatus(res, identity);
    if (req.method === 'POST' && u.pathname === '/chat') return await handleChat(req, res, identity);
    return sendJSON(res, 404, { error: 'Not found' });
  } catch (e) {
    log('未捕获错误:', e.stack || e.message);
    return sendJSON(res, 500, { error: '服务内部错误' });
  }
});

server.listen(CFG.port, '127.0.0.1', () => {
  log('服务已启动 127.0.0.1:' + CFG.port, '| ver v5');
  log('Halo:', CFG.haloBase, '| 模型:', CFG.deepseekModel, '| PAT:', CFG.haloPAT ? '已配置' : '未配置');
  log('账本:', CFG.ledgerPath);
});
