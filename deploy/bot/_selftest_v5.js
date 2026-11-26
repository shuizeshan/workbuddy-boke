/* v5 全链路自测：真实启动 server.js，模拟 Halo（校验 Host+Cookie 透传）/DeepSeek */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'botv5-'));
const LEDGER = path.join(TMP, 'ledger.json');
const PORT = 14101, HALO_PORT = 14102, DS_PORT = 14103;
const REAL_HOST = '<你的壳域名>';

// 模拟 Halo：users/- 根据 Cookie 里的 SESSION 决定身份；并记录收到的 Host
let lastWhoHost = '', lastWhoCookie = '';
const sessions = {
  'SESSION=admin-session': { name: '<你的管理员账号>', roles: [{ metadata: { name: 'super-role' } }] },
  'SESSION=user-session': { name: 'zhangsan', roles: [{ metadata: { name: 'role-template-view-comments' } }] },
  'SESSION=bob-session': { name: 'bob', roles: [] },
};
const halo = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.indexOf('/users/-') >= 0) {
    lastWhoHost = req.headers.host || '';
    lastWhoCookie = req.headers.cookie || '';
    const s = sessions[req.headers.cookie];
    if (s) return res.end(JSON.stringify({ user: { metadata: { name: s.name } }, roles: s.roles }));
    return res.end(JSON.stringify({ user: { metadata: { name: 'anonymousUser' } }, roles: [] }));
  }
  if (req.url.indexOf('/posts?') >= 0) return res.end(JSON.stringify({ items: [] }));
  if (req.url.indexOf('/comments?') >= 0) return res.end(JSON.stringify({ items: [] }));
  res.end('{}');
});
let dsFailMode = false; // C1 测试：模拟 DeepSeek 返回 500，验证配额回滚
const ds = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    if (dsFailMode) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'simulated failure' })); }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '模拟回答' } }] }));
  });
});

function call(p, method, body, cookie, host) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (host) headers.Host = host;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method || 'GET', headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j; try { j = JSON.parse(d) } catch (e) { j = d } resolve({ code: res.statusCode, data: j }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('[OK] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => halo.listen(HALO_PORT, '127.0.0.1', r));
  await new Promise(r => ds.listen(DS_PORT, '127.0.0.1', r));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), HALO_BASE: 'http://127.0.0.1:' + HALO_PORT,
      DEEPSEEK_BASE: 'http://127.0.0.1:' + DS_PORT, DEEPSEEK_KEY: 'sk-test', HALO_PAT: '', LEDGER_PATH: LEDGER },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => process.stdout.write('  [srv] ' + d));
  child.stderr.on('data', d => process.stderr.write('  [srv-err] ' + d));
  await new Promise(r => setTimeout(r, 700));

  try {
    const h = await call('/health');
    check('health 返回 v5', h.code === 200 && h.data.ver === 'v5', h);

    // 未登录（无 Cookie）
    const s0 = await call('/status');
    check('无 Cookie => 未登录', s0.data.loggedIn === false, s0);

    // 无效 Cookie
    const s1 = await call('/status', 'GET', null, 'SESSION=invalid');
    check('无效 Cookie => 未登录', s1.data.loggedIn === false, s1);

    // 普通用户登录 + 显式 Host（模拟 nginx 透传原始域名）
    const s2 = await call('/status', 'GET', null, 'SESSION=user-session', REAL_HOST);
    check('普通用户 => 剩余1次', s2.data.loggedIn === true && s2.data.remaining === 1, s2);
    check('Host 被正确透传给 Halo', lastWhoHost === REAL_HOST, { lastWhoHost });
    check('Cookie 被正确透传给 Halo', lastWhoCookie === 'SESSION=user-session', { lastWhoCookie });

    // 管理员登录（roles 是对象数组，验证能正确识别 super-role）
    const s3 = await call('/status', 'GET', null, 'SESSION=admin-session', REAL_HOST);
    check('管理员 => 不限次数（对象数组roles正确解析）', s3.data.loggedIn === true && s3.data.admin === true && s3.data.remaining === -1, s3);

    // 普通用户聊天
    const c1 = await call('/chat', 'POST', { messages: [{ role: 'user', content: '你好' }] }, 'SESSION=user-session', REAL_HOST);
    check('普通用户第1次聊天成功', c1.code === 200 && c1.data.reply === '模拟回答', c1);
    const c2 = await call('/chat', 'POST', { messages: [{ role: 'user', content: '再问' }] }, 'SESSION=user-session', REAL_HOST);
    check('普通用户第2次 => 403无额度', c2.code === 403 && c2.data.noQuota === true, c2);

    // 管理员连聊
    const c3 = await call('/chat', 'POST', { messages: [{ role: 'user', content: 'A' }] }, 'SESSION=admin-session', REAL_HOST);
    const c4 = await call('/chat', 'POST', { messages: [{ role: 'user', content: 'B' }] }, 'SESSION=admin-session', REAL_HOST);
    check('管理员连聊2次成功', c3.code === 200 && c4.code === 200, [c3, c4]);

    // C1 修复验证：普通用户新建档 1 次，AI 失败(500) 时应退还且不白扣
    const sb = await call('/status', 'GET', null, 'SESSION=bob-session', REAL_HOST);
    check('C1前置：新用户余额为1', sb.data.loggedIn === true && sb.data.remaining === 1, sb);
    dsFailMode = true;
    const failChat = await call('/chat', 'POST', { messages: [{ role: 'user', content: '触发失败' }] }, 'SESSION=bob-session', REAL_HOST);
    dsFailMode = false;
    check('C1：AI失败返回502且标记refunded', failChat.code === 502 && failChat.data.refunded === true, failChat);
    check('C1：AI失败后余额退还为1', failChat.data.remaining === 1, failChat);
    const sbAfter = await call('/status', 'GET', null, 'SESSION=bob-session', REAL_HOST);
    check('C1：再次查状态余额仍为1（账本已回写）', sbAfter.data.remaining === 1, sbAfter);
    const okChat = await call('/chat', 'POST', { messages: [{ role: 'user', content: '恢复后重试' }] }, 'SESSION=bob-session', REAL_HOST);
    check('C1：恢复后能正常聊天且扣1次', okChat.code === 200 && okChat.data.remaining === 0, okChat);

    // 参数校验
    const bad = await call('/chat', 'POST', { messages: [] }, 'SESSION=admin-session', REAL_HOST);
    check('空消息 => 400', bad.code === 400, bad);
    const guestChat = await call('/chat', 'POST', { messages: [{ role: 'user', content: 'x' }] });
    check('未登录聊天 => 401', guestChat.code === 401, guestChat);

    // 账本持久化：确认新用户已落盘
    const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    check('新用户额度已落盘', ledger.users && ledger.users.zhangsan && ledger.users.zhangsan.remaining === 0, ledger);

  } catch (e) {
    fail++; console.log('[ERROR] 测试异常:', e.stack);
  } finally {
    child.kill(); halo.close(); ds.close();
    console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  }
})();
