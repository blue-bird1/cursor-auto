# Telegram 自用 CLI 工具

你说得对：这里不是要做“库发布”，而是要做**仓库内自用工具**。  
本仓库现在提供 `scripts/telegram.sh`，用于在 Cursor 自动化环境下直接调用 Telegram Bot API（无需 MCP）。

## 目标

在 `telegram mcp` 失效时，提供同等核心能力的 CLI：

- `send-message`（发消息）
- `get-chat-info`（查群/频道信息）
- `forward-message`（转发）
- `pin-message`（置顶）
- `get-chat-admins`（管理员列表）

## 快速开始（自用优先）

```bash
npm install
cp .env.example .env
# 编辑 .env，填好 TELEGRAM_BOT_TOKEN（可选 TELEGRAM_DEFAULT_CHAT_ID）
```

直接使用脚本：

```bash
./scripts/telegram.sh help
./scripts/telegram.sh send --text "hello"
```

> `send` 是 `send-message` 的别名；如果 `.env` 里配置了 `TELEGRAM_DEFAULT_CHAT_ID`，可以省略 `--chat-id`。

## 环境变量

`.env.example`：

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_DEFAULT_CHAT_ID=
```

- `TELEGRAM_BOT_TOKEN`：必填
- `TELEGRAM_DEFAULT_CHAT_ID`：可选，自用场景推荐设置（可让常用命令不用反复写 chat id）

## 命令示例

### 发消息

```bash
./scripts/telegram.sh send --text "任务完成"
./scripts/telegram.sh send --chat-id @mychannel --text "Hello from CLI"
```

### 查信息

```bash
./scripts/telegram.sh info
./scripts/telegram.sh info --chat-id @mychannel
```

### 转发

```bash
./scripts/telegram.sh forward-message \
  --from-chat-id @source_channel \
  --to-chat-id @target_channel \
  --message-id 123
```

### 置顶

```bash
./scripts/telegram.sh pin --message-id 123
```

### 管理员列表

```bash
./scripts/telegram.sh admins --limit 10
```

## 输出

统一 JSON 输出，便于自动化脚本处理：

- 成功：`{ "success": true, ... }`
- 失败：`{ "success": false, "error": "..." }`

## 说明

- 这是仓库内工具，不依赖发布到 npm。
- 你和自动化任务都可以直接调用 `./scripts/telegram.sh ...`。

## Steam Key 低价巡检工具（新增）

为降低自动化 Agent 每次运行的编排开销，新增了通用巡检脚本目录：

- `tools/steam_key_daily/inspect.mjs`
- `scripts/steam_key_daily.sh`

快速示例：

```bash
# 仅演练（不发消息、不写回）
./scripts/steam_key_daily.sh --state-path tools/steam_key_daily/state.local.json --dry-run

# 有新增/变更时发送到默认 chat，并写回本地状态
./scripts/steam_key_daily.sh --state-path tools/steam_key_daily/state.local.json --send --write-state
```

详细字段、输出文件与边界说明见：

- `tools/steam_key_daily/README.md`
