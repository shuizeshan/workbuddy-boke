# AI 部署基线快照（2026-11-23 15:19 实测，SSH 来源）

> 用途：AI 服务部署/运行后，随时对照此表验证「未影响 NAS 日常服务」。

## 阶段A实测结果（2026-11-23 15:57 验收通过）
- Qwen3:1.7b 速度：**11.51 tokens/s**（≈12-14字/秒），prompt 处理 30 tok/s，首答延迟<1s → 远超 5 tok/s 闸门，无需降级
- 实测命令：`sudo docker exec ollama ollama run qwen3:1.7b "/no_think <提示词>" --verbose`（/no_think 必带，思考模式速度减半）
- 部署方式：1Panel 创建编排报「服务内部错误」（fnOS 路径映射兼容问题）→ 改用 SSH `docker compose up -d`（编排文件 `/vol1/ai/docker-compose.yml`）；容器仍会出现在 1Panel 容器列表（来源=本地）可正常监控


| 项 | 部署前实测值 | 说明 |
|---|---|---|
| 内存总量 | 15Gi | — |
| 内存已用 | **4.0Gi**（可用 11Gi） | AI 预算 5GB 占可用约 45% |
| Swap | 4Gi，**使用 0B** | 健康标志：部署后 Swap 若大量使用=内存吃紧报警 |
| CPU | Gold 6500Y，**4 逻辑核** | 实际 4 线程（好于预估 2 线程），推理速度预期上调：1.7B 约 8-15 字/秒 |
| Halo 容器 | CPU 0.23%，MEM 704MiB | 博客正常负载 |
| halodb 容器 | CPU 0.01%，MEM 96MiB | 数据库极轻 |
| 磁盘 /vol1 | 413G，已用 49G（12%），余 364G | AI 全套约占 6GB（2.5%），无压力 |

## 对照检查法（部署后任一时间在 SSH 执行）
```bash
sudo docker stats --no-stream && free -h
```
判定标准：
- Halo MEM 明显 > 1Gi 或系统 Swap 使用 > 1Gi → AI 抢资源，回看 Ollama 限制是否生效
- 日常文件服务变卡 → `cpus 2.0` 限制未生效，需要排查
