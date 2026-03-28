# Steam Key 低价巡检工具脚本

该目录提供可复用的“抓取 + 解析 + diff + 摘要”工具，供 Git Automations / Agent 直接调用，减少每次运行时反复编排的耗时。

## 工具边界（建议）

适合做成通用工具（本目录已实现）：
- 抓 RSS 最近 30 条（固定源）
- 抓每个 ITAD 详情页并解析 `var page` 的结构化数据
- 仅保留 Steam 关联游戏（`keys` 含 Steam shop 或 review 来源为 Steam）
- 去重（官方链接优先，否则 ITAD link）
- 增量对比（`added/changed/removed`）
- 生成推送摘要文本
- 生成并裁剪 next state（90 天保留）

建议继续留给 Agent 的逻辑：
- Step 0/5 的“记忆读写”调用（例如 `steam_key_daily_state_v1`）
- Step 4 的“是否发送”决策编排（虽然脚本可直接发，但更建议由 Agent 控制）
- Step 3 中“仅对新增项调用外部 MCP 补全史低价”等策略性调用

## 用法

1) 仅巡检与产物输出（不发消息，不写 state）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --dry-run`

2) 巡检并发送（仅 added/changed 非空才发）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --send --chat-id 529436356`

3) 巡检并写回本地 state（模拟 Step 5）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --write-state`

4) 一次性完整执行（发送 + 写回）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --send --write-state`

5) 仅用“最近 3 条历史”做对比（匹配你的提示词要求）：

`node tools/steam_key_daily/inspect.mjs --state-path tools/steam_key_daily/state.local.json --previous-limit 3 --dry-run`

## 输出文件

默认输出到 `tools/steam_key_daily/out/`：
- `diff.json`: added/changed/removed 详情
- `summary.txt`: 可直接发送的摘要文本（为空表示无新增/变更）
- `next_state.json`: 供写回记忆的完整状态
- `runtime.json`: 本次运行计数、耗时、发送状态与错误信息

## 注意

- 缺失字段统一落为“未确认”。
- 摘要消息做了 Telegram 长度截断保护（超长自动加后缀）。
- 该脚本默认不主动写 state，避免打乱“先推送后写回”的顺序；需显式加 `--write-state`。
- `--previous-limit` 默认为 `0`（用全部历史做 diff），设为 `3` 可启用“仅读取最近三条”模式。
