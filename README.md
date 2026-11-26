# 飞牛 NAS 博客 + 鉴权 AI 机器人 + 本地大模型

一套跑在 NAS 上的完整方案：**Halo 博客**（对外可访问）+ **带登录鉴权与配额控制的 AI 机器人** + **本地大模型（Ollama + Open WebUI）**。

- 博客访客无需登录即可浏览；机器人必须登录 Halo 才能对话。
- 新用户登录送 1 次对话；发布文章审核通过 +1、评论审核通过 +1（各去重）；管理员不限次数。
- DeepSeek API 密钥只放在服务端 `.env`，前端零密钥、零签名。
- 内外网共用同一入口，花生壳映射只需一条。

> 本仓库是「可复现搭建包」：占位符已用 `<...>` 标出，按第 0 步替换即可。项目真实部署中踩过的所有坑、修复过程与验证方法，见 `PROJECT.md` 的弯路复盘；分步骤图文素材见 `TUTORIAL.md`。

---

## 目录结构

```
.
├── README.md                    ← 你现在看的：从零搭建主流程
├── PROJECT.md                   ← 完整历程 + 弯路复盘（排障时查）
├── TUTORIAL.md                  ← 分步骤教程素材（写图文用）
├── PLAN-BOT.md / PLAN-LLM.md    ← 机器人 / 大模型方案设计
├── deploy/
│   ├── ai-compose.yml           ← Ollama + Open WebUI 编排
│   ├── ai-baseline.md           ← AI 资源基线记录
│   ├── blog-chat.html           ← 旧版内嵌聊天页（可选）
│   ├── webui-system-prompt.md   ← WebUI 系统提示词
│   ├── theme-customize-commands.md ← 主题定制命令
│   └── bot/                     ← 鉴权机器人全部文件
│       ├── server.js             服务端（鉴权/配额/DeepSeek 转发）
│       ├── api-bot.html          前端（零密钥、同源请求）
│       ├── nginx.conf            统一入口（28090 分流）
│       ├── docker-compose.yml    两个容器编排
│       ├── .env.example          环境变量模板（填密钥）
│       ├── DEPLOY.md             部署与运维速查
│       └── _selftest_v5.js       本地全链路自测（18 项）
└── assets/
    ├── blog-home-banner.jpg     主题背景素材（AI 原创）
    ├── hero-banner-*.jpg        首页横幅素材（AI 原创）
    └── knowledge/
        └── 自我介绍与博客FAQ.md   知识库示例文本（请改成你自己的）
```

---

## 第 0 步：准备与占位符替换（必做）

### 你需要准备
1. 一台 NAS（本方案基于飞牛 fnOS，其他 Linux + Docker 环境同样适用）。
2. 一个花生壳账号与免费壳域名（形如 `xxx.vicp.fun`），用于外网访问。
3. 一个 DeepSeek API 密钥（在平台控制台申请）。
4. 一台电脑，能用 SSH 连接 NAS。

### 占位符对照表

| 占位符 | 含义 | 示例 |
|---|---|---|
| `<NAS_IP>` | NAS 局域网 IP | `192.168.1.100` |
| `<用户名>` | NAS 的 SSH 用户名 | `mynas` |
| `<你的壳域名>` | 花生壳给的域名（不含 https://） | `abc123.vicp.fun` |
| `<你的管理员账号>` | Halo 后台用户名 | `admin` |
| `<测试用户名>` | 用于自测的普通账号 | `testuser` |

**替换方法**：下载本仓库后，在所有 `.md`/`.conf`/`.js`/`.html` 文件中，把上表左侧的占位符全文替换成你自己的值。重点文件是 `deploy/bot/nginx.conf`（第 62/63/90/91 行的 `sub_filter` 域名）和 `DEPLOY.md`、`TUTORIAL.md` 中的访问地址。

> 若你只跑内网、暂时不用外网，可以先跳过域名替换，`nginx.conf` 里带域名的 `sub_filter` 规则不影响内网使用。

---

## 第 1 步：部署 Halo 博客

1. 在 fnOS 应用中心安装 **Halo**（本方案实测版本 2.27.3）与 **PostgreSQL**。
2. 安装后进入 Halo 后台，完成初始化，**把对外端口设为 `28091`**（fnOS 会把容器内 8090 映射成对外端口，请以容器详情里的端口映射行为准）。全新安装直接设 28091 即可，无需第 3.2 步迁移；若你之前已按旧教程装在 28090，再按第 3.2 步迁移。
3. 后台开启：用户注册、评论、允许注册用户投稿/发文章（机器人配额规则依赖这三项）。
4. 新建页面 `/ai`（可选，用于旧版聊天页），如需 iframe 用源码模式粘贴。
5. 记下 Halo 数据卷路径（本方案为 `/var/apps/docker-halo/var/halo2`，数据都在这里）。

✅ 成功标志：浏览器打开 `http://<NAS_IP>:28091` 能看到博客首页（此时 28090 还没启用，属正常）。

---

## 第 2 步：花生壳外网穿透

1. 在 NAS 上安装花生壳客户端并登录。
2. 新建一条映射：**HTTPS** → 内网地址 `127.0.0.1` → 端口 **`28090`**。
3. ⚠️ **安全铁律**：删除任何指向管理后台 `5666`、SSH `22`、AI 服务 `3000`/`11434` 的映射，只保留上面这一条。

✅ 成功标志：手机流量打开 `https://<你的壳域名>` 能看到博客首页。

---

## 第 3 步：部署鉴权 AI 机器人

### 3.1 准备目录与密钥

在 NAS 上建目录并把 `deploy/bot/` 下 6 个文件上传到 `/vol1/bot/`：

```
server.js  api-bot.html  nginx.conf  docker-compose.yml  .env.example  _selftest_v5.js
```

复制环境变量模板并填写：

```bash
cd /vol1/bot
cp .env.example .env
vi .env
```

`.env` 中至少填两项：
- `DEEPSEEK_KEY=sk-你的密钥`
- `HALO_PAT=pat_你的令牌`（在 Halo 后台 → 头像 → 个人中心 → 个人令牌新建，**权限只勾「评论 → 评论查看」，角色一个都不要勾**）

> `SYSTEM_PROMPT` 必须写在一行内，不要换行。

### 3.2 把 Halo 挪到内部端口 28091（仅旧部署需要）

因为 `28090` 要交给机器人网关 nginx 做统一分流，Halo 本体应监听 `28091`。**第 1 步已直接装成 28091 的，本步跳过**；只有原来装在 28090 的才需要迁移（数据卷原样挂载，数据零丢失）：

```bash
# 停止并删除旧 Halo 容器（务必先确认数据卷路径！）
sudo docker stop halo && sudo docker rm halo
# 用原参数重建，仅把端口映射改为 28091:8090，容器名仍为 halo
sudo docker run -d --name halo -p 28091:8090 \
  -e JVM_OPTS="-Xms256m -Xmx512m" \
  -v /var/apps/docker-halo/var/halo2:/root/.halo2 \
  --restart unless-stopped \
  <你原来的halo镜像名>
```

> ⚠️ 重建前请先 `sudo docker inspect halo > halo-inspect-before.json` 保存原参数，按原参数修改端口即可，不要照抄上面的镜像名与 JVM 参数。详细做法见 `PROJECT.md` Phase 7 F 节。

### 3.3 启动机器人容器

```bash
cd /vol1/bot
sudo docker compose up -d --force-recreate
```

✅ 看到 `Recreated` / `Started`。此时四个容器应为：`halo`、`halo-halodb-1`、`bot-api`、`bot-nginx`。

### 3.4 验证

```bash
curl -s http://127.0.0.1:28090/bot-api/health
curl -s https://<你的壳域名>/bot-api/health
```

✅ 两条都返回 `{"ok":true,"model":"deepseek-flash","ver":"v5"}`。

浏览器验证（关键）：打开 `https://<你的壳域名>/bot`，管理员登录后徽标显示「管理员·不限次数」，连问 3 次都正常。

> 本地自测：在 `deploy/bot/` 目录运行 `node _selftest_v5.js`，应 **18/18 全通过**。它会在内存里模拟 Halo 与 DeepSeek，不碰你的真实数据。

### 3.5 统一入口原理（重要）

- 外部只有一个端口 `28090`（花生壳也只映射这一个）。
- `bot-nginx` 在 `28090`（和备用 `18080`）按路径分流：`/bot*`、`/bot-api*` → 机器人；其余 → Halo(`28091`)。
- `/bot` 由 nginx 直接静态托管前端，**不需要在 Halo 里建页、不需要 iframe、不需要破缓存**。
- ❌ 不要把 Halo 启回 `28090`（会抢端口）；❌ 不要去花生壳改映射端口（云端规则，也不需要改）。

---

## 第 4 步：部署本地大模型（可选，但推荐）

```bash
# 在 NAS 上建 /vol1/ai，上传 deploy/ai-compose.yml
cd /vol1/ai && sudo docker compose up -d
```

- Ollama 监听 `11434`，Open WebUI 监听 `3000`，均**仅内网可访问**。
- 下载模型：`sudo docker exec ollama ollama pull qwen3:1.7b`
- 打开 `http://<NAS_IP>:3000` 使用 WebUI，可导入 `assets/knowledge/` 下的知识库文本。

⚠️ **安全铁律**：`11434` 和 `3000` 绝不做花生壳映射，否则算力会被白嫖、聊天数据泄露。

---

## 第 5 步：主题美化（可选）

`assets/` 下的横幅图为 AI 原创素材。三张 JPG 可直接放入 Halo 主题目录使用。具体规格与定制命令见 `deploy/theme-customize-commands.md` 与 `PROJECT.md` 主题章节。

---

## 常见问题速查

| 现象 | 处理 |
|---|---|
| health 没有 `"ver":"v5"` | `cd /vol1/bot && sudo docker compose up -d --force-recreate` |
| 一直显示「未登录」 | 在**同一域名**下重新登录；确认 nginx 有 `proxy_set_header Host $host` |
| 内网已登录但机器人未登录 | 检查 `nginx.conf` 中 `sub_filter` 域名是否替换；且必须有 `proxy_set_header Accept-Encoding "";` 关闭上游 gzip（curl 不带 gzip 会假阳性，务必用真实浏览器验证） |
| 改了前端没生效 | 前端有两处：`/vol1/bot/api-bot.html`（服务 `/bot`）与 Halo 主题目录（服务 `/ai` iframe），改 `/bot` 只需覆盖前者即可 |
| 评论后次数不增加 | 确认 PAT 只勾「评论查看」；确认 `server.js` 含 `asComment()`（兼容 Halo 评论 API 的嵌套结构）；直接读账本 `/app/data/ledger.json` 看 remaining |
| AI 答非所问 | 检查 `.env` 的 `SYSTEM_PROMPT` 是否单行；`docker exec bot-api printenv SYSTEM_PROMPT` 确认已生效 |
| 502 Bad Gateway | `sudo docker logs bot-api` 看日志 |

完整排障与所有踩坑记录见 `PROJECT.md` 末尾的弯路复盘表，以及 `deploy/bot/DEPLOY.md` 的常见问题章节。

---

## 运维命令速查

```bash
cd /vol1/bot
sudo docker compose logs -f bot-api                    # 看服务端日志
sudo docker compose up -d --force-recreate             # 改了 server.js/nginx.conf 后必须
sudo docker compose restart bot-api                    # 仅改 .env 后可用
cat /vol1/bot/data/ledger.json                         # 查看配额账本（唯一真相）
sudo cp -p /vol1/bot/data/ledger.json /vol1/bot/data/ledger.json.bak.$(date +%Y%m%d)  # 备份账本
```

---

## 安全清单（部署后逐条确认）

- [ ] 花生壳只映射 `127.0.0.1:28090` 一条，`5666`/`22`/`3000`/`11434` 未映射
- [ ] `.env` 含真实密钥但**从不提交到任何仓库**（本仓库只有 `.env.example` 模板）
- [ ] 前端源码里搜不到 `sk-` 或签名逻辑
- [ ] Halo  PAT 权限只包含「评论查看」
- [ ] 登录态测试：管理员不限次、新用户 1 次、用完拦截

---

## 关于隐私

本仓库已做全量脱敏：不含任何真实 IP、域名、账号、密钥、个人简历或头像。文档中的 `<...>` 均为占位符。若你fork后加入自己的配置，请注意 `.env` 永远不要提交。
