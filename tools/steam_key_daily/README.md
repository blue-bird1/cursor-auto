# Steam Key 低价巡检工具脚本

该目录提供可复用的「抓取 + 解析 + 国区史低过滤 + diff + 摘要 + 可选 Telegram」流水线，供定时任务或 Cursor Agent 调用。

## 自动化 Agent 提示词（本仓库）

你是 **Steam Key 低价巡检 Agent**。在 Cursor / 定时环境中执行本仓库脚本完成日报，不要手写编造价格或游戏列表。

**固定命令（记忆文件路径由你映射到外部「记忆」存储；本地开发用 `tools/steam_key_daily/state.local.json`）：**

```bash
# 将 <STATE_JSON> 替换为记忆键 steam_key_daily_state_v1 对应的文件路径
export ITAD_API_KEY="…"   # 必填：否则无法判定「值得买」、且不会推送（避免误报）
./scripts/steam_key_daily.sh --state-path <STATE_JSON> --send --write-state --chat-id 529436356
```

**顺序（脚本已遵守）：** 读 `--state-path` → 抓 RSS 与 ITAD 详情 → 对 **新增/变更** 捆绑包请求 ITAD `games/historylow/v1`（`country=CN`，国区史低 CNY）→ 仅当存在 **值得买** 的新增或变更时调用 `./scripts/telegram.sh send` → 再写回 state。

**「值得买」规则（默认）：** 至少一个 Tier 的档位价（CNY）≤ 该 Tier 内各 Steam 游戏 **国区史低之和** × `--min-savings-ratio`（默认 `0.95`）。缺 Key、API 失败或某款史低缺失时，该次新增/变更 **不推送**（`runtime.json` 中可见原因）。关闭过滤：`--no-value-filter`。

**记忆 JSON 键名：** `steam_key_daily_state_v1`；结构与脚本写入的 state 一致（`last_run_at` + `bundles[]`）。脚本默认使用**全量历史**做 diff；仅在**首次空记忆**时才用 `--previous-limit`（默认 **3**）限制首跑摘要范围，避免推送大量陈旧信息。

**数据源：** RSS `https://isthereanydeal.com/feeds/CN/CNY/bundles.rss`；明细为各 `item.link`；官方链接来自详情 `liveData.url`。

## 工具已实现能力

- 抓 RSS 最近 30 条（固定源）
- 抓每个 ITAD 详情页并解析 `var g` / `var page` 的结构化数据
- 仅保留 Steam 关联游戏（`keys` 含 Steam shop 或 review 来源为 Steam）
- 去重（官方链接优先，否则 ITAD link）
- 对 **added/changed** 调用 ITAD History Low（CN / CNY），摘要中展示每款史低
- 按国区史低总和过滤「值得买」档位后再推送
- 增量对比（默认全量历史；首次空记忆可限制最近 N 条）
- 生成推送摘要文本（Tier 下列出全部游戏，不截断）
- 生成并裁剪 next state（保留当前在售 + 最近 90 天见过的已结束活动）

## 用法

1) 仅巡检与产物输出（不发消息、不写 state）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --dry-run`

2) 巡检并发送（仅 **值得买** 的新增/变更才发；需 `ITAD_API_KEY`）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --send --chat-id 529436356`

3) 巡检并写回本地 state：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --write-state`

4) 一次性完整执行（发送 + 写回）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --send --write-state`

5) 首次空记忆时，用「最近 N 条」限制首跑摘要范围（默认 **3**；`0` 表示全量）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --previous-limit 3 --dry-run`

6) 调整史低阈值（例如档位价须 ≤ 史低总和的 90%）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --min-savings-ratio 0.9 --dry-run`

## 输出文件

默认输出到 `tools/steam_key_daily/out/`：
- `diff.json`: added/changed/removed 详情
- `summary.txt`: 可直接发送的摘要文本（为空表示无新增/变更）
- `next_state.json`: 供写回记忆的完整状态
- `runtime.json`: 本次运行计数、耗时、发送状态与错误信息

## 注意

- 缺失字段统一落为「未确认」。
- 摘要消息做了 Telegram 长度截断保护（超长自动加后缀）。
- 脚本默认不主动写 state；需显式加 `--write-state`。发送发生在写回之前。
- `--previous-limit` 默认为 `3`；脚本仍默认用全部历史做 diff，仅在首次空记忆时把它作为首跑限制。
- 环境变量：`ITAD_API_KEY`（或 `ISTHEREANYDEAL_API_KEY` / `APIKEY`）用于史低与价值过滤。
