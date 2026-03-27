# Agent Notification Instructions

本仓库中的自动化代理在需要发送通知、状态更新、结果摘要时，应优先使用仓库内 Telegram CLI 工具：

```bash
./scripts/telegram.sh send --text "<message>"
```

## 默认接收对象（Owner）

- Owner chat id: `529436356`
- 该 chat id 是默认发送目标。

为确保代理可直接发送，请使用（或保持）以下环境变量：

```bash
TELEGRAM_DEFAULT_CHAT_ID=529436356
```

当任务没有明确指定其它接收者时，代理应发送到上述默认 Owner chat。

## 推荐用法

1. 使用 `.env` 提供 `TELEGRAM_BOT_TOKEN` 与 `TELEGRAM_DEFAULT_CHAT_ID`
2. 发送通知时尽量简洁，包含任务名、状态（开始/完成/失败）和关键结果
3. 除非任务明确要求，不要改动默认接收对象

## Cursor Cloud specific instructions

### 项目概述

这是一个 Telegram Bot CLI 工具（`telegram-cli-tool`），基于 Node.js/TypeScript，使用 `telegraf` 库调用 Telegram Bot API。单文件应用位于 `src/cli.ts`。

### 常用命令

- **安装依赖**: `npm install`
- **开发模式运行**: `npm run dev -- <command> [options]`（通过 `tsx` 直接执行 TypeScript）
- **构建**: `npm run build`（TypeScript 编译到 `dist/`）
- **Shell 脚本调用**: `./scripts/telegram.sh <command> [options]`（自动安装依赖并执行）

### 环境变量

- `TELEGRAM_BOT_TOKEN`（必需）：作为 Cursor Secret 注入，无需手动配置
- `TELEGRAM_DEFAULT_CHAT_ID`（可选）：默认为 `529436356`，配置在 `.env` 文件中

### 注意事项

- `.env` 文件不在版本控制中，启动前需确认已从 `.env.example` 复制并填写了 `TELEGRAM_BOT_TOKEN`
- Node.js `punycode` 模块弃用警告是 `telegraf` 依赖导致的，不影响功能，可忽略
- 本项目无 lint/test 配置，验证方式为 `npm run build`（类型检查）+ 实际运行命令
