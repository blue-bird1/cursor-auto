# telegram-bot-cli

在 Cursor 自动化环境中，作为 `telegram mcp` 不可用时的替代方案，本项目提供一个 **CLI 工具**，实现与 `@iqai/mcp-telegram` 核心能力等效的 Telegram Bot 操作。

## 功能对照（CLI 等效能力）

- `SEND_MESSAGE` -> `send-message`
- `GET_CHANNEL_INFO` -> `get-chat-info`
- `FORWARD_MESSAGE` -> `forward-message`
- `PIN_MESSAGE` -> `pin-message`
- `GET_CHANNEL_MEMBERS`（管理员列表）-> `get-chat-admins`

> 说明：这里实现的是 **命令行工具**，不依赖 MCP 协议运行。

## 环境要求

- Node.js 18+
- Telegram Bot Token（从 [@BotFather](https://t.me/botfather) 获取）

## 安装与构建

```bash
npm install
npm run build
```

## 环境变量

复制示例文件并填写 Token：

```bash
cp .env.example .env
```

`.env` 内容示例：

```bash
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
```

## 使用方式

### 查看帮助

```bash
npm run help
```

或：

```bash
npx tsx src/cli.ts help
```

### 1) 发送消息

```bash
npx tsx src/cli.ts send-message \
  --chat-id @mychannel \
  --text "Hello from CLI"
```

可选参数：

- `--topic-id <number>`
- `--parse-mode <HTML|Markdown|MarkdownV2>`
- `--disable-web-page-preview [true|false]`
- `--disable-notification [true|false]`

### 2) 获取群组/频道信息

```bash
npx tsx src/cli.ts get-chat-info --chat-id @mychannel
```

### 3) 转发消息

```bash
npx tsx src/cli.ts forward-message \
  --from-chat-id @source_channel \
  --to-chat-id @target_channel \
  --message-id 123
```

### 4) 置顶消息

```bash
npx tsx src/cli.ts pin-message \
  --chat-id @mychannel \
  --message-id 123
```

### 5) 获取管理员列表

```bash
npx tsx src/cli.ts get-chat-admins --chat-id @mychannel --limit 10
```

## 输出格式

所有命令输出 JSON：

- 成功：`{ "success": true, ... }`
- 失败：`{ "success": false, "error": "..." }`

## 注意事项

1. Bot 必须被加入目标群组/频道，并具有对应权限（发消息、置顶等）。
2. 对于频道建议使用 `@channel_username` 或 `-100xxxxxxxxxx` 的 chat id。
3. 若命令失败，请先检查 Token、chat id、以及 Bot 权限。
