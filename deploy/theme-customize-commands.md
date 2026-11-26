# theme-luye 主题定制命令存档

> 用途：主题升级/重装后改动会丢失，按需重跑对应命令。
> 前置：fnOS 开启 SSH → 电脑 `ssh <用户名>@<NAS_IP>` 登录。

## 一、身份文案替换（数字化管理师系列，2026-11-21 已执行）

替换 5 处：hero 眉标/大标题/简介、关于我 bio、页脚标语。

```bash
sudo python3 - <<'PY'
import pathlib, shutil, datetime
root = pathlib.Path('/var/apps/docker-halo/var/halo2/themes')
pairs = [
 ("SOFTWARE &amp; AI ENGINEER · 软件与人工智能工程师", "DIGITAL MANAGEMENT SPECIALIST · 数字化管理师"),
 ("在代码与智能之间，造一片绿野", "用流程与数据，把复杂变简单"),
 ("这里收录我的开源作品、技术随笔与实验——关于工程，关于智能，也关于如何把复杂变简单。", "这里记录我在企业流程数字化、OA 审批与智能表格上的实践与思考。"),
 ("软件与人工智能工程师。在控制系统、接口测试与开源工具之间游走，相信把复杂变简单是工程的美德。", "数字化管理师。在企业流程、审批与数据之间搭桥，相信把复杂变简单是管理的功夫。"),
 ("写代码，也写思考。", "把复杂，变成标准。"),
]
for f in root.rglob('*.html'):
    try: t = f.read_text(encoding='utf-8')
    except Exception: continue
    if '软件与人工智能工程师' not in t and 'SOFTWARE' not in t: continue
    bak = f.with_suffix(f.suffix + '.bak-' + datetime.datetime.now().strftime('%Y%m%d%H%M'))
    shutil.copy2(f, bak)
    print('文件:', f); print('备份:', bak)
    for a,b in pairs:
        n = t.count(a)
        if n: print('  替换', n, '处:', a[:26], '...')
        t = t.replace(a,b)
    f.write_text(t, encoding='utf-8')
print('处理完成')
PY
```

执行后：`sudo docker restart halo`（清模板缓存），等 1 分钟验证。

## 二、搜索页 search.html（2026-11-21 新增，待执行）

背景：已装官方「搜索组件」插件（PluginSearchWidget v1.8.0，弹框式搜索）；
主题设置「搜索页链接」填了 `/search`，但主题缺 search.html 模板导致 404。
本命令补一个模板：打开 /search 自动唤起搜索弹框。

```bash
sudo tee /var/apps/docker-halo/var/halo2/themes/theme-luye/templates/search.html > /dev/null <<'EOF'
<!DOCTYPE html>
<html lang="zh" xmlns:th="https://www.thymeleaf.org">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>搜索 - 水泽山</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#0d1512;color:#cfe3d8;font-family:system-ui,sans-serif}
    .tip{text-align:center}
    .tip a{color:#7ec8e3;text-decoration:none}
  </style>
</head>
<body>
  <div class="tip">
    <p>正在打开搜索…</p>
    <p>若未弹出，请 <a href="/">返回首页</a> 后按 Ctrl + K</p>
  </div>
  <th:block th:if="${pluginFinder.available('PluginSearchWidget')}">
    <script th:src="@{/plugins/PluginSearchWidget/assets/static/search-widget.iife.js}"></script>
    <script>
      window.addEventListener('load', function () {
        if (window.SearchWidget && SearchWidget.open) { SearchWidget.open(); }
      });
    </script>
  </th:block>
</body>
</html>
EOF
echo "已创建" && sudo ls -la /var/apps/docker-halo/var/halo2/themes/theme-luye/templates/ | grep search
```

执行后：`sudo docker restart halo`，等 1 分钟，点导航栏搜索图标应弹出搜索框。

## 三、收尾（每次用完 SSH 后）

```bash
exit
```
→ fnOS 系统设置 → SSH → 关闭。
