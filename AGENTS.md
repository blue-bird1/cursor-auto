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
