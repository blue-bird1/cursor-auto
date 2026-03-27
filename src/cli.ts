#!/usr/bin/env node

import "dotenv/config";
import { Telegraf } from "telegraf";
import { z } from "zod";

type ParsedArgs = {
  command: string;
  options: Record<string, string | boolean>;
  positionals: string[];
};

const tokenSchema = z.string().min(1, "TELEGRAM_BOT_TOKEN 未设置");
const defaultChatSchema = z.string().trim().optional();

const HELP_TEXT = `
telegram-bot-cli - Telegram Bot CLI

用法:
  telegram-bot-cli <command> [options]

命令:
  help
      显示帮助信息

  send-message (别名: send)
      发送消息到群组/频道/用户
      必填:
        --chat-id <id|@username> (可省略，回退 TELEGRAM_DEFAULT_CHAT_ID)
        --text <message>
      可选:
        --topic-id <number>
        --parse-mode <HTML|Markdown|MarkdownV2>
        --disable-web-page-preview [true|false]
        --disable-notification [true|false]

  get-chat-info (别名: info)
      获取群组/频道信息
      必填:
        --chat-id <id|@username> (可省略，回退 TELEGRAM_DEFAULT_CHAT_ID)

  forward-message
      转发消息
      必填:
        --from-chat-id <id|@username>
        --to-chat-id <id|@username>
        --message-id <number>
      可选:
        --disable-notification [true|false]

  pin-message (别名: pin)
      置顶消息
      必填:
        --chat-id <id|@username> (可省略，回退 TELEGRAM_DEFAULT_CHAT_ID)
        --message-id <number>
      可选:
        --disable-notification [true|false]

  get-chat-admins (别名: admins)
      获取群组/频道管理员
      必填:
        --chat-id <id|@username> (可省略，回退 TELEGRAM_DEFAULT_CHAT_ID)
      可选:
        --limit <1-50> (默认 10)

示例:
  telegram-bot-cli send --chat-id @mychannel --text "hello"
  telegram-bot-cli info --chat-id -1001234567890
  telegram-bot-cli forward-message --from-chat-id @a --to-chat-id @b --message-id 123
`;

function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand ?? "help";
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const current = rest[i];

    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const key = current.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return { command, options, positionals };
}

function getRequiredString(
  options: Record<string, string | boolean>,
  key: string,
): string {
  const value = options[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`缺少必填参数 --${key}`);
  }
  return value;
}

function getOptionalString(
  options: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = options[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getChatIdOrDefault(
  options: Record<string, string | boolean>,
  key = "chat-id",
): string {
  const explicit = getOptionalString(options, key);
  if (explicit) {
    return explicit;
  }
  const fallback = defaultChatSchema.parse(process.env.TELEGRAM_DEFAULT_CHAT_ID);
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  throw new Error(`缺少必填参数 --${key}，且 TELEGRAM_DEFAULT_CHAT_ID 也未设置`);
}

function parseBoolean(
  value: string | boolean | undefined,
  defaultValue = false,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`无法解析布尔值: ${value}`);
}

function parseInteger(
  value: string | undefined,
  optionName: string,
  min?: number,
  max?: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw new Error(`--${optionName} 必须是整数`);
  }

  if (min !== undefined && num < min) {
    throw new Error(`--${optionName} 不能小于 ${min}`);
  }
  if (max !== undefined && num > max) {
    throw new Error(`--${optionName} 不能大于 ${max}`);
  }

  return num;
}

async function run(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP_TEXT.trim());
    return;
  }

  const token = tokenSchema.parse(process.env.TELEGRAM_BOT_TOKEN);
  const bot = new Telegraf(token);
  const telegram = bot.telegram;

  switch (command) {
    case "send-message":
    case "send": {
      const chatId = getChatIdOrDefault(options, "chat-id");
      const text = getRequiredString(options, "text");
      const topicId = parseInteger(
        getOptionalString(options, "topic-id"),
        "topic-id",
        1,
      );
      const parseMode = getOptionalString(options, "parse-mode");
      const disableWebPagePreview = parseBoolean(
        options["disable-web-page-preview"],
        false,
      );
      const disableNotification = parseBoolean(
        options["disable-notification"],
        false,
      );
      const linkPreviewOptions = disableWebPagePreview
        ? { is_disabled: true }
        : undefined;

      const message = await telegram.sendMessage(chatId, text, {
        message_thread_id: topicId,
        parse_mode: parseMode as "HTML" | "Markdown" | "MarkdownV2" | undefined,
        link_preview_options: linkPreviewOptions,
        disable_notification: disableNotification,
      });

      console.log(
        JSON.stringify(
          {
            success: true,
            command,
            messageId: message.message_id,
            chatId: message.chat.id,
            date: message.date,
          },
          null,
          2,
        ),
      );
      return;
    }

    case "get-chat-info":
    case "info": {
      const chatId = getChatIdOrDefault(options, "chat-id");
      const chat = await telegram.getChat(chatId);
      console.log(
        JSON.stringify(
          {
            success: true,
            command,
            result: chat,
          },
          null,
          2,
        ),
      );
      return;
    }

    case "forward-message": {
      const fromChatId = getRequiredString(options, "from-chat-id");
      const toChatId = getRequiredString(options, "to-chat-id");
      const messageId = parseInteger(
        getRequiredString(options, "message-id"),
        "message-id",
        1,
      );
      const disableNotification = parseBoolean(
        options["disable-notification"],
        false,
      );

      const forwarded = await telegram.forwardMessage(
        toChatId,
        fromChatId,
        messageId!,
        {
          disable_notification: disableNotification,
        },
      );

      console.log(
        JSON.stringify(
          {
            success: true,
            command,
            messageId: forwarded.message_id,
            chatId: forwarded.chat.id,
            date: forwarded.date,
          },
          null,
          2,
        ),
      );
      return;
    }

    case "pin-message":
    case "pin": {
      const chatId = getChatIdOrDefault(options, "chat-id");
      const messageId = parseInteger(
        getRequiredString(options, "message-id"),
        "message-id",
        1,
      );
      const disableNotification = parseBoolean(
        options["disable-notification"],
        false,
      );

      await telegram.pinChatMessage(chatId, messageId!, {
        disable_notification: disableNotification,
      });

      console.log(
        JSON.stringify(
          {
            success: true,
            command,
            chatId,
            messageId,
          },
          null,
          2,
        ),
      );
      return;
    }

    case "get-chat-admins":
    case "admins": {
      const chatId = getChatIdOrDefault(options, "chat-id");
      const limit =
        parseInteger(getOptionalString(options, "limit"), "limit", 1, 50) ?? 10;
      const admins = await telegram.getChatAdministrators(chatId);
      console.log(
        JSON.stringify(
          {
            success: true,
            command,
            total: admins.length,
            returned: Math.min(limit, admins.length),
            admins: admins.slice(0, limit),
          },
          null,
          2,
        ),
      );
      return;
    }

    default:
      throw new Error(`未知命令: ${command}\n\n${HELP_TEXT.trim()}`);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        success: false,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
