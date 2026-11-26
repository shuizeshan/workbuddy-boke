# 飞牛NAS建站项目计划书

> **最后更新**：2026-11-25 16:45（内网登录态跨域问题**真正根治**——gzip 致 sub_filter 假阳性，见 H 节；G 节的 iframe 修复曾被证伪，以此节为准）

---

## 🛑 Phase 7 弯路总复盘（2026-11-25 · 必读，防止重走旧路）

> 本机器人模块从设计到部署走了大量弯路，根因是**架构方案反复推翻 + 部署链路脆弱 + 验证不充分**。以下按时间线归档每条歧路、根因、正解与铁律。后续任何维护先读本节。

### A. 架构方案层的弯路（v1→v5，四次推翻）

| 版本 | 曾经的做法 | 为什么错（根因） | 正解（v5 现状） |
|---|---|---|---|
| v1 | Node 服务端用 `fetch` 带浏览器 Cookie 调 Halo `users/-` 判身份 | Node 的 `fetch` 会**强制把 Host 头改写成 `127.0.0.1`**，而 Halo 会话 Cookie 按域名绑定 → 服务端永远拿到 anonymousUser → "已登录却显示未登录" | 后端改用**原生 `http.request` 显式设 Host + 透传 Cookie**，让 Halo 亲自判身份 |
| v2 | iframe 内登录链接 `href="/console/login" target="_top"` | 仍在 iframe 内被导航，已登录时 Halo 自动跳 console → iframe 里显示后台 404 | 用 `window.top.location.href` 跳出 iframe + `/login?redirect_uri=相对路径` 回跳 |
| v3 | 前端在同源问 Halo 身份后，用 WebCrypto **HMAC-SHA256 签名**（nonce + name + roles）传后端验签 | 前端用 `nonce` 当密钥、后端用 `signSecret` 验签，**两把密钥不同 → 验签 100% 失败**；且纯前端无法安全持有密钥（F12 可见），此方案原理上不成立。自测还是**假阳性**（测试脚本模拟前端时误用了后端密钥） | 彻底删除 HMAC/nonce，前端零签名，只做同源 `/bot-api/*` 请求 |
| v4 | v3 基础上修 `redirect_uri` 回跳参数 | 身份架构仍错（HMAC），只是修了登录跳转这一个症状 | 保留 redirect_uri 修正，身份架构推倒重来 |
| v5 ✅ | 后端 `http.request` 显式 Host + Cookie 问 Halo；前端零签名 | — | 当前终版。roles 按 `r.metadata.name` 解析（Halo roles 是对象数组 `[{metadata:{name:'super-role'}}]`，早期用 `.includes('super-role')` 当字符串数组判断 → 管理员被误判普通用户） |

**架构层铁律**：
1. 跨服务认证**不要依赖 `fetch` 透传 Host**，用 `http.request` 显式设 Host；让持有会话的一方（浏览器）直接问身份服务最可靠。
2. 纯前端**永远不能安全持有密钥**，凡"前端签名 + 后端验签"方案一律不成立，别再尝试。
3. Halo 2.20+ 登录回跳只认 `redirect_uri`（不是 `redirect`），且用相对 pathname。
4. 解析 Halo roles 必须先取 `r.metadata.name`。
5. 自测必须**模拟真实前后端分离**（前端侧不得复用后端密钥），否则假阳性。

### B. 前端部署链路的弯路（iframe 时代 → nginx 静态托管）

| 阶段 | 做法 | 坑 | 正解 |
|---|---|---|---|
| 旧 | Halo 后台新建页面（别名 bot）+ 源码模式粘 iframe + `?v=N` 破缓存 | 三层任一出错就 404/旧页面：Halo 没建页 → `No static resource bot.`；iframe 缓存 → 改了不生效；`?v` 忘记递增 → 看到旧版。用户在此反复卡了多轮 | **nginx 直接静态托管 `/bot`**，与 Halo 页面体系彻底解耦。无需建页、无需 iframe、无需破缓存、无需重启 Halo |
| 过渡 | nginx `location = /bot` + `alias` 到文件，另配 `location = /bot/` | `/bot` 被 nginx 自动补斜杠 → 301；`/bot/` 的 alias 拼出 `api-bot.htmlindex.html` → 500 | 用 `rewrite ^ /bot.html last` 把 `/bot`、`/bot/` 统一导向一个 `location = /bot.html` 再 alias，三种写法全 200 |

**部署链路铁律**：
1. 机器人页面走 nginx 静态托管，**与 Halo 页面无关**，别再回退到 iframe 方案。
2. `alias` 到单文件时，避免同时给 `/x` 和 `/x/` 各配 alias（slash 歧义），统一 rewrite 到一个内部路径。

### C. 部署操作层的弯路（scp / mv / cp / 目录）

| 现象 | 根因 | 正解 |
|---|---|---|
| heredoc 粘贴长命令被截断，终端卡在 `>` | 长文本/中文粘贴易截断 | 禁止长 heredoc，改「本地文件 + scp 上传 + move 落位」三段式 |
| Windows cmd 跑 `sudo`、SSH 窗口跑 `scp` | 混淆两个窗口 | cmd 提示符 `C:\>` 只跑 scp；SSH 提示符 `<用户名>@<NAS主机名>:/$` 只跑 sudo/mv/docker |
| `sudo mv /tmp/x /vol1/bot/x` 后用 `cp /tmp/x /vol1/bot/x` 报 `No such file` | **mv 是移动不是复制**，`/tmp` 源文件已被移走 | 命令顺序固定：先 scp 到 `/tmp`，再 cp（不是 mv）到目标，最后 `wc -c` 验收 |
| `/bot` 持续 403，`cp` 后 `wc -c` 显示 0 且提示 `Is a directory` | **Docker 卷挂载时源路径不存在 → 自动建成目录**；后续 cp 把文件塞进目录内部（`api-bot.html/api-bot.html`），nginx alias 指向目录 → `directory index ... is forbidden` → 403，并触发 301 补斜杠 | 落位前先 `stat -c %F` 确认目标类型；若已被建成目录先 `rm -rf` 再 cp；cp 后必须 `stat -c %F` 显示 `regular file` 且字节数正确。此前猜"权限 600"是错的，实测目录权限 644 |
| `sudo cd` 报 `command not found` | cd 是 shell 内建命令，sudo 不能直接执行 | 用 `sudo -S bash -c 'cd /dir && cmd'` 或 `docker compose -f 绝对路径` |
| AI 自动 SSH 时 `pexpect.spawn` 报 `AttributeError` | Windows 下 pexpect 不支持 spawn | 用 **paramiko**（纯 Python 跨平台 SSH），密码走环境变量不落盘 |

**操作层铁律**：
1. 先 scp → 再 cp（非 mv）→ `wc -c` + `stat -c %F` 双重验收 → 最后 force-recreate。
2. bind mount 单文件前，宿主路径必须是普通文件；一旦被建成目录，cp 只会往里塞文件。
3. 自动化 SSH 用 paramiko，临时脚本用完即删（含密码调用痕迹）。

### D. 验证层的弯路

| 曾经的问题 | 教训 | 现在做法 |
|---|---|---|
| `_selftest_v3.js` 12/12 "通过"却是假阳性 | 测试模拟前端时复用了后端密钥，掩盖了真实的前端密钥错位 | 自测必须前后端分离模拟 |
| 改完只跑一次 curl 就宣称"跑通" | 单轮不能证明稳定，且没覆盖鉴权/兼容性 | **多轮独立验证**：nginx -t 语法、容器状态、3 轮间隔 HTTP（/bot、/bot/、/bot.html、health、首页）、鉴权拒绝路径（无 Cookie/假 Cookie/chat 401）、前端内容一致性（三次抓取字节数 + 关键字符串）、反代透明性（首页/后台/旧AI分身）、近期日志无 error |
| 未登录态误判 | 前端只 `if(!d.loggedIn)`，把 404 JSON 的 `undefined.loggedIn` 当未登录 | 前端 `refresh()` 先判 `r.ok`（非2xx 抛"接口不可达/请切18080"），再校验 `typeof d.loggedIn==='boolean'`（否则抛"状态响应异常"） |

**未覆盖的验证（如实记录，不宣称已通过）**：管理员真实登录态（不限次连聊）尚未自动化验证——Halo 登录页用 CSRF token + jsencrypt RSA 加密密码，纯 curl 无法模拟，需浏览器交互。此项归入外网验证环节，由用户在浏览器完成。

### E. 弯路代价与本轮成果

- **耗时**：Phase 7 从 2026-11-24 设计至今（2026-11-25）跨 2 天，架构推翻 4 次、部署返工多轮。
- **本轮（2026-11-25）成果**：架构级根治（nginx 静态托管 + rewrite 解耦 Halo）、403 真根因（目录冲突）定位并自动修复、**多轮验证全通过**（见 D 节）、弯路全面归档（本节）。
- **当前状态（2026-11-25 15:30 更新）**：外网问题也已解决，花生壳映射**无需改动**，详见新增 F 节。

### F. 2026-11-25 下午续：DeepSeek 回答敷衍 + 外网 404 的终极排查（本轮）

| 用户现象 | 真根因（实测，非猜测） | 正解 |
|---|---|---|
| `/bot/` 能聊但回答敷衍："我是博客助手，不方便编造，不知道" —— 用户以为没连 DeepSeek | **DeepSeek 其实完全连通**：容器内 Node 直连 API `HTTP=200`、回复"连接成功"。敷衍是 `SYSTEM_PROMPT` 太保守（"不编造事实，不知道就说不知道"）+ **新提示词多行写入 `.env` 污染了文件**：第 2 行起被 compose 当成新变量，报 `unexpected character "【" in variable name`，导致 `force-recreate` 根本没执行，容器一直用旧提示词 | ① 提示词压成**单行**重写 `.env`（从备份取回 KEY/MODEL/PAT 原值）；② `docker compose config -q` 校验通过再重建；③ 实测三问全对："你是什么模型"→明确答 deepseek-flash、"你好啊"→自然打招呼、"博客是做什么的"→准确说主题 |
| 博客页/外网机器人报"HTTP 404 接口不可达" | 花生壳映射是**云端规则**（日志铁证 `<你的壳域名>:443(127.0.0.1:28090)`），本地 `phtunnel.json` 改不了；本地 RPC 16062 返回 `unknow service`。之前计划"切映射到 18080"需网页操作 | **不碰花生壳**：在 NAS 本地把 28090 变成智能分流入口——Halo 从 `28090:8090` 重建为 `28091:8090`（数据卷 `/var/apps/docker-halo/var/halo2` 原样挂载，数据零丢失），bot-nginx 同时 `listen 28090` 和 `18080`，`/bot*`、`/bot-api*` 走机器人，其余转发 Halo(28091)。花生壳仍指 28090 → 外网直接生效 |

**本轮铁律**：
1. 判断"AI 没连上"必须**先直连上游 API 实测**（容器内 Node/curl 打 `chat/completions`），不要看回答风格就下结论——提示词保守会伪装成"没连上"。
2. `.env` 里 `SYSTEM_PROMPT` **必须单行**，不能含换行；多行会被 compose 解析成新变量并报 `unexpected character`。改完必须 `docker compose config -q` 校验 + 确认容器 `Recreated`（不是 `Running`）+ `printenv SYSTEM_PROMPT` 读到新值。
3. 改 `/vol1/bot/.env` 前**先备份**（`cp .env .env.bak_$(date +%s)`），密钥从备份原值取回，不要重打。
4. 花生壳映射是云端配置，本地 SSH 改不了；但**不必改**——把映射指向的那个端口（28090）在本机改成智能分流网关即可，博客与机器人共用同一域名和入口。
5. 重建 Halo 前必须备份数据卷（本轮 `tar czf halo2-backup-before-reroute.tar.gz`，21M）+ 导出 `docker inspect halo > halo-inspect-before.json` 供回滚；用 inspect JSON 解析出精确参数重建（含 `-e JVM_OPTS`、数据卷、网络 `trim-default`），容器名保持 `halo` 不变。

**本轮验证（多轮，非单轮）**：
- 外网域名三轮：`/bot-api/health` 全 200+v5、`/bot` 200、首页 200
- 内网 28090/18080 双入口三轮：`/bot`=200、首页=200、health 全 v5
- 鉴权：无 Cookie status → `loggedIn:false`，无 Cookie chat → 401
- 博客原页面：`/`、`/archives`、`/about`、`/ai` 全 200
- 前端完整性：关键标记 12 处、密钥泄露 0；nginx 日志无 error
- 容器：halo / bot-api / bot-nginx / halodb 全 Up

**回滚方案**（万一需恢复旧架构）：
```
docker stop halo && docker rm halo
# 用 halo-inspect-before.json 原参数重建回 28090:8090
# bot-nginx 换回旧 nginx.conf（只 listen 18080，location / 转发 28090）
# 数据卷若需还原：tar xzf /vol1/bot/halo2-backup-before-reroute.tar.gz -C /var/apps/docker-halo/var
```

### G. 2026-11-25 傍晚续：内网点登录没反应 + 评论后额度仍为 0（本轮）

| 用户现象 | 真根因（SSH 实测，非猜测） | 正解 |
|---|---|---|
| 内网 `<NAS_IP>:28090/ai` 里机器人"点登录没反应"，或"登录后仍显示需登录" | `/ai` 页面正文里的 iframe src **写死外网绝对域名** `https://<你的壳域名>/themes/.../api-bot.html?v=8`（curl 页面 HTML 铁证）。内网访问时 iframe 从外网域名加载 → ① 旧 `goLogin()` 读跨域 `window.top.location.pathname` 抛异常 → 跳转失效；② iframe 内 `/bot-api/*` 请求带到的是**外网域名的 Cookie**，与内网登录态不通 → 后端问 Halo 仍是 anonymousUser | ① nginx `location /` 加 `sub_filter 'https://<你的壳域名>/' '/'`（带 `--with-http_sub_module`）+ `sub_filter_once off` + `sub_filter_types application/json`，把 Halo 返回 HTML 里的外网绝对域名替换为相对路径 → iframe 永远**与当前访问域名同源**，内外网各用各的 Cookie；② 前端 `goLogin()` 改用 `window.top.location.origin + pathname` 并 try/catch 包住跨域访问。⚠️ **注：此处的"实测生效"后被证伪是 curl 假阳性（gzip），真正修复见 H 节** |
| 外网测试号（用户 `<测试用户名>`）评论并审核通过后，刷新次数仍为 0 | Halo 2.27.3 控制台评论 API 返回结构是 `items[i].comment.spec.owner.name` 和 `items[i].comment.metadata.name`（**多套了一层 `comment`**）。旧 `server.js` 的 `commentAuthorName()` 读 `c.spec.owner`、`comments` 循环读 `c.metadata.name` → 全是 `undefined`，作者永远匹配不上用户名 → 额度永不 +1。"刷新无效"是同一 bug：刷新触发的 syncQuota 也读空 | `server.js` 新增 `asComment(item)`（有 `item.comment` 就取内层，兼容两种结构），`commentAuthorName()` / 新增 `commentId()` 都基于 `asComment()`；兑换只认 `spec.approved === true` 的评论（防刷）。实测：真实 API 1 条评论 → 识别作者 `<测试用户名>`、ID `51cd8971-...`、approved=true；执行 syncQuota 后账本 remaining **0→1**，claimedComments 记录该 ID 去重 |

**本轮铁律（新增，务必遵守）**：
1. **iframe 绝对域名是跨域登录杀手**：主题/页面里写死 `https://域名/...` 的 iframe，内网访问必跨域。统一用 nginx `sub_filter` 把绝对域名替换成 `/` 相对路径，让 iframe 跟随当前域名同源。**内外网 Cookie 不通用**（内网 IP 登录态 ≠ 花生壳域名登录态），必须同源。
2. `sub_filter` 需要 nginx 编译带 `--with-http_sub_module`（本项目 bot-nginx 官方镜像已带）；`text/html` 是默认类型不要再写进 `sub_filter_types`（否则 warning），只需额外写 `application/json`。
3. **解析 Halo API 必须先实测返回 JSON 结构**，别照文档猜版本差异：评论在 `console.halo.run/v1alpha1/comments` 下是 `[{comment:{metadata,spec:{owner,approved}}}]`，套了一层 `comment`。写解析时做兼容（有内层取内层，无内层取自身），并过滤 `approved===true`。
4. 额度兑换类 bug 要**直接读账本**验证：`/app/data/ledger.json` 的 `remaining` 与 `claimedComments` 是唯一真相；前端"刷新无效"先看后端账本有没有变，别只盯 UI。
5. 报"登录后仍显示未登录"时，先 `curl /ai` 看 iframe src 是不是绝对域名、再 curl `/bot-api/status`（无 Cookie 应 `loggedIn:false`），把"跨域 Cookie 问题"与"后端鉴权问题"分开。

**本轮验证（多轮）**：
- iframe 同源：内外网 `/ai` 的 iframe src 均为相对路径 `/themes/...`（替换生效）
- 评论兑换：真实 API 数据识别 <测试用户名> 的已审核评论 1 条 → 账本 remaining 0→1、claimedComments 记录 ID（去重）
- 三轮双入口+外网：内网 health v5 /bot=200 首页=200，外网 health v5 /bot=200，全通过
- 容器：bot-nginx / bot-api / halo / halodb 全 Up；nginx 无 error
- 服务端新代码确认加载：`grep -c asComment /app/server.js` = 4（修复版在运行）

**备份**：修改前已备份 `/vol1/bot/{server.js,api-bot.html,nginx.conf}.bak_fix`，可一键回滚。

**仍未覆盖（如实记录）**：管理员真实登录连聊（Halo 登录用 jsencrypt RSA 加密密码 + CSRF，纯 curl 无法模拟，需浏览器交互）。此项归外网浏览器验证。

---

### H. 2026-11-25 傍晚续 2：内网登录态问题的**真正根因**——gzip 导致 sub_filter 假阳性（最高价值坑）

> **重要：本节推翻并修正 G 节关于 iframe 修复"已生效"的结论。** G 节用 curl 验证 iframe src 变相对路径，是**假阳性**；真实浏览器里 iframe 仍是外网绝对域名。本轮用 Playwright 真实浏览器才定位到真凶。

| 项 | 内容 |
|---|---|
| 用户现象 | 内网 `<NAS_IP>:28090/ai` 里：①已登录（Halo 前台显示管理员）但机器人仍显示"未登录/请先登录"、无法聊天；②未登录时点机器人里的"登录/注册"按钮**没有任何反应**。外网一切正常。 |
| 上一轮（G 节）误判 | 以为加 `sub_filter` 把 iframe 绝对域名替换成相对路径就解决了，curl 验证 `/ai` 的 src 确实变成 `src="/themes/..."` → 误判已修复 |
| **真根因（Playwright 真实浏览器铁证）** | ① 用浏览器真实登录内网 `<你的管理员账号>`，Cookie `SESSION` domain=`<NAS_IP>` 正常；② 浏览器里直接 `fetch('/bot-api/status')` 返回 **`loggedIn:true, admin:true`** → **后端鉴权完全正常，不是鉴权 bug**；③ 但 `/ai` 页面 iframe 的真实 src 是 **`https://<你的壳域名>/themes/...api-bot.html?v=8`（外网绝对域名，跨域）** → iframe 内请求带外网域名的 Cookie，读不到内网登录态 → 显示未登录；④ "点登录没反应"同源：iframe 跨域 → `window.top.location` 抛异常 → catch 里跳外网域名登录页，用户感知为"没反应" |
| **为什么 sub_filter 在浏览器里失效（关键！）** | Halo 对 `/ai` 返回响应头 **`content-encoding: gzip`**。nginx 的 `sub_filter` **无法处理 gzip 压缩流**，所以替换从未在真实请求中生效。curl 验证时默认**不带** `Accept-Encoding`，Halo 返回未压缩内容 → sub_filter 生效 → 看到相对路径 = **假阳性**。带 `Accept-Encoding: gzip` 复现了失败：`src` 仍是外网绝对域名 |
| **正解（已实施并验证）** | 在 `location /` 里加 `proxy_set_header Accept-Encoding "";`（强制 Halo 返回未压缩内容），并把 `sub_filter_types` 保持为 `application/json`（`text/html` 是 sub_filter 默认类型，勿重复写否则 warning）。这样真实浏览器也拿到被替换后的相对路径，iframe 同源。前端代码**一行没改**（无需改 goLogin，跨域根源消除后原有 try/catch 跳转逻辑自然正常） |

**本轮铁律（新增，最高优先级）**：
1. **验证 sub_filter / 任何响应体替换，必须带浏览器真实请求头（`Accept-Encoding: gzip, deflate`），否则 curl 的"成功"是假阳性。** 这是本阶段反复"以为修好了其实没修好"的总根源。
2. **验证登录态/跨域问题，必须用真实浏览器（Playwright）**，不要只用 curl。curl 无法体现 iframe 的 origin、Cookie 域名隔离、跨域 JS 异常。本项目已验证 Playwright + chromium 可用（本地 `C:\Users\Administrator\AppData\Local\ms-playwright\chromium-1255`）。
3. **先分清"后端鉴权"与"前端跨域"**：浏览器里直接 fetch `/bot-api/status` 若返回 `loggedIn:true` 而 iframe 内显示未登录 → 100% 是 iframe 跨域带错 Cookie，不是鉴权 bug，别再改 server.js。
4. nginx 反代做响应体修改时，凡上游可能 gzip，一律先 `proxy_set_header Accept-Encoding "";` 关闭压缩。
5. iframe 内"点登录没反应"优先怀疑跨域：`window.top.location` 在跨域 iframe 中会抛安全异常。修同源是根治，改 JS 只是缓解。

**本轮验证（Playwright 真实浏览器，3 轮，非 curl）**：
- 内网登录→`/ai`：iframe src = `http://<NAS_IP>:28090/themes/...api-bot.html?v=8`（**同源**），badge=**管理员·不限次数**，无门页 ✅
- 外网登录→`/ai`：iframe src = `https://<你的壳域名>/themes/...`（**同源**），badge=管理员·不限次数 ✅（外网零影响）
- 登录按钮：内外网未登录点"前往登录/注册"均正确跳出 iframe → 顶层 `/login?redirect_uri=%2Fai` ✅
- 3 轮稳定性：内外网 6 次全部"同源=True + 管理员·不限次数" ✅
- curl 带 gzip 复验：`src="/themes/..."`，响应头无 `content-encoding` ✅
- health v5、/bot=200、首页=200、四容器 Up ✅

**备份**：nginx.conf 修改前备份为 `/vol1/bot/nginx.conf.bak_gzip_<timestamp>`，可一键回滚。

**结论**：管理员真实登录连聊已用 Playwright 完成浏览器验证（此前 curl 无法模拟的项，本轮已覆盖）。内网登录态问题**彻底根治**，外网零影响。

---

> **当前阶段**：Phase 7 鉴权机器人——⚠️ **v3/v4 的 HMAC 身份方案根本不成立（前/后端密钥不同，验签必失败），已废弃；v5 彻底重做**：改回"后端用原生 http.request 显式设 Host + 透传 Cookie 问 Halo 身份"，前端去掉所有签名/nonce。本地**真实链路 18/18 通过**（13 基础 + 5 条 AI 失败回滚；含 Host/Cookie 透传、对象数组 roles 解析、管理员不限、配额扣减）。DeepSeek API 也已实测可用（deepseek-flash 返回正常中文）。**v5+C1 已部署完成，内外网均可用**。
> **状态更新（2026-11-25 15:30，16:45 最终确认）——内外网全部打通，无需再切花生壳映射**：本地把 28090 改造成智能分流入口（Halo 挪到内部 28091，bot-nginx 同时监听 28090+18080 按路径分流）。外网 `https://<你的壳域名>/bot` 与 `/bot-api/health` 实测全 200+v5，博客首页/归档/关于/旧AI分身全 200。**管理员登录态已用 Playwright 真实浏览器 3 轮验证通过（含内网 iframe 同源 + 徽标识别），全部完成，无剩余项**。
> **历史步骤存档（已完成，勿再执行）**：① 曾需切花生壳映射 28090→18080——**此方案已作废**，改用本地 28090 分流，花生壳任何设置都不用动。② 曾需上传三件套并 force-recreate；踩坑"文件被建成目录致 403"已自动修复。③ `.env` 的 SYSTEM_PROMPT 多行污染致容器没重建，已改单行+compose校验+实测三问（详见弯路复盘 F 节）。**`/bot` 由 nginx 静态托管 + rewrite，`/bot-api` 走本地分流，404/403/301 全部根除**
> **✅ 访问方式（最新）**：内外网统一入口——外网 `https://<你的壳域名>/bot`，内网 `http://<NAS_IP>:28090/bot`（或 18080 备用）。28090 现由 bot-nginx 分流：`/bot*` `/bot-api*` 给机器人，其余给 Halo(28091)。内网 IP 与花生壳域名是两套独立登录态，须在**同一域名**下登录。Halo 已运行于 28091（数据卷不变），勿再手动启停旧 28090 实例。
> **教程素材**：`TUTORIAL.md`（全流程图文教程稿 + 小红书发布方案）——**此后每完成一个步骤，必须同步补进 TUTORIAL.md，粒度到「做什么/为什么/命令/成功标志/踩坑/截图点」**

---

## 一、最终目标

用公司里的飞牛NAS（<NAS_IP>:5666）做服务器，搭建一个**可外网访问的「博客 + 工具站」**：
- 博客：可视化后台写文章、发作品
- 工具：挂自己做的实用小工具（后续细化）
- 外网访问：内网穿透方案（无公网IP）
- 分两步走：前期免域名跑通 → 后期买域名正式化

## 二、需求结论（2026-11-20 咨询确认）

| 问题 | 结论 |
|---|---|
| 网站定位 | 博客 + 工具都要 |
| 外网访问 | 内网穿透（无公网IP，NAS在公司） |
| 域名 | 前期免域名，后期再买 |
| 技术路线 | 可视化后台，零代码 |

**特殊约束：NAS 在公司网络**
- 穿透只允许「出站连接」方案（公司防火墙一般不拦出站）
- 不穿透暴露 NAS 管理后台等敏感端口
- 注意公司 IT 合规，避免被 IT 部门拦截

## 三、技术栈与架构

| 层 | 选型 | 说明 |
|---|---|---|
| 硬件/系统 | 飞牛OS (fnOS, Debian底) | Docker 支持 |
| 博客系统 | **Halo**（Docker 部署） | 国产开源、中文后台、零代码运营 |
| 工具模块 | 待定（倾向：单文件HTML工具集，挂博客页面/独立容器） | Phase 3 再定 |
| 内网穿透（前期） | **花生壳免费版**（送二级域名，国内速度快） | 免域名起步 |
| 内网穿透（后期） | **Cloudflare Tunnel**（免费、稳定，需域名托管CF） | 买域名后切换 |
| 反代 | 待定（Nginx Proxy Manager 或 fnOS自带） | Phase 1 顺手装 |
| 运维面板 | fnOS 直管为主；**1Panel 列为 Phase 4 备选**（只做反代/证书/备份，不迁数据） | 避免双头管理Docker |

**穿透原理**：NAS 主动向外连接中转服务器（出站），外网用户访问中转服务器 → 转发回 NAS。不需要公网IP、不需要在路由器开端口。

## 四、里程碑

- [x] Phase 0.1 需求咨询确认（2026-11-20）
- [x] **Phase 0 环境摸底**（2026-11-20 完成；**硬件信息 2026-11-23 以实测截图更正**）
  - fnOS 1.2.1010，设备名 <NAS主机名>
  - Docker 已安装、服务已开启（存储位置=空间1），无容器
  - 存储空间1：411GB 总量，已用 11%（45.65GB）——充裕
  - ~~硬件：Pentium Gold 8500 + 32GB~~ → **实测：Pentium Gold 6500Y @1.10GHz（2核4线程）+ 16GB 内存（已用4GB/可用11.5GB）+ UHD Graphics 615**
  - 本机 → NAS 连通性：后台 5666 HTTP 200 ✅；SSH 22 端口开启 ✅
- [x] **Phase 1 内网跑通博客**（2026-11-20 完成）
  - Halo 初始化完成，管理员账号已建，第一篇文章已发布（文章数=1）
  - 助手实测：前台 HTTP 200，站点标题「水泽山」，后台 /console 正常
  - 内网访问：前台 `http://<NAS_IP>:28090`，后台 `/console`
- [x] **Phase 2 外网上线**（2026-11-20 基本完成，待手机流量终验）
  - 花生壳 fnOS会员版（试用7天：15Mbps/500GB月，到期回落1Mbps/1GB）
  - 映射：HTTPS `<你的壳域名>` → `127.0.0.1:28090`（Halo），15Mbps
  - 助手复验：外网 curl 200，标题「水泽山」，《Hello Halo》可见，fnOS后台不再暴露 ✅
  - 待办：手机流量终验；试用期（约2026-11-27）结束前决定是否保留免费版或转其他方案
- [ ] **Phase 2.5 安全加固**（并行收尾中）
  - 🔴 必做：fnOS 管理后台强密码 + 两步验证（安全中心）；SSH 用完关闭；博客数据定期备份
  - 🟡 建议：安全中心跑一次安全诊断；开启异常登录通知；Halo 保持升级
  - ⚪ 可选：花生壳映射加访问策略（博客公开故不加）
- [ ] **Phase 2.6 博客打磨** ← 当前（2026-11-21）
  - ✅ Halo 2.27.3 + 定制主题 theme-luye（「绿野」风格，含天气切换/hero横幅/数据徽章）
  - ✅ 身份文案全套改为「数字化管理师 DIGITAL MANAGEMENT SPECIALIST」（5处，已验证生效）
  - ✅ 强调色改为淡蓝 `#7EC8E3`（后台主题设置直接改，已生效）
  - ✅ Hero 横幅图：AI 生成吉卜力风两张（山水/海边公路），规格 3:1~3.55:1、≤500KB
  - 🔄 **搜索功能（进行中）**：已装官方「搜索组件」插件 v1.8.0（弹框式）；主题设置「搜索页链接」填 `/search` 后导航栏出现图标 ✅；点击 404（主题缺 search.html 模板）→ 修复命令已存 `deploy/theme-customize-commands.md` 第二节，待 SSH 执行
  - ⬜ 待确认：Halo「外部访问地址」是否已设为壳域名；手机流量终验
- [ ] **Phase 3 工具模块**：确定工具清单（哪些工具、给谁用）→ 实现 → 挂到博客
- [ ] **Phase 3.5 本地大模型 + 博客对话** ← 当前（阶段A进行中，2026-11-23 启动）
  - 方案文档：`PLAN-LLM.md`（已拍板：①仅内网自用 ②Qwen3 1.7B 起步实测；16GB 内存下 4B 不推荐）
  - 架构：Ollama + Open WebUI `main-slim`，1Panel 自定义编排部署（勿用商店一键装），mem_limit 合计 5GB，cpus≤3
  - ✅ 基线测量完成（2026-11-23）：`deploy/ai-baseline.md`（内存可用11G、Swap 0、4逻辑核、Halo 704MiB）
  - 编排文件已备好：`deploy/ai-compose.yml`（Ollama 4G/2核 + WebUI 1G，数据在 /vol1/ai/）
  - 进度：✅阶段A部署+测速11.51tok/s（2026-11-23）→ ✅阶段B知识库验收通过（模型预设「qwen3:1.7b中文」：禁函数调用/禁搜索//no_think/温度0.6/max_tokens512/模型级挂载知识库/内置工具全关）→ ✅阶段C-1聊天页已部署（2026-11-23 18:37 内外网均 200 text/html 4902B：`/themes/theme-luye/assets/chat.html`）→ 🔄阶段C-2 Halo 页面接入（做好不上线）
  - 踩坑补充（2026-11-23）：①main-slim镜像无本地向量库→换main完整版 ②HuggingFace直连不通→HF_ENDPOINT=https://hf-mirror.com ③1.7B工具调用幻觉严重→禁用全部工具/能力/内置工具+Function Calling关闭 ④旧对话不继承新预设配置→必须新开对话测试 ⑤**主题静态资源必须放 `templates/assets/`**（放主题根目录 `assets/` 永远 404）⑥超长 heredoc 粘贴会被截断卡在 `>` 提示符 → 改「本地文件 + scp 上传 + cp 到目录」三段式，禁止再贴长文本部署
- [ ] **Phase 4 正式化（延后，触发条件：博客用熟 / 免费版不够用）**：买域名（阿里云/腾讯云）→ Cloudflare Tunnel → 摆脱1GB月限制（届时一并解锁公网 AI 对话）
- [x] **Phase 7 鉴权配额版 AI 机器人（2026-11-24 起，2026-11-25 16:45 全部完成 ✅）**
  - 需求（用户确认）：未登录不能聊；超级管理员无限；普通用户登录送1次；发布文章审核通过 +1、评论 +1（各去重）；DeepSeek Key 后台统一配置
  - 架构（**已演进为最终版，以下为历史初始方案**）：初始为 `花生壳 → nginx(18080) → [/bot-api/→Node代理3001, /→Halo28090]`；**最终架构**：花生壳映射保持 28090 不动 → bot-nginx 在 28090/18080 按路径分流（`/bot*`/`/bot-api*`→机器人，`/`→Halo 内部 28091），`/bot` 由 nginx 静态托管。详见 Phase 7 复盘 F/H 节。
  - 关键决策依据（实地验证 Halo 2.27.3 API）：`users/-` 匿名返回 anonymousUser、登录带角色可判管理员；公开 posts 接口含 contributors.name 可判已发布文章；评论须管理端接口+PAT；Halo 无通用路径反代→必须加 nginx
  - 交付文件：`PLAN-BOT.md`（历史方案）、`deploy/bot/{server.js,api-bot.html,nginx.conf,docker-compose.yml,.env.example,DEPLOY.md,_selftest_v5.js}`（v5 当前有效）。旧 `_selftest.js`/`_selftest_v3.js` 已归档于 `_archive/（本地备份，不上传）/旧自测脚本/`
  - 验证：`node _selftest_v5.js` **18/18 全通过**（13 基础 + 5 条 AI 失败回滚；Host/Cookie 透传、对象数组 roles 解析、管理员不限、配额扣减等）；Playwright 真实浏览器内外网 3 轮验证通过；v5 全链路功能完好
  - DeepSeek Key + Halo PAT：已由用户填入 NAS 的 `.env`（不经过对话）
  - 状态：**✅ 全部完成**（阶段1部署 → v5 重构 → 28090 智能分流 → 内外网验证通过，花生壳映射无需改动）
  - 2026-11-26 阶段 c 增补：**C1 AI 调用失败退还配额**（原先扣后调，502/429/超时会白扣次数；现失败时在锁内回滚并回写账本）+ **C4 前端过期文案**（去掉"切18080/改映射"，502 退还回显）；已 NAS 部署并内外网实测通过。账本备份：`/vol1/bot/data/ledger.json.bak_20261126`。详见 `_archive/（本地备份，不上传）/清理清单.md` 第六节。
  - **v3 彻底重构（2026-11-24 15:55，根治"反复改"）**：阶段2暴露 3 个根因，一次性重构：
    - **根因1 外网/bot-api 404**：花生壳映射仍指 28090（Halo原生），`/bot-api` 只挂在 nginx 18080。→ 必须切映射到 18080（提前到阶段2末）
    - **根因2 iframe 内跳登录进 Halo 后台**：旧登录链接 `href="/console/login" target="_top"` 在 iframe 内被导航，已登录时 Halo 自动跳 console → iframe 里显示后台404页。→ 改用 `window.top.location.href = origin+'/login?redirect_uri='+相对pathname`，用 location.origin 动态拼地址（避免写死公网域名），登录页绝不在 iframe 内显示
    - **根因4（16:24 实测新增）登录后跳个人中心而非回 /ai**：Halo 2.20+ 官方把登录回跳参数从 `redirect` 改为 **`redirect_uri`**（2026-11-24 查 Halo 2.20.2 发布公告确认），旧参数名被静默忽略 → 登录后走默认跳转进个人中心 `/user`。且回跳值传完整URL+评论组件hash也会干扰路由。→ 参数名改 `redirect_uri`、回跳值改 `window.top.location.pathname` 相对路径（去掉hash）。**铁律：Halo 2.20+ 登录回跳只认 redirect_uri**
    - **根因3 已登录却显示未登录（最深）**：Node 服务端转发 Cookie 调 Halo 时，Node fetch **强制把 Host 头改写成 `127.0.0.1`**（实测证实），而 Halo 会话 Cookie 按域名绑定 → 服务端永远拿到 anonymousUser。→ **架构改为前端在同源直接问 Halo `users/-`（浏览器自动带正确 Cookie/Host，100%可靠），拿身份后用 WebCrypto HMAC-SHA256 签名（nonce+name+roles），服务端只验签不信任明文**。nonce 5分钟有效防重放，签名密钥 `BOT_SIGN_SECRET` 仅服务端持有
    - **附带修复**：新用户首次额度落盘（原来只在有文章/评论兑换时才写盘，服务重启会丢失"送1次"）
    - **防缓存**：iframe src 用 URL query 版本号 `?v=N`，每次部署前端递增；旧问题"改了没生效"多为浏览器缓存
  - **v3 验证**：`_selftest_v3.js` 全链路 12/12 通过（**后证实为假阳性**：测试脚本模拟前端时用了与后端相同的 signSecret，而真实前端用的是 nonce 当密钥 → 实际 100% 验签失败）
  - **v5 彻底重做（2026-11-24 20:05，终版）**：复核发现 v3/v4 身份架构根本不成立 + 管理员误判两个致命 bug，全部推倒重来：
    - **致命BUG-1 HMAC 密钥错位**：前端 `crypto.subtle.importKey(nonce)` 用 nonce 当签名密钥，后端 `createHmac(signSecret)` 用另一把密钥 → 验签 100% 失败；且纯前端无法安全持有密钥（F12 可见），此方案原理上不成立。→ **彻底删除 HMAC/nonce**。
    - **致命BUG-2 管理员误判**：Halo `roles` 是对象数组 `[{metadata:{name:'super-role'}}]`，代码用 `.includes('super-role')` 当字符串数组判断 → 管理员被判普通用户。→ 后端取 `r.metadata.name` 后判断。
    - **v5 正解**：后端用**原生 http.request 显式设 Host 头**（本地实测：http.request 能透传自定义 Host+Cookie，fetch 不行——这正是 v1 失败真凶）把浏览器 Cookie 原样转发 Halo `users/-`，让 Halo 亲自判身份；前端只做同源 `/bot-api/*` 请求，浏览器自动带 Cookie，零签名。可信、不可伪造、内外网一致。
    - **验证**：`_selftest_v5.js` 真实启动 server.js 模拟全链路 **13/13 通过**（health v5/无Cookie拒绝/无效Cookie拒绝/普通用户送1次/Host透传/Cookie透传/管理员不限/聊天扣减/用完403/管理员连聊/空消息400/未登录401/账本落盘；此为 2026-11-24 v5 重构当时的节点值，2026-11-26 扩充失败回滚后现为 **18/18**）；前端 8/8 检查通过；**DeepSeek API 独立实测可用**（deepseek-flash+thinking:disabled 返回中文"成功"）。
    - **文件（历史节点值）**：server.js 15336B（ver=v5）、api-bot.html 12552B（无签名）、_selftest_v5.js；上传副本已同步。**最终版字节数见 Phase 7 复盘 H 节：server.js 17427B / api-bot.html 13681B / nginx.conf 4765B**。
  - 部署实测修正（2026-11-24）：① Halo PAT 实际界面权限名是「评论查看」（非文档原写的"评论读取"），且只勾这一项即可（文章用公开接口、身份用访客 Cookie 都不需令牌）；② DeepSeek 官方 2026-07-24 停用 `deepseek-chat`，主模型改名 `deepseek-flash`（即 V4.1-Flash-1017）——server.js/compose/.env.example/DEPLOY.md 全部已改；③ server.js 请求体加 `thinking:{type:'disabled'}` 关闭新模型默认思考模式，避免慢+费token；④ 密钥严禁贴对话/命令行历史，改用「本地记事本模板→scp上传→mv落位」三段式
  - ⚠️ 安全事件：2026-11-24 用户两次将 DeepSeek Key 与 PAT 明文贴入对话，两把均需作废重发；最终 .env 以本地模板填写+scp上传为准

## 五、已完成

- 2026-11-20：需求咨询完成，方案定型；建立本项目计划书（本文件）；Phase 0/1/2 全部跑通
- 2026-11-21：Halo 升级 2.27.3；换用定制主题 theme-luye；身份文案+强调色+横幅图三件视觉定制完成；搜索组件插件装好、导航栏搜索图标已出现（search 页修复待执行）
- 定制命令存档：`deploy/theme-customize-commands.md`（主题升级后按此重跑）

## 六、踩坑记录

| 日期 | 问题 | 原因 | 解决 |
|---|---|---|---|
| 2026-11-20 | 直连 Docker Hub 超时（本机模拟发现） | 国内网络环境 | fnOS 自带镜像代理（registry.tinms.com/haproxy 前缀）自动绕过；备用：docker.m.daocloud.io |
| 2026-11-20 | 部署后 curl 8090 被拒绝（Connection refused） | fnOS 应用中心把对外端口改写为 **28090**（容器内仍是8090） | 接受 fnOS 的 28090 端口，访问地址用 28090；排错方法：容器详情看端口映射行 |
| 2026-11-20 | fnOS花生壳应用默认映射把 fnOS 管理页(5666)暴露到公网 | fnOS 应用自动建映射 | 改指 Halo(28090)，curl 复验确认已修复。**铁律：5666/22等管理端口永不映射** |
| 2026-11-20 | 映射内网地址填 127.0.0.1 也能通 | 花生壳客户端跑在NAS本机，回环直达 | 反而更稳（不依赖局域网IP），无需改 |
| 2026-11-21 | 换主题后前台 500（内网/外网均500，console正常） | 新主题要求更高Halo版本，与2.20不兼容 | 切回默认主题恢复。教训：装主题前看适配版本，装完立刻验证前台 |
| 2026-11-21 | 计划升级 Halo 2.20 → 2.27.3 | 解决主题兼容问题（控制台已提示新版可用） | **✅ 已完成（2026-11-21 13:29）**：fnOS代理无2.27.3→改用daocloud加速源；UI重建始终未生效→改走SSH手办（docker pull + docker run）；实测版本2.27.3、文章完整、外网200 |
| 2026-11-21 | fnOS Compose「保存+重启」不生效 | 项目运行时配置只读；重启≠重建 | 教训：配置变更必须 停止→重建→验证 闭环；SSH的docker pull/run 是可靠兜底手段 |
| 2026-11-21 | 导航栏搜索图标点击 /search 报 404（Template search was not found） | theme-luye 主题缺 `templates/search.html` 模板；搜索组件插件是弹框式、本就不提供搜索页 | 修复：SSH 补建 search.html（打开即自动唤起 SearchWidget 弹框），命令存 `deploy/theme-customize-commands.md` 第二节 |
| 2026-11-23 | 聊天页放 `theme-luye/assets/chat.html`，内外网一直 404，重启容器也无效 | **Halo 主题静态资源只认 `templates/assets/`**（官方目录约定），主题根目录的 assets 不参与路由 | `mv` 到 `templates/assets/` 后立刻 200。排查方法：抓首页引用路径 → 对照官方目录结构 |
| 2026-11-23 | SSH 粘贴超长 heredoc 部署命令，命令被截断，终端卡在 `>` 续行提示符，后续输入全被吞 | 长文本/中文粘贴易截断，shell 进入 heredoc 等待状态 | `Ctrl+C` 退出 → 改「Windows scp 上传 + NAS mv 落位」三段式；**运维铁律：不再用长 heredoc 部署文件** |
| 2026-11-24 | 为鉴权机器人查 Halo 身份/文章/评论接口 | 实地探测确认：`users/-` 匿名返回 anonymousUser（带 Cookie 返真实用户+角色）；公开 posts 含 contributors.name；公开 comments 缺 kind 报 400，须管理端接口+PAT；Halo 无通用路径反代 | 服务端代理+nginx 分流方案定型；身份/配额/密钥全服务端，前端不可伪造 |
| 2026-11-24 | **已登录却提示未登录（反复改三轮的根因）** | Node 的 fetch 转发 Cookie 时**强制把 Host 改写为 `127.0.0.1`**（本地实测证实），Halo 会话 Cookie 按域名绑定 → 服务端永远拿到 anonymousUser | **v3 架构根治**：身份改由前端同源问 Halo（浏览器自带正确 Cookie/Host），HMAC-SHA256 签名后传服务端验签。教训：**跨服务转发带 Cookie 的认证请求不可靠，凡"服务端判身份"优先让浏览器同源问身份再签名** |
| 2026-11-24 | iframe 点登录显示禁止图标 / iframe 里出现 Halo 后台控制台404 | ①Halo登录页带 `X-Frame-Options: SAMEORIGIN` 禁止 iframe 内显示 ②旧链接 `href="/console/login" target="_top"` 被 iframe 内导航，已登录自动跳 console | 登录链接改 `window.top.location.href = location.origin+'/login?redirect_uri='+相对pathname`——既跳出 iframe、又不写死公网域名、还带登录后回跳。**铁律：iframe 内永不承载登录/后台页** |
| 2026-11-24 | 点「前往登录」登录后跳到个人中心 `/user`，不回 `/ai` | **Halo 2.20+ 登录回跳参数名是 `redirect_uri`，不是 `redirect`**（查 2.20.2 发布公告确认；旧参数被静默忽略）。且回跳传完整URL+评论hash干扰路由 | 前端 `goLogin()` 参数名改 `redirect_uri`，回跳值用 `window.top.location.pathname` 相对路径（去hash）。**铁律：Halo 2.20+ 登录回跳只认 redirect_uri，且用相对路径** |
| 2026-11-24 | 外网机器人报 `no-nonce`（红字），内网正常 | 用户在公网 `vicp.fun/ai` 测试，但花生壳映射仍指 28090；`/bot-api/auth-nonce` 公网返回 404（实测 `No static resource`），前端拿不到 nonce | ①必须切花生壳映射 28090→18080 ②前端把 nonce 404 错误提示改为明确指引「用18080端口/切映射」，不再笼统报 no-nonce |
| 2026-11-24 | 外网 /ai 机器人全失败但博客正常 | 花生壳映射仍指 28090（Halo原生），`/bot-api` 只挂 nginx 18080 → 外网 /bot-api 返回 404（实测确认） | 必须把花生壳映射端口从 28090 改为 18080（nginx 会把非 /bot-api 请求原样转给 Halo，博客零影响）。**铁律：整套鉴权功能只在 18080 入口可用** |

## 七、决策记录

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-11-20 | 部署形态用 fnOS 应用中心版 Halo（非手写 Compose） | 更易维护、自动升级 |
| 2026-11-20 | 穿透选花生壳免费版（非樱花Frp/Cloudflare） | 大厂稳定、送域名、国内快 |
| 2026-11-20 | **维持免费版，到期也不升级；域名与 Phase 4 延后** | 先把博客用熟，成本为零；免费额度（1Mbps/1GB月）个人博客够用 |
| 2026-11-20 | 后期域名注册商选阿里云/腾讯云 | 国内管理方便、迁移省事 |
| 2026-11-21 | **不搬 1Panel，Halo 继续由 fnOS 直管** | 已跑通无需冒险迁移；双面板管同一套Docker易冲突；1Panel 强项（域名/SSL/多站点）当前用不上。触发条件：Phase 4 有域名后用它做反代+证书+备份 |
| 2026-11-21 | 博客身份定位改为「数字化管理师」（英文 DIGITAL MANAGEMENT SPECIALIST） | 与用户本职（钉钉OA审批流程+AI智能表格）一致；全套5处文案同步改写避免前后矛盾 |
| 2026-11-21 | 搜索方案：官方搜索组件插件（弹框式）+ 主题补 search.html | 官方插件免维护；弹框体验好；/search 路由必须由主题模板承接 |
| 2026-11-22 | **AI 对话仅内网自用，公网开放随 Phase 4**；模型 1.7B 起步实测再定 | 花生壳免费版仅1条映射；避免暴露算力与隐私；速度不满足就地降级不强上 |
| 2026-11-22 | **AI 服务用 1Panel「自定义编排」部署（本质仍是 Docker）** | 零基础友好：资源曲线/备份计划任务/一键升级全是界面操作；应用商店一键装不带资源护栏，必须走编排粘贴自定义 compose。归属划分更新：Halo 归 fnOS 管（不动），AI 服务归 1Panel 管，铁律「谁创建谁管理」，fnOS Docker 界面看到的 1Panel 容器永远不碰 |

## 八、关键信息

- NAS 内网地址：`http://<NAS_IP>:5666`（fnOS 管理后台）
- SSH：22 端口已开启（部署期间使用；全部完成后建议在 fnOS 设置里关闭或改密）
- 外网地址：**https://<你的壳域名>**（花生壳壳域名，HTTPS）
- NAS 上 Docker 数据目录：存储空间1 `@appcenter/docker-halo/`（花生壳客户端同在 fnOS 应用内）
- Halo 端口：**对外 28090 由 bot-nginx 智能分流（`/bot*`/`/bot-api*` 给机器人，其余给 Halo）；Halo 本体已挪到内部 28091**（容器内 8090，数据卷不变）。⚠️ 勿再手动把 Halo 启回 28090，会与 bot-nginx 抢端口（详见 Phase 7 F/H 节）。
- Halo 数据位置（NAS）：存储空间1 `@appcenter/docker-halo/`
- Halo 版本：**2.27.3**（2026-11-21 经 SSH + daocloud 源升级；镜像 docker.m.daocloud.io/halohub/halo:2.27.3；数据库容器名 halo-halodb-1）+ PostgreSQL
- 用户背景：无编程基础，所有操作按「复制粘贴命令/点界面」级别给步骤
- 决策点确认：通过钉钉单聊推送（见用户规则）
- 主题图片规格（theme-luye）：① Hero 横幅图 `.hero-img`——桌面 3.5:1（最大1100px宽）、手机 2.4:1，object-fit:cover 自动裁切；找图按 **2400×800（3:1）、主体居中、深色调、JPG ≤500KB**；② 首页背景横幅（旧）：`assets/blog-home-banner.jpg` 2560×640 可备用；③ **2026-11-21 已生成两张吉卜力风横幅**：`assets/hero-banner-shanshui.jpg`（2400×800 深绿山水瀑布）与 `assets/hero-banner-seaside.jpg`（2200×620=3.55:1 海边公路，用户指定参考场景，当前选用）；均 AI 原创无版权风险
- 主题文案定制：2026-11-21 将 hero 眉标/标题/简介、关于我、页脚 5 处身份文案改为「数字化管理师 DIGITAL MANAGEMENT SPECIALIST」系列（改的是模板文件，主题升级会被覆盖，需重跑替换脚本；模板备份在同目录 .bak-时间戳）
- 主题强调色：淡蓝 `#7EC8E3`（后台主题设置可改，无需动代码）
- 搜索功能：插件 PluginSearchWidget v1.8.0（弹框式，`SearchWidget.open()` 唤起）；主题设置「搜索页链接」=`/search`；search.html 修复命令见 `deploy/theme-customize-commands.md`
- 主题定制命令总存档：`deploy/theme-customize-commands.md`（文案替换 + search.html 创建 + 收尾关SSH，主题升级后重跑）
- **AI 聊天页（2026-11-23 部署）**：文件 `deploy/blog-chat.html` → NAS `theme-luye/templates/assets/chat.html`；访问 `/themes/theme-luye/assets/chat.html`（内网 28090 / 外网均 200）。前端直连 `http://<NAS_IP>:11434/api/chat`，模型 `qwen3:1.7b`，知识库内嵌在 JS 常量
- ⚠️ **混合内容限制**：公网是 https，聊天页内 JS 请求 http 内网 API 会被浏览器拦截（mixed content）→ 公网对话必须等 Phase 4 做反向代理（nginx 同域转发 `/ai-api/` → ollama:11434），届时把 API 改成 `location.protocol==='https:' ? '/ai-api/api/chat' : 'http://<NAS_IP>:11434/api/chat'`
- 上传文件标准流程（替代 heredoc）：Windows `scp 本地文件 <用户名>@<NAS_IP>:/tmp/` → NAS `sudo mv /tmp/x 目标路径` → `sudo docker restart halo`（新增主题静态文件需重启才生效）
- **教程素材文件**：`TUTORIAL.md`（2026-11-23 创建）——Phase 0~5 全流程、故障速查表、命令速查、小红书发布方案（标题/9图顺序/正文结构/标签/脱敏清单）。用户后续写小红书图文/博客长文直接取用；**每完成新步骤需回填**
- **模型系统提示词存档**：`deploy/webui-system-prompt.md`（v2 · 2026-11-24 新增任职公司脱敏规则；末尾 `/no_think` 必留；依赖 Self-Intro 知识库含「公司类型」概括句）
- **博客前端知识库**：2026-11-24 方案A对齐——`blog-chat.html` 第39行 KB 改为脱敏版详细简历（1060字，源自 `assets/knowledge/你的个人简历.pdf（本地私有，未上传）`，已删公司名/邮箱/电话/住址），第40行 SYS 同步 v2 脱敏规则。**两条链路无自动同步机制**，WebUI 知识库更新需手工同步这两个常量
- **隐私铁律**：前端 JS 可被 F12 查看，禁止写入真实联系方式/具体公司名/证件信息
- **鉴权配额版 AI 机器人（2026-11-24 v3）**：目录 `deploy/bot/`，不动现有博客/AI分身。三件套 `server.js`（13466B v3）、`api-bot.html`（15229B v3）、`nginx.conf` + `docker-compose.yml` + `.env`。
  - ⚠️ **以下 332–338 行为 v3/v4 历史存档，方案已废弃，切勿照做；当前唯一有效方案见 Phase 7 弯路复盘 A~H 节及本节最末「当前版本 v5（终版）」条目。**
  - **身份架构（v3，务必记住）**：前端同源问 Halo `users/-` 拿身份 → WebCrypto HMAC-SHA256 签名（nonce+name+roles，nonce 经 `/auth-nonce` 下发、5分钟有效）→ `X-Bot-Identity` 头传后端 → 后端验签。**不再用服务端转发 Cookie**（Node fetch 会改写 Host 导致 Halo 会话失效）。
  - **配额规则**：管理员(`super-role`)不限；未登录拦截；普通用户注册送1次并落盘；发文章审核通过+1、评论+1（按ID去重）；同一 nonce 防重放、签名防冒名。
  - **访问入口铁律**：只在 nginx **18080** 可用（`/bot-api/`→Node3001，`/`→Halo28090）。外网需把花生壳映射切到 18080；走 28090 时 /bot-api 必 404。
  - **登录铁律（v4 修正）**：`window.top.location.href = location.origin+'/login?redirect_uri='+window.top.location.pathname`。三要素：①`window.top` 跳出 iframe ②参数名 **`redirect_uri`**（Halo 2.20+ 只认这个，`redirect` 会被忽略导致跳个人中心）③回跳值用相对 `pathname` 去 hash。iframe 内绝不承载登录/后台页。
  - **前端版本**：`deploy/bot/api-bot.html` 当前 15540B（v4：修 redirect_uri + nonce404 明确提示）；主题部署路径 `templates/assets/api-bot.html`；改前端后重启 Halo + iframe `?v` 递增破缓存。
  - **部署三路径**：服务端 `/vol1/bot/{server.js,nginx.conf,docker-compose.yml,.env}`；前端 `theme-luye/templates/assets/api-bot.html`；改前端后必须 `docker restart halo` + iframe src 版本号 `?v=N` 递增破缓存。
  - **当前版本 v5+C1（终版，唯一有效）**：server.js **17427B**（`ver:v5`，含 AI 失败退配额）、api-bot.html **13681B**（无签名，纯同源请求，已移除"返回博客"链接）、nginx.conf **4765B**（`/ai` 页 iframe 直接指向 `/bot` 静态新版 + no-store 破缓存）；`_selftest_v5.js` 真实链路 **18/18** 通过。访问：`/bot` 由 nginx 静态托管（无需建页/iframe/重启 Halo），外网 `https://<你的壳域名>/bot`、内网 `:28090/bot`，花生壳映射保持不变。**v3/v4 的 HMAC 方案已废弃**（密钥不可能在纯前端安全持有）。身份架构见 Phase 7 H 节。
  - **验证**：部署后 health 应返回 `{"ok":true,"model":"deepseek-flash","ver":"v5"}`；前端 `/status` 无 Cookie 返回 loggedIn:false、管理员 Cookie 返回 admin:true/remaining:-1。
  - **DeepSeek 实测（2026-11-24）**：官方 API `deepseek-flash` + `thinking:{type:'disabled'}` 返回正常中文（"成功"）；密钥有效。`deepseek-chat` 仍可用但被平台自动映射为 flash。

| 2026-11-24 | v3/v4 HMAC 身份方案全部失效：已登录永远显示未登录 | 前端用 nonce 当签名密钥、后端用 signSecret 验签，两把密钥不同 → 验签 100% 失败；且纯前端无法安全持有密钥。旧自测假阳性（测试模拟前端时误用了后端密钥） | **v5 彻底删除 HMAC/nonce**，后端用原生 http.request 显式设 Host+透传 Cookie 问 Halo 身份（实测 fetch 会改写 Host 是 v1 失败真凶）。**铁律：跨服务认证不要用前端签名，让持有会话的一方（浏览器）直接问身份服务** |
| 2026-11-24 | 即使身份识别成功，管理员也被判普通用户 | Halo roles 是对象数组 `[{metadata:{name:'super-role'}}]`，代码按字符串数组 `.includes('super-role')` 判断 | 后端提取 `r.metadata.name` 后再判断。**铁律：解析 Halo roles 必须先取 metadata.name** |
| 2026-11-24 | 前端报 no-nonce / 外网问答不可用 | 用户在公网测试但花生壳映射仍指 28090，/bot-api 公网 404；且 v3 前端依赖 nonce 接口 | v5 前端不再依赖 nonce；外网仍须切映射到 18080。**注意：v5 的 /auth-nonce 仅返回占位兼容，前端已不用** |
| 2026-11-25 | 部署期两张截图排查：①`/bot` 显示 404 `No static resource bot.` ②外网 `/ai` 已登录仍显示「请先登录」 | 两者是**不同问题**：①Halo 里还没建别名 `bot` 的页面（ nginx 把 `/bot` 转给 Halo，Halo 无此页面→404），与登录无关；②花生壳映射仍指 28090，`/bot-api/status` 打到 Halo 返回 404 JSON，v5 前端 `r.json()` 后 `d.loggedIn===undefined`，`!undefined===true` → **误判为未登录**（真实未登录是 200+loggedIn:false）。服务端鉴权本身无 bug | **前端加双重防护**：`refresh()` 先判 `r.ok`（非2xx直接抛「接口不可达/请切18080」），再校验 `typeof d.loggedIn==='boolean'`（否则抛「状态响应异常」），两种都不再误渲染门页。模拟 4 场景全通过，JS 语法检查通过。`api-bot.html` 12552→13173B，已同步归档。**铁律：前端判登录必须先校验 HTTP 状态 + 字段类型，不能只 `if(!d.loggedIn)`；404 页面≠登录态问题** |
| 2026-11-25 | **架构级根治：用户对反复试错失去耐心，`/bot` 依赖「Halo 建页+iframe+?v 破缓存」链路太脆弱** | Halo 建页/iframe/缓存三层任一环节出错就 404 或旧页面；用户已多次卡在此处。计划书目标只是"一个稳定的鉴权机器人页"，从没要求必须嵌在 Halo iframe 里 | **nginx 直接托管 `/bot`**：`location = /bot` alias 静态 HTML（新增 `location = /bot`、`/bot/` 两条，带 `Cache-Control:no-store`）；`docker-compose.yml` 给 bot-nginx 加挂载 `./api-bot.html:/usr/share/nginx/html/api-bot.html:ro`。**从此 /bot 不再经过 Halo，无需建页、无需 iframe、无需 ?v 破缓存、无需重启 Halo**。前端 header 加「← 返回博客」链接补体验。本地模拟 5 项全过（/bot 返回机器人页且未落 Halo、/bot-api 正常、/ 博客原样、无密钥、无签名）。文件：nginx.conf 1621B、docker-compose.yml 863B、api-bot.html 13252B，已归档。**新铁律：机器人页面走 nginx 静态托管，与 Halo 页面体系解耦** |
| 2026-11-25 | 架构根治后 `/bot` 报 **403 Forbidden / nginx/1.31.10** | 403 来自 nginx 自身（非 Halo），证明新配置已接管 `/bot`；根因是挂载文件读取权限：`scp` 上传的 `api-bot.html` 权限受 umask 影响可能是 600，nginx worker（非 root）读不到 → 403。另一可能是宿主机文件缺失时 Docker 自动把挂载点建成**目录**，alias 指向目录且 autoindex 关闭同样返回 403 | 一条命令修权限+排目录+重建：先判 `-d` 则改名让位，再 `cp /tmp/api-bot.html` 覆盖、`chmod 644`、目录 `chmod 755`，force-recreate 后 curl 验 200。**铁律：新增 bind mount 单文件后必须 `ls -l` 确认是普通文件且 644，nginx worker 非 root 读不到 600 文件** |
| 2026-11-25 | **上条 403 真根因确认并彻底修复（SSH 实机诊断）** | 真根因不是权限：`/vol1/bot/api-bot.html` 被 Docker 卷挂载误建成**目录**（`stat` 显示 `Is a directory`），后续 `cp` 把文件塞进目录内变成 `api-bot.html/api-bot.html`；nginx `alias` 指向目录 → 日志 `directory index ... is forbidden` → 403，并对 /bot 补斜杠 → 301。之前 chmod 600 只是猜测 | **AI 用 paramiko 自动登录 NAS 修复**（用户提供 SSH 密码，全程无需用户操作）：①`rm -rf` 误建目录 → `cp` 重建为普通文件 13252B → ②nginx.conf 加 `rewrite ^ /bot.html last` 把 /bot 与 /bot/ 统一导向 alias 文件，消除 301/500 → ③force-recreate。**实机验证全通过**：`/bot`、`/bot/`、`/bot.html` 全部 200、内容含"AI 问答机器人"、health v5、博客首页 200、无 Cookie 的 status 返回 `loggedIn:false`、前端无 sk- 密钥、含 r.ok 校验与返回博客链接。**铁律：bind mount 单文件前宿主路径若已被建成目录，cp 会往里塞文件而非覆盖，必须先 `rm -rf` 目录再 `stat -c %F` 确认是 regular file**；**运维提效：需要 SSH 自动操作时用 `paramiko`（Windows 下 pexpect.spawn 不可用），密码走环境变量不落盘** |
