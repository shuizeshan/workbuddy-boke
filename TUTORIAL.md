# 用一台飞牛 NAS 搭「博客 + 本地 AI 问答」全流程图文教程

> 素材稿 · 2026-11-23 整理
> 用途：① 小红书图文笔记 ② 博客长文 ③ 自己日后复盘/换机重装
> 全部步骤均为本项目**真实跑通**的流程，含踩过的坑与修复方式

---

## 〇、教程通用说明（写文前必读）

### 1. 脱敏：发布前必须替换的 4 个信息

| 教程里出现 | 真实值（不要公开） | 教程里用 |
|---|---|---|
| NAS 内网 IP | `<NAS_IP>` | `192.168.1.100` |
| NAS 管理端口 | `5666` | `5666`（可保留，属通用默认值但建议改） |
| 花生壳壳域名 | `<你的壳域名>` | `your-name.vicp.fun` |
| Halo 管理员账号/密码 | 你的账号 | `admin / 你的密码` |

⚠️ 另外：不要出现**公司名**、内网网段细节、SSH 端口开放状态。小红书对「内网穿透」类内容审核较松，但**不要写「破解」「白嫖」「绕过限制」**这类词。

### 2. 一套占位符，全文统一

```
<NAS_IP>     = 192.168.1.100      NAS 局域网地址
<NAS_PORT>   = 5666               fnOS 管理后台端口
<HALO_PORT>  = 28090              Halo 对外端口（会被 fnOS 改写，见 Phase 1）
<SSH_USER>   = 你的用户名          SSH 登录名
<DOMAIN>     = your-name.vicp.fun  花生壳壳域名
```

### 3. 本教程的时间/成本总账（做封面数据用）

| 项目 | 花费 | 说明 |
|---|---|---|
| 飞牛 NAS（二手小主机） | 约 6500 元 | Pentium Gold 6500Y / 16GB / 411GB |
| fnOS 系统 | 0 元 | 国产 NAS 系统，免费 |
| Halo 博客 | 0 元 | 开源，Docker 部署 |
| 花生壳内网穿透 | 0 元 | 免费版 1Mbps / 1GB 月流量，送二级域名 |
| 本地大模型 | 0 元 | Ollama + Qwen3 1.7B，纯 CPU 跑 |
| **合计** | **≈ 电费** | 全流程零软件成本 |

耗时参考：第一次做，博客 2 小时、美化 3 小时、AI 4 小时；熟练后重装 1 小时内。

---

# Phase 0 · 环境准备

### 步骤 0.1 装系统、进后台
- **做什么**：NAS 装 fnOS，浏览器打开 `http://<NAS_IP>:<NAS_PORT>`
- **为什么**：后面所有操作（Docker、应用中心、安全设置）都在这个后台里点
- **操作**：U 盘写盘 → 安装 → 手机号注册管理员 → 浏览器登录
- **✅ 成功标志**：能看到「存储空间 / 应用中心 / Docker / 设置」等菜单
- **📸 截图点**：fnOS 桌面总览（后面做「成果展示」图）

### 步骤 0.2 确认硬件够不够（AI 能不能跑的关键）
- **做什么**：设置 → 系统信息，记下 CPU 型号、核数、内存
- **为什么**：跑本地大模型，**内存是硬门槛**。16GB 是 1.7B~4B 模型的安全线，8GB 会非常吃力
- **本项目实测**：Pentium Gold 6500Y（2 核 4 线程）/ 16GB（可用约 11GB）/ UHD 615 核显
- **✅ 成功标志**：内存 ≥ 8GB（推荐 16GB），磁盘剩余 ≥ 50GB
- **⚠️ 坑**：不要相信电商页宣传的「32GB」，一定进系统看真实值

### 步骤 0.3 确认 Docker 可用
- **做什么**：应用中心 → Docker → 确认服务已启动
- **为什么**：Halo 和大模型都是容器跑，Docker 是地基
- **✅ 成功标志**：Docker 界面能打开，容器列表为空也正常

### 步骤 0.4 打开 SSH（临时用，做完就关）
- **做什么**：设置 → 终端与 SSH → 开启
- **为什么**：后台点不出来的时候（拉镜像失败、改主题文件），SSH 是唯一兜底手段
- **✅ 成功标志**：Windows 终端执行 `ssh <SSH_USER>@<NAS_IP>` 能登录
- **⚠️ 坑｜新手最容易懵**：**Windows 的 cmd 里没有 sudo**。看到 `C:\Users\xxx>` 说明还在自己电脑上；看到 `user@<NAS主机名>:/$` 才是进了 NAS。命令提示符认错，后面全乱
- **📸 截图点**：两个不同提示符对比图（做「新手避坑」图很吸睛）

---

# Phase 1 · 部署 Halo 博客

### 步骤 1.1 应用中心一键安装 Halo
- **做什么**：应用中心 → 搜 Halo → 安装
- **为什么**：比手写 Docker 命令稳，升级也方便
- **操作**：安装时记下它分配的外部端口（本项目是 **28090**，不是默认 8090）
- **✅ 成功标志**：浏览器打开 `http://<NAS_IP>:<HALO_PORT>` 出现 Halo 初始化页
- **⚠️ 坑｜必记**：**fnOS 会把容器对外端口改写**（容器内 8090 → 对外 28090）。访问不通时，第一件事是去「容器详情」看端口映射那一行，而不是怀疑装坏了

### 步骤 1.2 初始化博客
- **做什么**：填站点名称、管理员账号密码、邮箱
- **✅ 成功标志**：进入后台 `/console`，能发第一篇文章并在前台看到
- **📸 截图点**：《Hello Halo》首发文章页

### 步骤 1.3 升级到 2.27.3（可选但推荐）
- **做什么**：Halo 后台提示可升级 → 但**不要用 UI 一键升级**
- **为什么**：fnOS 内置镜像代理拉不到新版；UI 点「保存+重启」也常常**只重启旧容器，不重建**
- **正确做法**：SSH 执行
```bash
# 用国内加速源拉镜像
sudo docker pull docker.m.daocloud.io/halohub/halo:2.27.3

# 停掉旧容器，用同一份数据卷重建
sudo docker stop halo && sudo docker rm halo
sudo docker run -d --name halo --restart unless-stopped \
  -p 28090:8090 \
  -v /var/apps/docker-halo/var/halo2:/root/.halo2 \
  --network halo_default \
  docker.m.daocloud.io/halohub/halo:2.27.3
```
- **✅ 成功标志**：`docker ps` 看到 halo 运行中；前台 200；后台版本显示 2.27.3；文章、主题、设置全部还在
- **⚠️ 坑**：先 `docker inspect halo` 把原来的**端口、数据卷、网络**抄下来，重建时照抄，少一个参数数据就「丢」了（其实还在，只是挂不回去）

---

# Phase 2 · 外网访问（无公网 IP 方案）

### 步骤 2.1 注册花生壳、装 fnOS 客户端
- **做什么**：花生壳官网注册 → fnOS 应用中心装花生壳 → 登录
- **为什么**：家宽/公司网没有公网 IP，内网穿透让 NAS **主动向外连**，外网就能访问
- **✅ 成功标志**：客户端显示「在线」，分配到一个壳域名 `<DOMAIN>`
- **📸 截图点**：花生壳「映射列表」页

### 步骤 2.2 建 HTTPS 映射（关键：别映射错端口）
- **做什么**：新建映射 → 类型 HTTPS → 内网地址 `127.0.0.1` → 端口 `28090`
- **为什么**：`127.0.0.1` 是花生壳客户端自己所在机器的回环，比填局域网 IP 更稳，不依赖网卡
- **✅ 成功标志**：外网（手机流量）打开 `https://<DOMAIN>` 能进博客
- **⚠️ 坑｜安全事故级**：fnOS 装花生壳后**会自动建一条映射指向管理后台 5666**，等于把 NAS 控制台挂到公网。必须改成 28090 或删掉
- **🔒 铁律写进教程**：**5666（管理后台）、22（SSH）、3000/11434（AI 服务）永远不要映射到公网**

### 步骤 2.3 三个必须知道的花生壳事实
| 事实 | 影响 |
|---|---|
| 免费版 1Mbps / 1GB 月流量 | 个人博客够用；放视频/大量图片会很快耗尽 |
| 试用期 15Mbps / 500GB | 到期自动回落，**不影响外网访问**，只限速限量 |
| 免费版仅 1 条映射 | 想同时映射博客和 AI 服务，得升级或换方案（本项目只映射博客） |

---

# Phase 2.5 · 安全加固（5 分钟，别跳）

1. fnOS 管理后台：**强密码 + 两步验证**（安全中心）
2. SSH **用完就关**（设置 → 终端与 SSH）
3. 花生壳映射**只留 28090 一条**
4. 博客数据定期备份：应用中心 → 备份，或 SSH 打包 `/var/apps/docker-halo/var/halo2`
5. 安全中心跑一次「安全诊断」，异常登录通知打开

---

# Phase 2.6 · 博客美化（这篇笔记的颜值担当）

### 步骤 3.1 换主题
- **做什么**：后台 → 外观 → 主题 → 上传 `theme-luye`（绿野风格）
- **✅ 成功标志**：前台变绿色风格；**立刻检查前台不报 500**
- **⚠️ 坑**：主题对 Halo 版本有要求。装完立刻刷前台，500 就切回默认主题——别硬顶

### 步骤 3.2 改身份文案（5 处）
- **做什么**：把主题自带的「SOFTWARE & AI ENGINEER」改成自己的身份，如「数字化管理师 DIGITAL MANAGEMENT SPECIALIST」
- **为什么**：主题文案是**硬编码在模板里**的，后台改不了，只能改文件
- **操作**：SSH 进主题目录，用 sed 批量替换（替换前先备份 `.bak`）
- **⚠️ 坑**：主题升级会覆盖，**命令要存成文档，升级后重跑**

### 步骤 3.3 改强调色
- **做什么**：后台 → 主题设置 → 强调色 `#7EC8E3`（淡蓝）
- **为什么**：这个不用改代码，后台就能改
- **✅ 成功标志**：按钮、链接、hover 全部变淡蓝

### 步骤 3.4 Hero 横幅图（AI 生成）
- **做什么**：用 AI 生图工具生成横幅，替换主题 hero 图
- **尺寸规格（实测）**：桌面 3:1~3.55:1、宽 ≤1100px 显示区 → 出图 **2400×800** 或 **2200×620**，主体居中、深色调、JPG ≤500KB
- **✅ 成功标志**：桌面端不糊、不变形；手机端（2.4:1 裁切）主体还在
- **⚠️ 坑**：直接传 4K 大图，前台加载慢还糊；尺寸对不上会裁掉主体
- **📸 截图点**：生成前后对比图（笔记里最拉好感的图）

### 步骤 3.5.1 自定义聊天页文案（2026-11-24 实操）
- **做什么**：改聊天页顶栏标题、副标题、欢迎语
- **改哪里**：唯一文件 `deploy/blog-chat.html`，第 6 行 `<title>`、第 28 行 `<h1>`、第 29 行 `<p>`、第 50 行 `add('你好！…')`
- **为什么**：单文件零依赖，无后台配置；四处字符串与 API/提示词/样式无耦合，改动不影响回答质量
- **流程**：本地改 → Windows `scp` 上传 → NAS `sudo mv` 覆盖 → `sudo docker restart halo` → 浏览器加 `?v=2` 验证
- **⚠️ 坑**：本地 `deploy/` 是唯一源头，只改 NAS 副本下次部署会被覆盖；Halo 缓存主题静态资源内容，不重启可能仍是旧版

### 步骤 4.5.1 模型系统提示词加「公司脱敏」（2026-11-24 实操）
- **做什么**：在 Open WebUI 模型预设「qwen3:1.7b中文」的系统提示词里加一段——涉及任职经历只说公司类型，不出现具体公司名/简称/英文名
- **改哪里**：WebUI → 模型 → 预设 → 系统提示词框（存档 `deploy/webui-system-prompt.md`）
- **为什么**：博客公开展示，简历内容需要脱敏；提示词是零成本的第一道防线
- **⚠️ 坑1**：末尾 `/no_think` 不能丢——1.7B 无参数级开关，丢了会重新输出思考过程
- **⚠️ 坑2**：脱敏规则依赖知识库里有「公司类型」概括句；只有具体公司名则恒定回答"不清楚"，需先补知识库
- **⚠️ 坑3**：改完预设必须新开对话测试，旧对话不继承新配置

### 步骤 5.1.1 博客 AI 与 WebUI 回答对齐（2026-11-24 实操）
- **问题**：WebUI 用向量库详细简历，博客用前端 `KB` 常量旧版摘要，**两条链路无同步机制**，回答必然不一致
- **方案 A（当前采用）**：把详细简历脱敏后同步进前端 `KB` + `SYS` 常量；人工保持同步。方案 B（博客改调 WebUI API）需公网暴露 WebUI、违反安全铁律且免费版仅 1 条映射，故放弃
- **脱敏处理**：保留经历细节（团队规模/系统类型/数字化成果/证书），删除具体公司名、邮箱、电话、住址、学历；加入「公司类型」概括句让脱敏规则可命中
- **⚠️ 隐私铁律**：前端 JS 任何人 F12 可见，**绝不能放真实联系方式、具体公司名、证件信息**
- **同步清单**：WebUI 知识库有变 → 改 `deploy/blog-chat.html` 第 39 行 KB / 第 40 行 SYS → scp + mv + restart → iframe 版本号 `?v` 递增

### 步骤 5.1.2 聊天页 Markdown 渲染（2026-11-24 实操）
- **问题**：模型输出 `**加粗**`、`1. 列表` 等标记，`add()` 用 `textContent` 导致原始标记暴露
- **方案**：零依赖手写受限渲染器 `esc()` + `md()`，先 HTML 转义再解析，支持标题/粗体/斜体/有序无序列表/行内代码/代码块/链接
- **安全**：`<script>` 被转义为实体；链接仅允许 http/https/mailto/相对路径，避免 `javascript:` 注入
- **样式**：`.msg.md` 覆盖 `white-space:normal`；移动端 `@media(max-width:600px)` 缩小字号与缩进，与桌面一致
- **验证**：Node 本地跑 `md(测试串)` 输出正确标签、XSS 检查为 false 后再部署

### 步骤 6.1 新增在线 API 机器人模块（2026-11-24 实操）
- **需求**：不重构现有博客与 AI 分身，纯增量加一个可调任意 OpenAI 兼容 API 的在线机器人
- **边界**：不动 `blog-chat.html`、不动主题模板、不动 Halo 配置；只新增 `deploy/api-bot.html` + 一个新 Halo 页面
- **配置方式**：页面内「⚙ 设置」面板填 URL/Key/模型/系统提示词/温度/max_tokens，存浏览器 localStorage；**密钥不写进文件、不上传服务器，谁用谁填自己的**
- **URL 拼接**：自动把 Base URL 补成 `/v1/chat/completions`（已带则不重复）
- **错误处理**：参数校验 8 分支（未配置/http/无Key/无模型/温度越界/tokens越界/空输入/合法）；HTTP 401/403/429 给专项提示；网络/CORS 失败单独说明
- **加载状态**：按钮禁用 + "请求中…" + typing 气泡，finally 恢复
- **⚠️ 关键限制**：浏览器直连第三方 API 必须对方支持 CORS；不支持的服务商会出现 "Failed to fetch"，需服务端代理（当前未做）
- **验证**：Node 检查 JS 语法、md 渲染、XSS 转义、URL 拼接、8/8 参数分支全通过后才部署

### 步骤 6.2 鉴权配额版 AI 机器人 v3（2026-11-24 实战·反复踩坑后彻底重构）
- **需求升级**：从"访客自填Key"改成"管理员无限 / 登录送1次 / 发文章或评论各+1 / 密钥后台统一配置"
- **最终架构**：`花生壳 → nginx(18080) → [/bot-api→Node代理, /→Halo28090]`，博客零改动
- **📸 这是绝佳的教程素材**："服务端判身份"踩了 3 个连环坑，每个都是知识点

| 坑 | 现象 | 根因（可写成笔记正文） | 彻底解法 |
|---|---|---|---|
| 1 | 外网机器人全 404，博客却正常 | 花生壳映射指 28090，而 `/bot-api` 只挂 18080 | 映射改指 18080（nginx 把其他请求原样转 Halo，零影响） |
| 2 | 点登录显示禁止图标 / iframe 里冒出 Halo 后台404 | 登录页带 `X-Frame-Options: SAMEORIGIN`；iframe 内导航还会触发已登录自动跳 console | 登录用 `window.top.location.href=origin+'/login?redirect='+当前页`——跳出 iframe + 不写死域名 + 带回跳 |
| 3（最深） | 明明已登录，机器人说未登录，反复改不好 | **Node 的 fetch 转发 Cookie 时强制把 Host 改成 127.0.0.1**，而 Halo 会话 Cookie 按域名绑定 → 服务端永远拿到 anonymousUser | 身份改由**前端同源问 Halo**（浏览器自动带正确 Cookie/Host），HMAC-SHA256 签名后传服务端验签，服务端不信任明文 |

- **身份链路（v3，务必记住）**：前端 `GET /apis/.../users/-`（同源）→ 拿 name/roles → 取 `/auth-nonce` → WebCrypto 签 `nonce|name|roles` → `X-Bot-Identity` 头 → 后端验签 + Halo 判 admin
- **配额**：管理员不限；新用户送1次**并落盘**（修复了原来重启丢失的bug）；文章+1/评论+1 按ID去重；nonce 5分钟防重放、签名防冒名
- **验证**：`_selftest_v3.js` 全链路 12/12（nonce/拒绝伪造/送1次/管理员不限/扣减/用完403/冒名拒绝）+ 前端 9/9 安全检查
- **⚠️ 两条铁律**：①只走 18080（28090 必 404）②iframe 内永不承载登录/后台页；改前端后 `docker compose up -d --force-recreate` + `docker restart halo` + iframe `?v` 递增
- **⚠️ 后续已推翻**：上面 v3 的 HMAC 身份方案不成立（前后端密钥不同，验签必失败），iframe 方案也已废弃。以步骤 6.3 为准，本节仅作「踩坑复盘」素材保留

### 步骤 6.3 鉴权机器人 v5 终版 + 架构级根治（2026-11-25 实战）

> 这是整个项目最曲折的一段，前后推翻 4 版架构、部署返工多轮。写成教程就是一篇《一个登录态 bug 如何逼我重构 4 次架构》，下面是可直接取的素材。

**📸 素材 1：三次架构推翻（每个都是一个知识点）**

| 版本 | 做法 | 为什么翻车 |
|---|---|---|
| v1 | Node 用 fetch 带 Cookie 问 Halo 身份 | fetch 强制把 Host 改成 127.0.0.1，Halo 会话按域名绑定 → 永远 anonymousUser |
| v3 | 前端问 Halo 身份后用 HMAC-SHA256 签名传后端 | 前端拿 nonce 当密钥、后端拿 signSecret 验签，两把密钥不同 → 100% 失败；且前端密钥 F12 可见，原理就不成立 |
| v5 ✅ | 后端原生 http.request 显式设 Host + 透传 Cookie 问 Halo，前端零签名 | 让 Halo 亲自判身份，可信、不可伪造 |

**一句话教训**：纯前端永远不能安全持有密钥；跨服务认证别依赖 fetch 自动转发 Host。

**📸 素材 2：部署页面的三次降级**

- 最初：Halo 建页 + iframe + `?v=N` 破缓存 → 三层任一出错就 404/旧页面，用户反复卡住
- 根治：**nginx 直接静态托管 `/bot`**，与 Halo 解耦，不再建页/iframe/破缓存/重启 Halo
- 收尾：`/bot`、`/bot/` 用 `rewrite ^ /bot.html last` 统一到一个 alias，避免补斜杠 301 和 alias 目录歧义 500

**📸 素材 3：一个隐蔽到极致的 403（值得单独一图）**

- 现象：`/bot` 一直 403 Forbidden（nginx），health 却正常 v5
- 猜测：权限 600？—— 错，实测 644
- 真根因：Docker 卷挂载时**源路径不存在，自动把 `/vol1/bot/api-bot.html` 建成目录**；之后 `cp /tmp/api-bot.html /vol1/bot/api-bot.html` 把文件**塞进目录内部**变成 `api-bot.html/api-bot.html`；nginx alias 指向目录 → `directory index ... is forbidden` → 403
- 解法：`rm -rf` 误建目录 → 重新 `cp` 成普通文件 → `stat -c %F` 确认 `regular file` → force-recreate
- 教训：`mv` 是移动（会清空 `/tmp` 源），落位固定用「scp 到 /tmp → cp 到目标 → wc -c + stat 验收」

**📸 素材 4：验证要做几轮（反"虚假跑通"）**

单轮 curl 不算跑通。本轮实际验证清单：
1. `nginx -t` 语法通过
2. 容器状态 Up
3. **3 轮间隔 HTTP**：`/bot`、`/bot/`、`/bot.html` 全 200，health v5，首页 200
4. 鉴权拒绝路径：无 Cookie / 假 Cookie 都 `loggedIn:false`，无 Cookie chat 返回 401
5. 前端一致性：3 次抓取都是 13252 字节，含门页文案与 r.ok 校验、无 sk- 密钥
6. 反代透明性：首页 200、后台 302（正常重定向）、旧 AI 分身 200
7. 近期日志无 error
8. **如实注明未覆盖**：管理员真实登录连聊需浏览器交互（Halo 登录页用 CSRF + jsencrypt RSA 加密），归入外网验证，不谎称已验证

**前端防误判加固**：`refresh()` 先判 `r.ok`（非 2xx 抛"接口不可达"），再校验 `typeof d.loggedIn === 'boolean'`；否则 404 JSON 的 `undefined.loggedIn` 会被 `!undefined=true` 误判成"未登录"。

> ⚠️ **以下 6.4 推翻了"切映射 18080"和"只走 18080"的旧结论**，以 6.4 为准。

### 步骤 6.4 外网终极打通 + DeepSeek 回答修复（2026-11-25 下午实战）

**问题一：机器人能聊，但回答像"没连 DeepSeek"**
- **现象**：问"你是什么模型"，答"我是博客助手，不方便编造，我这边没有足够信息"。
- **排查（关键：先验证再判断）**：进容器用 Node 直连 `https://api.deepseek.com/v1/chat/completions` → `HTTP=200`、回复"连接成功"。**DeepSeek 其实完全连通**，敷衍是提示词太保守造成的。
- **更深层的坑**：改提示词后 `force-recreate` 仍不生效——多行提示词写进 `.env` 后，第 2 行起被 compose 当成新变量，报 `failed to read .env: line 5: unexpected character "【" in variable name`，容器根本没重建，一直用旧提示词。
- **修复**：① `.env` 里 `SYSTEM_PROMPT` 必须**单行**；② 改前先 `cp .env .env.bak_$(date +%s)`，密钥从备份取回；③ 改完 `docker compose config -q` 校验 → `up -d --force-recreate` → 确认输出 `Recreated` → `docker exec bot-api printenv SYSTEM_PROMPT` 读到新值。
- **✅ 成功标志（实测三问）**："你是什么模型"→明确答"由DeepSeek提供技术支持、模型deepseek-flash"；"你好啊"→自然打招呼；"博客是做什么的"→准确说出主题与技术栈。
- **📸 截图点**：浏览器连续问这三个问题的对话截图。

**问题二：博客页/外网机器人报"HTTP 404 接口不可达"**
- **排查**：外网 `curl https://域名/bot-api/health` 返回 Halo 的 404。查花生壳日志发现映射是**云端规则** `<你的壳域名>:443(127.0.0.1:28090)`；本地 `phtunnel.json` 改不动，本地 RPC 端口返回 `unknow service`。
- **关键决策**：不碰花生壳（省去网页操作），改为**在 NAS 本地把 28090 变成智能分流入口**。
- **执行（AI 全自动，含备份与回滚）**：
  1. 备份：`tar czf /vol1/bot/halo2-backup-before-reroute.tar.gz -C /var/apps/docker-halo/var halo2`（21M）+ `docker inspect halo > halo-inspect-before.json`
  2. Halo 换内部端口：停旧容器 → `docker rm halo` → 用 inspect JSON 解析出的**原参数**（`-e JVM_OPTS`、数据卷、`--network trim-default`、容器名仍 `halo`）重建为 `28091:8090`，数据卷原样挂载 **数据零丢失**
  3. bot-nginx 的 `nginx.conf` 改为同时 `listen 28090` 和 `18080`；`/bot`、`/bot/` rewrite 到静态页，`/bot-api/` 转发 Node，`location /` 转发 Halo(28091)
  4. `docker compose up -d --force-recreate bot-nginx`
- **✅ 成功标志**：花生壳**什么都不用改**，`https://域名/bot` 与 `/bot-api/health` 直接 200+v5，博客首页正常。
- **📸 截图点**：花生壳映射列表（证明仍是 28090，没改）+ 外网 `/bot` 页面 + 外网 health 返回。

**多轮验证结果**：外网三轮 health 全 200+v5、/bot 与首页全 200；内网 28090/18080 双入口三轮全 200；无 Cookie chat→401；博客 `/`、`/archives`、`/about`、`/ai` 全 200；前端无密钥；nginx 无 error；四个容器全 Up。

**回滚**：若需恢复旧架构，用 `halo-inspect-before.json` 把 Halo 重建回 `28090:8090`，bot-nginx 换回只 listen 18080 的旧配置；数据卷备用 `halo2-backup-before-reroute.tar.gz`。

**当前状态（2026-11-25 16:45 最终）**：内外网全部打通，花生壳无需任何改动；管理员登录态已用 Playwright 真实浏览器 3 轮验证通过（含内网 iframe 同源与徽标识别），**全部完成，无剩余项**。

### 步骤 6.5 内网登录失效 + 评论不加次数（2026-11-25 傍晚实战）

**问题一：内网站点的机器人「点登录没反应 / 登录后仍显示需登录」**
- **现象**：外网 `/ai` 里的机器人能登录能聊；内网 `<NAS_IP>:28090/ai` 里的机器人点登录没反应，登录后还提示"请先登录"。
- **排查（curl 页面 HTML 铁证）**：`/ai` 页面正文的 iframe src 写死了**外网绝对域名** `https://<你的壳域名>/themes/.../api-bot.html?v=8`。内网访问时 iframe 从外网域名加载 → 跨域。
- **根因（两个叠加）**：① 旧 `goLogin()` 读跨域的 `window.top.location.pathname` 抛异常 → 跳转失效；② iframe 内 `/bot-api/*` 请求带的是**外网 Cookie**，与内网登录态不通 → 后端问 Halo 仍是 anonymousUser。核心铁律：**内外网 Cookie 不通用，iframe 必须同源**。
- **修复**：
  1. nginx `location /` 加 `sub_filter 'https://<你的壳域名>/' '/'`、`sub_filter_once off`、`sub_filter_types application/json`（把 Halo 返回 HTML 里的绝对域名改成相对路径；`text/html` 是默认类型别重复写）。
  2. 前端 `goLogin()` 改用 `window.top.location.origin + pathname`，并用 try/catch 包住跨域访问。
- **✅ 成功标志**：内外网 `/ai` 的 iframe src 都变成 `src="/themes/...api-bot.html?v=8"`（相对路径）；内网站点点登录跳转正常、登录后徽标显示登录态。
- **📸 截图点**：内网 `/ai` 页面 F12 看 iframe src（相对路径）+ 登录后徽标。

**问题二：评论并审核通过后，次数仍为 0，点"刷新"也没用**
- **排查**：读账本 `/app/data/ledger.json`——用户 remaining=0、claimedComments=[]，说明后端 syncQuota 从没识别到评论。用 PAT 调评论 API 看真实返回：`items[0].comment.spec.owner.name = '<测试用户名>'`、`items[0].comment.metadata.name = ...`、**`approved=true`** —— 比旧代码预期**多套了一层 `comment`**。
- **根因**：旧 `server.js` 的 `commentAuthorName()` 读 `c.spec.owner`（undefined），评论循环读 `c.metadata.name`（undefined）→ 作者永远匹配不上 → 不兑换。"刷新无效"是同一 bug（刷新触发的 syncQuota 也读空）。
- **修复**：新增 `asComment(item)`（有 `item.comment` 取内层，否则用自身，兼容版本差异），作者/ID 都基于它解析；只认 `spec.approved === true` 的评论（防刷）。
- **✅ 成功标志**：容器内跑验证脚本识别到用户 <测试用户名> 的已审核评论 1 条 → 执行 syncQuota 后账本 remaining **0→1**、claimedComments 记录评论 ID（去重）；用户刷新后徽标变"剩余 1 次"。
- **📸 截图点**：账本 JSON（remaining=1 + claimedComments）+ 刷新后机器人徽标。

**本轮两条通用教训（写教程重点讲）**：
1. **iframe 里写死绝对域名是跨域登录杀手**——统一让 nginx `sub_filter` 替换成相对路径，iframe 跟随当前域名同源。
2. **解析第三方 API 先看真实 JSON 再写代码**——Halo 评论 API 套了一层 `comment`，照文档/想象写必错；额度类 bug 直接读账本验证，别只盯 UI 刷新。

### 步骤 6.6 ⚠️ 上面 6.5 的 iframe 修复其实是"假阳性"——gzip 坑（2026-11-25 傍晚续，最高价值）

> 这段是绝佳的教程素材：**"为什么我以为修好了，用户却说没修好"**。核心是 curl 验证骗了我们。

- **反转**：6.5 用 curl 验证 `/ai` 的 iframe src 变成相对路径，以为修好了。用户复测：**内网还是未登录、点登录还是没反应**。
- **真凶（Playwright 真实浏览器铁证）**：
  1. 浏览器真实登录内网 `<你的管理员账号>` → Cookie SESSION 正常；
  2. 浏览器里直接 `fetch('/bot-api/status')` → **`loggedIn:true, admin:true`**（后端鉴权完全没问题！）；
  3. 但 `/ai` 的 iframe **真实 src 仍是 `https://<你的壳域名>/...`（外网域名、跨域）**——iframe 带外网 Cookie，读不到内网登录态。
- **为什么 curl 说成功了？** Halo 对 `/ai` 返回响应头 **`content-encoding: gzip`**。nginx 的 `sub_filter` **改不了压缩流**。curl 默认**不发** `Accept-Encoding`，Halo 就返回未压缩内容 → sub_filter 生效 → 看到相对路径（假象）。浏览器发 `Accept-Encoding: gzip` → Halo 压缩 → sub_filter 失效 → 外网绝对域名。
- **正解**：`location /` 里加 `proxy_set_header Accept-Encoding "";`（强制 Halo 别压缩），sub_filter 才能对所有请求生效。前端代码**一行都不用改**——跨域消除后，原有登录跳转逻辑自然正常。
- **✅ 成功标志（必须这样验证）**：
  - 带 gzip 复现：`curl -H "Accept-Encoding: gzip" --compressed /ai | grep iframe` → src 为 `/themes/...`，且响应头**无** `content-encoding`。
  - 真实浏览器（Playwright）：内网登录→`/ai`→iframe 同源、徽标"管理员·不限次数"；外网同样正常；点登录按钮正确跳出 iframe 到顶层 `/login`。
- **📸 截图点**：curl 带 gzip 前后的 iframe src 对比 + 浏览器里 iframe 的 URL（同源）+ 徽标"管理员·不限次数"。

**本节铁律（教程重点强调）**：
1. **验证响应体改写（sub_filter 等）必须带浏览器真实请求头 `Accept-Encoding: gzip`，否则 curl 的"成功"是假阳性。** 这是反复"以为修好"的总根源。
2. **登录态/跨域问题必须用真实浏览器验证**，curl 体现不了 iframe origin、Cookie 域名隔离、跨域 JS 异常。本项目 Playwright + chromium 已可用。
3. **先分清"后端鉴权"和"前端跨域"**：浏览器直接 fetch status 若 `loggedIn:true` 而 iframe 内显示未登录 → 100% 是 iframe 跨域，别再改 server.js。

### 步骤 3.5 搜索功能（一个典型「插件+模板」配合）
- **现象**：装了官方「搜索组件」插件，导航栏出现搜索图标，但点进去 404
- **原因**：插件是**弹框式**的，本身没有搜索页；主题又没有 `search.html` 模板去接 `/search` 这个路由
- **解决**：在 `templates/` 下补一个 `search.html`，内容负责打开时自动唤起弹框
- **✅ 成功标志**：点搜索图标 → 弹框出现 → 输入关键词有结果

---

# Phase 3 · 本地大模型（Ollama + Open WebUI）

> 目标：NAS 上跑一个**完全不出网**的中文问答模型，后面挂到博客上。

### 步骤 4.1 先算内存账（专业感来源）
- 本项目基线：总内存 16GB，可用 11GB，Swap 0
- 预算：**Ollama 4GB + WebUI 1.5GB = 5.5GB**，给 Halo 留 1GB，系统留 4GB
- **结论**：16GB 机器上 **1.7B 模型稳跑，4B 勉强，7B 不要想**

### 步骤 4.2 写编排文件（不要用应用中心一键装）
- **为什么**：一键装**不带资源护栏**，模型一加载能把整机内存吃光，Halo 一起崩
- **做法**：`docker-compose.yml` 里给两个服务都写 `mem_limit` 和 `cpus`
```yaml
services:
  ollama:
    image: docker.m.daocloud.io/ollama/ollama:latest
    ports: ["11434:11434"]
    volumes: ["/vol1/ai/ollama:/root/.ollama"]
    environment:
      - OLLAMA_ORIGINS=*      # 允许网页跨域调用（必须）
    mem_limit: 4g
    cpus: 2.0
  open-webui:
    image: ghcr.m.daocloud.io/open-webui/open-webui:main
    ports: ["3000:8080"]
    volumes: ["/vol1/ai/webui:/app/backend/data"]
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434
      - HF_ENDPOINT=https://hf-mirror.com   # 国内必须，否则启动卡 HuggingFace
    mem_limit: 1536m
    cpus: 1.0
    depends_on: [ollama]
```
- **✅ 成功标志**：`docker ps` 两个容器都 `healthy`；`docker stats` 内存不超过上限

### 步骤 4.3 部署（三种方式，按可靠性排序）
1. **SSH + `docker compose up -d`** ← 最稳，推荐
2. 1Panel 自定义编排 ← 界面友好，但 fnOS 上可能报「服务内部错误」（本项目踩过）
3. 应用中心一键装 ← **不推荐**，无资源护栏

### 步骤 4.4 拉模型 + 测速
```bash
sudo docker exec -it ollama ollama pull qwen3:1.7b
```
- **实测**：纯 CPU（2 核 4 线程）**11.51 tokens/s**，打字机速度，够用
- **✅ 成功标志**：`docker exec ollama ollama list` 能看到模型

### 步骤 4.5 中文化调优（这一步决定能不能用）
| 问题 | 现象 | 解决 |
|---|---|---|
| 回答英文 | 中文提问回英文 | 系统提示词首行写「始终使用简体中文回答」 |
| 疯狂调工具 | 简单问题也去搜网页 | 模型预设里**关掉全部工具/能力/内置工具 + 关闭 Function Calling** |
| 思考模式拖慢/乱输出 | 回答前一大段 think | 提示词末尾加 `/no_think`（1.7B 不支持参数开关，只能软关） |
| 胡说八道 | 不知道的也编 | 挂知识库 + 提示词写「知识库里没有就说不清楚」 + 温度降到 0.6 |

### 步骤 4.6 建知识库
- **做什么**：Open WebUI → 知识库 → 上传一篇 `自我介绍与FAQ.md`（介绍自己、博客、常见问题）
- **关键**：知识库要挂在**模型级**（模型预设里绑定），不是每次对话手动挂
- **⚠️ 坑**：改完预设后，**旧对话不会继承新配置**，必须新开对话测试

### 步骤 4.7 验证「不出网」
- 断掉 NAS 外网（或路由器停掉 WAN），再问模型问题
- **✅ 成功标志**：照样能答 → 证明是**真本地**，数据不出机器（这是笔记的大卖点）

---

# Phase 4 · 把 AI 装进博客

### 步骤 5.1 写一个独立聊天页（单文件 HTML）
- **为什么**：单文件零依赖，直接调 Ollama 的 `/api/chat`，不用后端、不用密钥
- **核心三行**：
```js
var API = 'http://<NAS_IP>:11434/api/chat';
var MODEL = 'qwen3:1.7b';
// system 提示词：语言锁定 + 只依据知识库 + 禁编造 + 简洁 300 字 + /no_think
```
- **知识库内容**：直接写在前端 JS 常量里（几百字以内完全够用，省掉 RAG 复杂度）

### 步骤 5.2 文件放哪里（本项目最大的坑，值得单独一图）
- ❌ 放 `themes/theme-luye/assets/chat.html` → **永远 404**
- ✅ 放 `themes/theme-luye/templates/assets/chat.html` → 200
- **原因**：Halo 主题静态资源**只认 `templates/assets/`**，根目录的 assets 不参与路由
- **✅ 成功标志**：`curl -I https://<DOMAIN>/themes/theme-luye/assets/chat.html` 返回 200

### 步骤 5.3 上传文件的正确姿势（别再用长粘贴）
**❌ 错误示范**：SSH 里粘贴一大段 `cat > file << 'EOF' ...` → 中文/长文本被截断 → 终端卡在 `>` 提示符 → 后面输入的命令全被吞（本项目真踩过）

**✅ 正确三步**：
```bash
# 1) Windows 上传到临时目录
scp D:\blog-chat.html <SSH_USER>@<NAS_IP>:/tmp/chat.html

# 2) NAS 上挪到目标目录
sudo mv /tmp/chat.html /var/apps/docker-halo/var/halo2/themes/theme-luye/templates/assets/chat.html

# 3) 新增主题静态文件后重启，让 Halo 重新扫资源
sudo docker restart halo
```
- **卡住了怎么救**：`Ctrl + C` 退出 `>` 续行，再用 `echo ok` 确认回到 `$` 提示符

### 步骤 5.4 在 Halo 建「AI 问答」页面
1. 后台 → 页面 → 新建，标题 `AI 问答`
2. 发布设置 → 别名填 `ai`（决定地址 `/ai`）
3. 允许评论**取消勾选**
4. 编辑器切源码模式，粘 iframe：
```html
<iframe src="/themes/theme-luye/assets/chat.html"
  style="display:block;width:100%;height:82vh;min-height:640px;border:0;border-radius:12px;"></iframe>
```
5. 先**保存草稿**

### 步骤 5.5 混合内容限制（必须写进教程，否则读者一定踩）
- 现象：公网 https 页面里点发送 → `连接失败: Load failed`
- 原因：① 内网 IP 外网路由不到 ② **https 页面请求 http 接口被浏览器拦截**（mixed content）
- **结论**：**这套方案目前只能内网用**；公网要等有了域名做反向代理，把 `/ai-api/` 转发到 `ollama:11434`，前端 API 改成：
```js
var API = location.protocol === 'https:'
  ? '/ai-api/api/chat'
  : 'http://<NAS_IP>:11434/api/chat';
```

---

# Phase 5 · 下一步（公网化路线）

1. 买域名（阿里云/腾讯云，几十元/年）
2. 域名托管到 Cloudflare → **Cloudflare Tunnel**（免费，不再受花生壳 1Mbps/1GB 限制）
3. 同域反向代理：`/` → Halo:28090、`/ai-api/` → Ollama:11434
4. 前端 API 改相对路径 → **公网也能对话**
5. 顺便上 HTTPS 证书自动续期（CF 自带）

---

# 附录 A · 故障速查表（做成一张长图）

| 现象 | 先查什么 | 真实原因（本项目） |
|---|---|---|
| 浏览器打不开博客 | 端口映射 | fnOS 把 8090 改成 28090 |
| 提示符是 `>` 且命令没反应 | 是否卡在 heredoc | 长粘贴被截断，`Ctrl+C` 退出 |
| Windows 里 sudo 报错 | 提示符是 `C:\>` 还是 `user@nas:/$` | 你在自己电脑上，不在 NAS |
| 后台改配置不生效 | 是不是只「重启」没「重建」 | 运行时配置只读，必须重建容器 |
| 主题装完 500 | 主题要求的 Halo 版本 | 版本不兼容，切回默认主题 |
| 拉镜像超时 | 是否走了国内加速源 | 用 `docker.m.daocloud.io` / `ghcr.m.daocloud.io` 前缀 |
| WebUI 启动 503 / unhealthy | 日志里有没有 HuggingFace 报错 | 加 `HF_ENDPOINT=https://hf-mirror.com` |
| AI 回答英文/乱调工具 | 模型预设 | 语言锁定 + 关工具 + `/no_think` |
| 新加的主题文件 404 | 文件在哪个目录 | 必须放 `templates/assets/` |

# 附录 B · 命令速查

```bash
sudo docker ps                                  # 看容器
sudo docker inspect halo --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'   # 看挂载
sudo docker exec halo ls /root/.halo2/themes/    # 看主题目录
sudo docker logs --tail 50 open-webui            # 看日志
sudo docker stats --no-stream                    # 看内存占用
sudo docker restart halo                         # 重启（不重建）
```

---

# 附录 C · 小红书发布方案

### 标题（三选一）
1. `用一台 NAS 搭博客 + 本地 AI，全年 0 元`
2. `不买服务器！NAS 建站 + 私有 AI 问答全流程`
3. `零基础也能做：NAS 博客 + 本地大模型接入教程`

### 封面文案建议
- 主标题：**NAS 建站 + 私有 AI**
- 副标：`零成本 · 不出网 · 小白可复刻`
- 底条：`飞牛 fnOS × Halo × Ollama`

### 9 图顺序（对应截图点）
1. 封面（成品博客首页）
2. FNos 后台总览 + 硬件配置
3. Halo 后台写文章界面
4. 美化前后对比（主题 + 横幅图）
5. 花生壳映射列表（标注「管理端口绝不映射」）
6. AI 对话成品截图（内网）
7. 知识库页面 + 模型预设参数
8. 手机外网访问博客（证明穿透成功）
9. 成本清单 / 时间清单表格

### 正文结构（控制在 900 字内）
1. 一句话结论 + 成本
2. 三步概览（装系统 → 建博客 → 挂 AI）
3. 最容易踩的 3 个坑（端口改写 / 长粘贴中断 / 静态资源目录）
4. 引导：「完整命令和踩坑表放在博客里，评论区回复『教程』发你链接」

### 标签
`#NAS` `#飞牛fnOS` `#自建博客` `#本地大模型` `#Ollama` `#Halo博客` `#内网穿透` `#私有化部署` `#AI工具` `#零基础教程` `#数码折腾` `#homelab`

### 发布注意
- 全文使用脱敏占位符，**不出现真实内网 IP / 壳域名 / 公司信息**
- 别说「免费版无限用」，如实写 1Mbps / 1GB 月
- 别写「破解 / 白嫖 / 绕过」
- 强调「数据不出本机」是最大差异化卖点
