# API 机器人（鉴权+配额版 · v5 终版）部署指南

> 配套方案：`PLAN-BOT.md`（历史方案）　服务端：`server.js`(v5+C1, **17427B**)　前端：`api-bot.html`(**13681B**，已移除"返回博客"链接)　nginx.conf(**4765B**)
> v5 重构日期：2026-11-24　本地验证：`_selftest_v5.js` **18/18 真实链路通过**（13 基础 + 5 条 AI 失败回滚用例）
> **2026-11-26 更新（v5+C1 已部署）**：C1「AI 调用失败退还配额」+ C4「前端过期文案」已上线 NAS；旧文件备份 `/vol1/bot/*.bak_20261126_c`，账本备份 `/vol1/bot/data/ledger.json.bak_20261126`。
> **2026-11-25 15:50 最终状态（本指南以此为准）**：内外网已全部打通并多轮验证通过。**花生壳映射保持 28090 不变**（无需网页操作）。28090 现由 bot-nginx 智能分流：`/bot*`、`/bot-api*` 给机器人，其余转发 Halo(内部 28091)。`/bot` 由 nginx 静态托管，不依赖 Halo 建页/iframe/破缓存。
> **16:45 关键修正（以 PROJECT.md H 节为准）**：15:50 加的 `sub_filter` 曾被 curl 误判"已生效"——真凶是 **Halo 返回 `content-encoding: gzip`，nginx sub_filter 处理不了压缩流**，真实浏览器里 iframe 仍是外网绝对域名 → 内网登录态跨域失效、"点登录没反应"。**正解**：`location /` 里再加 `proxy_set_header Accept-Encoding "";` 强制上游不压缩，`sub_filter` 才生效。已用 Playwright 真实浏览器 3 轮验证内外网均同源+管理员识别正常。**验证 sub_filter 务必带 `Accept-Encoding: gzip`，否则 curl 是假阳性。** 另：server.js 评论解析改用 `asComment()` 兼容 Halo `items[i].comment` 嵌套（修评论不额度，详见 G 节）。

## ★ 当前访问入口（2026-11-25 最终）

- **外网**：`https://<你的壳域名>/bot`
- **内网**：`http://<NAS_IP>:28090/bot`（18080 作备用入口，同样可用）
- Halo 已在内部端口 **28091** 运行（数据卷 `/var/apps/docker-halo/var/halo2` 原样，数据零丢失）；花生壳仍指 28090，由 bot-nginx 分流。

**快速验证**（SSH 内执行）：
```
curl -s http://127.0.0.1:28090/bot-api/health
curl -s https://<你的壳域名>/bot-api/health
```
✅ 两条都返回 `{"ok":true,"model":"deepseek-flash","ver":"v5"}`；外网 `/bot` 与首页均 200。

**浏览器验证**：管理员登录 `https://<你的壳域名>/bot` → 徽标显示"管理员·不限次数"→ 连聊 3 次正常（Halo CSRF+RSA，需浏览器，curl 无法模拟）。

> 下方旧阶段 2（Halo 建页 + iframe）、旧"切映射 18080"、旧"只走 18080"均已作废，仅作历史存档，不要再用。完整改造过程与回滚方案见 `PROJECT.md` 弯路复盘 F 节。

---

## ⚠️ 两条铁律（违反必踩坑）

1. **统一走 28090 入口（本地已分流），花生壳不用动**：
   - 外网 `https://域名/bot`、内网 `:28090/bot`、备用 `:18080/bot` 三者都可用
   - 28090 = bot-nginx 分流：`/bot*`/`/bot-api*` → 机器人，其余 → Halo(28091)
   - ❌ 不要再把 Halo 手动启回 28090（会与 bot-nginx 抢端口）；Halo 应在 28091
   - ❌ 不要再去找花生壳改 18080——映射是云端规则，本地改不了，也不需要改
2. **身份由后端问 Halo（v5 正解）**：后端用原生 `http.request` **显式设 Host 头 + 透传浏览器 Cookie** 去问 Halo `users/-`，让 Halo 亲自判身份。
   - 前端只做同源 `/bot-api/*` 请求，浏览器自动带 Cookie，**零签名**
   - ❌ 不要再找"前端 HMAC 签名"那条路——纯前端无法安全持有密钥，v3/v4 已证伪废弃

---

## 前置条件

- Halo 已开启用户注册、评论、允许注册用户投稿/发文章（你已配置好）
- DeepSeek API 密钥（`.env` 里那把，2026-11-24 实测有效）
- SSH 已开启，能连到 NAS

---

## 阶段 0：核对密钥（已完成，通常跳过）

- `.env` 在 `/vol1/bot/.env`，含 `DEEPSEEK_KEY` / `DEEPSEEK_MODEL=deepseek-flash` / `HALO_PAT` / `SYSTEM_PROMPT`
- v5 **不再需要** `BOT_SIGN_SECRET`（HMAC 已废弃），`.env` 里若有也无妨，忽略即可
- 若需重建 PAT：Halo 后台 → 头像 → 个人中心 → 个人令牌 → 新建，**只勾「评论查看」**（权限标签页），不勾角色

---

## 阶段 1：部署 v5 服务端

### 1.1 Windows 上传两个文件

新开 Windows cmd（提示符 `C:\Users\...>`）：
```
scp E:\workbuddy\你的工作区\server.js <用户名>@<NAS_IP>:/tmp/bot-server.js
scp E:\workbuddy\你的工作区\nginx.conf <用户名>@<NAS_IP>:/tmp/bot-nginx.conf
```
✅ 每条显示 `100%`。docker-compose.yml 未变，无需重传。

### 1.2 NAS 落位（SSH 窗口 `<用户名>@<NAS主机名>:/$`）
```
sudo mv /tmp/bot-server.js /vol1/bot/server.js
sudo mv /tmp/bot-nginx.conf /vol1/bot/nginx.conf
```

### 1.3 强制重建容器（关键：必须 --force-recreate，重启不加载新代码）
```
cd /vol1/bot && sudo docker compose up -d --force-recreate
```
✅ 看到 `Recreated` 或 `Started`

### 1.4 验证 v5 已生效
```
curl -s http://127.0.0.1:18080/bot-api/health
```
✅ 返回 `{"ok":true,"model":"deepseek-flash","ver":"v5"}`
**关键**：必须看到 `"ver":"v5"`，否则是旧版没换上。

---

## 阶段 2：部署 v5 前端 + 内网端到端验证

> 🛑 **本阶段 2.1/2.2 为历史存档，已作废，切勿执行！** 当前 `/bot` 已由 nginx 静态托管（挂载 `./api-bot.html:/usr/share/nginx/html/api-bot.html:ro`），**不再需要**上传到 Halo 主题目录、不再需要重启 Halo、不再需要建页/iframe/`?v` 破缓存。当前正确做法见文件顶部「当前访问入口」与「两条铁律」。以下仅保留作故障复盘史料。

### 2.1 上传前端（已作废）
Windows cmd：
```
scp E:\workbuddy\你的工作区\api-bot.html <用户名>@<NAS_IP>:/tmp/api-bot.html
```
SSH 窗口：
```
sudo mv /tmp/api-bot.html /var/apps/docker-halo/var/halo2/themes/theme-luye/templates/assets/api-bot.html
sudo docker restart halo
```
✅ halo 重启成功（约15秒）

### 2.2 更新 Halo 页面 iframe

建议单独建 `/bot` 页面（不和 `/ai` 旧聊天页混）：
1. 后台 →「页面」→「新建」
2. 标题 `AI 机器人`，别名（固定链接）`bot`
3. **点 `</>` 切源码模式**（关键，否则转义白屏）
4. 粘贴（前端已加固登录误判，用 `?v=8`；以后每次改前端递增版本号破缓存）：
```html
<iframe src="/themes/theme-luye/assets/api-bot.html?v=8" style="display:block;width:100%;height:82vh;min-height:640px;border:0;border-radius:12px;"></iframe>
```
5. 保存并发布

> ⚠️ 若沿用在 `/ai` 页面那个旧 iframe，删掉旧的、只保留上面一条，`?v` 改大。
> ⚠️ 外网测试前必须先把花生壳映射切到 18080（阶段3），否则 `/bot-api` 404。

### 2.3 内网端到端验证（管理员重点）

内网电脑浏览器打开 **`http://<NAS_IP>:18080/bot`**（⚠️ 必须 18080）：

| # | 场景 | 期望 |
|---|---|---|
| 1 | 无痕窗口打开 | 显示「请先登录」门页，输入框禁用 |
| 2 | **管理员登录** | 徽标「管理员·不限次数」，**连问 3 次都正常**（这是 v5 核心验证） |
| 3 | 点「前往登录」 | 跳 Halo 登录页（非禁止图标/后台404），登录后自动回跳本页 |
| 4 | 普通用户登录 | 徽标「剩余 1 次」 |
| 5 | 提问一次 | 次数减 1，中文回答正常 |
| 6 | 用完再问 | 显示「对话次数已用完」+ 引导发文章/评论 |
| 7 | F12 查源码 | 无 `sk-` 密钥、无签名逻辑 |
| 8 | 访问博客首页 | 与部署前完全一致 |

**第 2 项是关键**：管理员能连聊 = v5 身份链路（Host+Cookie 转发 + 对象数组 roles 解析）全通。

---

## 阶段 3：切外网

> 🛑 **本阶段 3.1/3.2 为历史存档，已作废，切勿执行！** 花生壳映射**保持 28090 不动**（云端也改不了），本地由 bot-nginx 在 28090 分流实现内外网统一。当前外网验证直接按文件顶部「快速验证」执行即可。切映射到 18080 是已被推翻的旧方案。

### 3.1 改花生壳映射（已作废）
花生壳管理页 → `<你的壳域名>` 映射 → 编辑 → 内网端口 **28090 改为 18080** → 保存。
> nginx 会把非 `/bot-api` 请求原样转给 Halo(28090)，**博客、后台完全不受影响**。

### 3.2 外网验证
- 手机流量打开 `https://<你的壳域名>` → 博客首页正常
- 打开 `/bot` → 机器人页正常，登录后能聊
- `curl -s https://<你的壳域名>/bot-api/health` → 返回 `ver:"v5"`

### 3.3 回滚预案
花生壳映射改回 `28090` → 1 分钟恢复（机器人外网不可用但博客正常）。
停服务端容器不影响博客：
```
cd /vol1/bot && sudo docker compose down
```

---

## 常见问题（v5 版）

| 现象 | 原因 | 处理 |
|---|---|---|
| health 没有 `"ver":"v5"` | 容器没重建成功 | `cd /vol1/bot && sudo docker compose up -d --force-recreate` |
| 一直「未登录」但明明登录了 | ①浏览器对该域名没登录态 ②Host 没透传 ③**iframe 写死外网绝对域名导致跨域（内网高发）** | 在**同一域名**下重新登录；确认 nginx.conf 有 `proxy_set_header Host $host`；`curl /ai \| grep iframe` 看 src 是否为 `https://域名/...` 绝对地址——是则用 `sub_filter 'https://域名/' '/'` 替换为相对路径 |
| 内网站点「点登录没反应/登录后仍显示需登录」 | iframe src 写死外网域名 → 跨域，iframe 带外网 Cookie 与内网登录态不通。**若已配 sub_filter 仍无效 → 是 gzip 让 sub_filter 失效（curl 假阳性）** | nginx `location /` 里 `sub_filter 'https://<你的壳域名>/' '/'` + `sub_filter_once off` + `sub_filter_types application/json`，**且必须加 `proxy_set_header Accept-Encoding "";` 关闭上游 gzip**。验证：① `curl -H "Accept-Encoding: gzip" --compressed /ai \| grep iframe` 看 src 为 `/themes/...`；② 最好用 Playwright 真实浏览器确认 iframe 同源 |
| 登录后跳个人中心 `/user` | 回跳参数名错 | 确认前端 v5 含 `/login?redirect_uri=` + 相对 pathname |
| 外网报连接失败/404 | 28090 分流 nginx 没起来，或 Halo 不在 28091 | `docker ps` 看 bot-nginx/halo 都在；`ss -tlnp \| grep -E '28090\|28091'` 确认两个端口都在监听；不要去改花生壳 |
| 改了提示词但回答没变 | `.env` 多行污染致容器没重建 | `SYSTEM_PROMPT` 必须单行；`docker compose config -q` 校验；`force-recreate` 后确认 `docker exec bot-api printenv SYSTEM_PROMPT` 是新值 |
| 管理员显示"剩余1次"而非不限 | roles 解析错（旧版 bug） | 确认 server.js 是 v5（取 `r.metadata.name` 判断 super-role） |
| 评论/文章后次数不增加、刷新无效 | ①PAT 没勾「评论查看」②**评论 API 多套一层 `comment`，旧解析读空**（2026-11-25 修复） | 确认 PAT 只勾评论查看；确认 server.js 含 `asComment()` 且作者/ID 基于 `asComment()` 解析、只认 `approved===true`；直接读账本 `/app/data/ledger.json` 看 remaining/claimedComments 是否变化（唯一真相，别只盯 UI） |
| 502 Bad Gateway | bot-api 没起来 | `sudo docker logs bot-api` |

---

## 运维命令速查

```
cd /vol1/bot
sudo docker compose logs -f bot-api          # 看服务端日志
sudo docker compose up -d --force-recreate   # 改了 server.js/nginx.conf 后必须这样重建
sudo docker compose restart bot-api          # 仅改 .env 后可用 restart
sudo docker compose down                     # 完全停止（不影响博客）
cat /vol1/bot/data/ledger.json               # 查看配额账本
sudo cp -p /vol1/bot/data/ledger.json /vol1/bot/data/ledger.json.bak.$(date +%Y%m%d)  # 备份账本（唯一真相，改配额前先备份）
sudo cp -p /vol1/bot/data/ledger.json.bak.20261126 /vol1/bot/data/ledger.json  # 从备份恢复（每次请求实时读盘，无需重启）
curl -s http://127.0.0.1:18080/bot-api/health
```

---

## 版本历史

- v1：服务端转发 Cookie，但用 fetch → Node 改写 Host 导致登录态丢失 → 废弃
- v2：iframe 登录加 `target=_top` → 仍会在 iframe 内导航 → 废弃
- v3：前端 HMAC 签名 + nonce → 前后端密钥不同（nonce vs signSecret）、验签 100% 失败；自测假阳性 → 废弃
- v4：v3 基础上修 `redirect_uri` 回跳 → 身份架构仍错 → 废弃
- **v5（当前终版，17427B/13681B）**：回到"服务端持 Cookie 问 Halo"正解，用原生 http.request 显式设 Host（实测可行）；前端零签名纯同源请求。roles 对象数组正确解析。真实链路 **18/18** 通过（13 基础 + 5 条失败回滚），DeepSeek API 实测可用。2026-11-26 增补 C1（AI 失败退配额）+ C4（前端文案）+ 移除 header"返回博客"链接，已部署实机验证。
