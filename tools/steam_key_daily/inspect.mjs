#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const RSS_URL = "https://isthereanydeal.com/feeds/CN/CNY/bundles.rss";
const ITAD_API_BASE = "https://api.isthereanydeal.com/games/historylow/v1";
const MAX_ITEMS = 30;
const CONCURRENCY = 6;
const RETAIN_DAYS = 90;
const DEFAULT_CHAT_ID = "529436356";
const TELEGRAM_MAX_TEXT = 3900;
const TELEGRAPH_API_CREATE = "https://api.telegra.ph/createPage";
const TELEGRAPH_CONTENT_MAX_BYTES = 62000;
const TELEGRAPH_UPLOAD_CONCURRENCY = 3;
const HISTORY_LOW_BATCH = 40;
const DEFAULT_PREVIOUS_LIMIT = 3;
const DEFAULT_MIN_SAVINGS_RATIO = 0.95;

function usage() {
  console.log(
    [
      "steam_key_daily inspector",
      "",
      "Usage:",
      "  node tools/steam_key_daily/inspect.mjs --state-path <path> [options]",
      "",
      "Options:",
      "  --state-path <path>   状态文件路径（必填）",
      "  --out-dir <path>      输出目录（默认 tools/steam_key_daily/out）",
      "  --previous-limit <n>  增量对比时读取历史条数（默认 3；0=全量）",
      "  --min-savings-ratio <r>  档位价 <= 国区史低总和×r 视为值得买（默认 0.95，需 API Key）",
      "  --no-value-filter       关闭史低价值过滤（仍尝试写入史低展示）",
      "  --send                若 added/changed 非空则发送 Telegram",
      "  --write-state         执行完成后写回 --state-path（默认只生成 next_state.json）",
      "  --chat-id <id>        发送目标（默认 529436356）",
      "  --no-telegraph        不把 Tier 明细上传到 Telegraph（仍发长文本，仅摘要前 3 条）",
      "  --dry-run             仅演练，不发送 Telegram",
      "  --help                显示帮助",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    statePath: "",
    outDir: "tools/steam_key_daily/out",
    send: false,
    writeState: false,
    dryRun: false,
    chatId: DEFAULT_CHAT_ID,
    previousLimit: DEFAULT_PREVIOUS_LIMIT,
    minSavingsRatio: DEFAULT_MIN_SAVINGS_RATIO,
    valueFilter: true,
    telegraph: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--help" || current === "-h") {
      usage();
      process.exit(0);
    }
    if (current === "--send") {
      options.send = true;
      continue;
    }
    if (current === "--write-state") {
      options.writeState = true;
      continue;
    }
    if (current === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (current === "--state-path") {
      options.statePath = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (current === "--out-dir") {
      options.outDir = argv[i + 1] ?? options.outDir;
      i += 1;
      continue;
    }
    if (current === "--chat-id") {
      options.chatId = argv[i + 1] ?? DEFAULT_CHAT_ID;
      i += 1;
      continue;
    }
    if (current === "--previous-limit") {
      const raw = Number(argv[i + 1] ?? String(DEFAULT_PREVIOUS_LIMIT));
      if (!Number.isInteger(raw) || raw < 0) {
        throw new Error("--previous-limit 必须是非负整数（0 表示全量）");
      }
      options.previousLimit = raw;
      i += 1;
      continue;
    }
    if (current === "--min-savings-ratio") {
      const raw = Number(argv[i + 1] ?? String(DEFAULT_MIN_SAVINGS_RATIO));
      if (!Number.isFinite(raw) || raw <= 0 || raw > 1) {
        throw new Error("--min-savings-ratio 应在 (0,1] 内");
      }
      options.minSavingsRatio = raw;
      i += 1;
      continue;
    }
    if (current === "--no-value-filter") {
      options.valueFilter = false;
      continue;
    }
    if (current === "--no-telegraph") {
      options.telegraph = false;
      continue;
    }
    throw new Error(`未知参数: ${current}`);
  }

  if (!options.statePath) {
    throw new Error("缺少 --state-path");
  }
  return options;
}

function nowIso() {
  return new Date().toISOString();
}

function getItadApiKey() {
  return (
    process.env.ITAD_API_KEY ||
    process.env.ISTHEREANYDEAL_API_KEY ||
    process.env.APIKEY ||
    process.env.apikey ||
    ""
  ).trim();
}

function getTelegraphAccessToken() {
  return (process.env.TELEGRAPH_ACCESS_TOKEN || "").trim();
}

function utf8ByteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function telegraphTitleSafe(title) {
  const t = String(title ?? "").trim() || "Bundle";
  if (t.length <= 256) {
    return t;
  }
  return `${t.slice(0, 252)}…`;
}

function storeLinkForBundle(bundle) {
  const official = bundle._official_link && bundle._official_link !== "未确认" ? bundle._official_link : "";
  const itad = bundle._itad_link || "";
  return official || itad || "";
}

function buildTelegraphContentNodes(bundle) {
  const nodes = [];
  const merchant = String(bundle.merchant ?? "未确认");
  const status = String(bundle.status ?? "未确认");
  const expiry = String(bundle.expiry ?? "未确认");
  nodes.push({
    tag: "p",
    children: [
      `商户：${merchant} | 状态：${status} | 截止：${expiry} | 起价：${formatPrice(bundle.lowest_price_cny)}`,
    ],
  });
  const href = storeLinkForBundle(bundle);
  if (href) {
    nodes.push({
      tag: "p",
      children: [{ tag: "a", attrs: { href }, children: ["商店 / ITAD 链接"] }],
    });
  }
  nodes.push({ tag: "h4", children: ["Tier 明细"] });
  const tiers = Array.isArray(bundle._tier_details_for_message) ? bundle._tier_details_for_message : [];
  for (const tier of tiers) {
    const games = Array.isArray(tier.game_details) ? tier.game_details : [];
    const gameCount = games.length;
    const avg = gameCount ? Number(tier.price_cny) / gameCount : 0;
    nodes.push({
      tag: "p",
      children: [
        `${tier.name}（${formatPrice(tier.price_cny)}，${gameCount}款，单款约${formatPrice(avg)}）`,
      ],
    });
    if (games.length === 0) {
      nodes.push({ tag: "p", children: ["（无游戏列表）"] });
      continue;
    }
    nodes.push({
      tag: "ul",
      children: games.map((game) => ({
        tag: "li",
        children: [
          `${game.title || "未确认"}（Steam）史低 ${game.historical_low_cny || "未确认"}，好评 ${game.positive_rate || "未确认"}`,
        ],
      })),
    });
  }
  return nodes;
}

async function telegraphCreatePage(accessToken, title, contentNodes) {
  const body = new URLSearchParams();
  body.set("access_token", accessToken);
  body.set("title", title);
  body.set("content", JSON.stringify(contentNodes));
  body.set("return_content", "false");
  const response = await fetch(TELEGRAPH_API_CREATE, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!data?.ok) {
    const err = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(err);
  }
  const url = String(data.result?.url ?? "").trim();
  const path = String(data.result?.path ?? "").trim();
  if (!url) {
    throw new Error("Telegraph 未返回 url");
  }
  return { url, path };
}

function formatHistoricalLowCny(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    return "未确认";
  }
  return `¥${n.toFixed(2)}`;
}

function parseHistoricalLowCnyLabel(label) {
  if (typeof label !== "string") {
    return null;
  }
  const trimmed = label.trim();
  if (trimmed === "未确认" || !trimmed.startsWith("¥")) {
    return null;
  }
  const n = Number(trimmed.slice(1));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchHistoryLowCn(apiKey, gameIds) {
  if (!apiKey || !Array.isArray(gameIds) || gameIds.length === 0) {
    return new Map();
  }
  const url = new URL(ITAD_API_BASE);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("country", "CN");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(gameIds),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ITAD historylow HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }
  const rows = await response.json();
  const map = new Map();
  if (!Array.isArray(rows)) {
    return map;
  }
  for (const row of rows) {
    const id = String(row?.id ?? "");
    const price = row?.low?.price;
    if (!id || !price) {
      continue;
    }
    const currency = String(price.currency ?? "").toUpperCase();
    const amount = Number(price.amount);
    if (currency === "CNY" && Number.isFinite(amount)) {
      map.set(id, amount);
    }
  }
  return map;
}

async function fetchHistoryLowCnBatched(apiKey, gameIds) {
  const unique = [...new Set(gameIds.filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < unique.length; i += HISTORY_LOW_BATCH) {
    const chunk = unique.slice(i, i + HISTORY_LOW_BATCH);
    const part = await fetchHistoryLowCn(apiKey, chunk);
    for (const [k, v] of part) {
      map.set(k, v);
    }
  }
  return map;
}

function tierPassesValueFilter(tier, ratio) {
  const details = Array.isArray(tier?.game_details) ? tier.game_details : [];
  const withId = details.filter((g) => String(g?.itad_game_id ?? "").length > 0);
  if (withId.length === 0) {
    return false;
  }
  let sumLow = 0;
  for (const g of withId) {
    const low = parseHistoricalLowCnyLabel(g.historical_low_cny);
    if (low === null) {
      return false;
    }
    sumLow += low;
  }
  const tierPrice = Number(tier.price_cny);
  if (!Number.isFinite(tierPrice) || tierPrice <= 0 || sumLow <= 0) {
    return false;
  }
  return tierPrice <= sumLow * ratio;
}

function bundleIsWorthBuying(bundle, ratio) {
  const tiers = Array.isArray(bundle._tier_details_for_message) ? bundle._tier_details_for_message : [];
  return tiers.some((t) => tierPassesValueFilter(t, ratio));
}

async function enrichBundlesHistoryLowAndWorth(bundles, options) {
  const apiKey = getItadApiKey();
  const enrichIds = options.enrichBundleIds instanceof Set ? options.enrichBundleIds : null;
  const ids = [];
  for (const bundle of bundles) {
    if (enrichIds && !enrichIds.has(bundle.id)) {
      continue;
    }
    const tiers = Array.isArray(bundle._tier_details_for_message) ? bundle._tier_details_for_message : [];
    for (const tier of tiers) {
      for (const g of tier.game_details ?? []) {
        if (g?.itad_game_id) {
          ids.push(String(g.itad_game_id));
        }
      }
    }
  }

  let lowById = new Map();
  let historyLowError = "";
  if (ids.length > 0 && apiKey) {
    try {
      lowById = await fetchHistoryLowCnBatched(apiKey, ids);
    } catch (e) {
      historyLowError = e instanceof Error ? e.message : String(e);
    }
  }

  for (const bundle of bundles) {
    const shouldEnrich = !enrichIds || enrichIds.has(bundle.id);
    const tiers = Array.isArray(bundle._tier_details_for_message) ? bundle._tier_details_for_message : [];
    if (shouldEnrich) {
      for (const tier of tiers) {
        for (const g of tier.game_details ?? []) {
          const gid = g?.itad_game_id ? String(g.itad_game_id) : "";
          if (!gid) {
            continue;
          }
          const amount = lowById.get(gid);
          if (amount !== undefined) {
            g.historical_low_cny = formatHistoricalLowCny(amount);
          }
        }
      }
    }

    if (!shouldEnrich) {
      bundle._worth_buying = true;
      continue;
    }
    if (!options.valueFilter) {
      bundle._worth_buying = true;
    } else if (!apiKey) {
      bundle._worth_buying = false;
      bundle._value_filter_note = "no_api_key";
    } else if (historyLowError) {
      bundle._worth_buying = false;
      bundle._value_filter_note = historyLowError;
    } else {
      bundle._worth_buying = bundleIsWorthBuying(bundle, options.minSavingsRatio);
    }
  }

  return {
    api_key_present: Boolean(apiKey),
    history_low_error: historyLowError,
    game_ids_requested: ids.length,
  };
}

function hashText(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function readFirstCapture(text, regex) {
  const match = text.match(regex);
  return (match?.[1] ?? "").trim();
}

function decodeHtmlEntities(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&#039;", "'");
}

function stripHtml(text) {
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "steam-key-daily-tool/1.0",
      accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.text();
}

function parseRssItems(xml, maxItems = MAX_ITEMS) {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1] ?? "");
  return itemBlocks.slice(0, maxItems).map((block) => {
    const titleRaw = readFirstCapture(block, /<title>([\s\S]*?)<\/title>/i);
    const title = stripHtml(titleRaw.replace(/<!\[CDATA\[|\]\]>/g, ""));
    const link = readFirstCapture(block, /<link>([\s\S]*?)<\/link>/i);
    const guid = readFirstCapture(block, /<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const pubDate = readFirstCapture(block, /<pubDate>([\s\S]*?)<\/pubDate>/i);
    const description = readFirstCapture(
      block,
      /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/i,
    );
    return {
      title: title || "未确认",
      link: link.trim(),
      guid: guid.trim(),
      pubDate: pubDate.trim(),
      description,
    };
  });
}

function findBalancedJsonStart(text, startIndex) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (start < 0) {
      if (ch === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return "";
}

function findBalancedJsonArray(text, startIndex) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (start < 0) {
      if (ch === "[") {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return "";
}

function parseDetailPage(html) {
  const gIndex = html.indexOf("var g = ");
  const pageIndex = html.indexOf("var page = ");
  if (gIndex < 0 || pageIndex < 0) {
    throw new Error("详情页缺少 var g / var page");
  }

  const gJson = findBalancedJsonStart(html, gIndex + "var g = ".length);
  const pageJson = findBalancedJsonArray(html, pageIndex + "var page = ".length);
  if (!gJson || !pageJson) {
    throw new Error("详情页 JSON 解析失败");
  }

  const g = JSON.parse(gJson);
  const page = JSON.parse(pageJson);
  const liveData = page?.[1]?.liveData;
  if (!liveData) {
    throw new Error("详情页缺少 liveData");
  }
  return {
    shops: g.shops ?? {},
    liveData,
  };
}

function parseOfficialUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  try {
    const url = new URL(rawUrl);
    const forwarded = url.searchParams.get("u") || url.searchParams.get("url");
    if (forwarded) {
      return parseOfficialUrl(decodeURIComponent(forwarded));
    }
    const cleaned = new URL(`${url.origin}${url.pathname}`);
    for (const [key, value] of url.searchParams.entries()) {
      if (
        /^utm_/i.test(key) ||
        ["ref", "aff", "affiliate", "clickid", "cjdata"].includes(key.toLowerCase())
      ) {
        continue;
      }
      cleaned.searchParams.set(key, value);
    }
    const normalized = cleaned.toString().replace(/\/+$/, "");
    return normalized;
  } catch {
    return rawUrl;
  }
}

function cnyFromPriceTuple(priceTuple) {
  if (!Array.isArray(priceTuple) || priceTuple.length < 2) {
    return 0;
  }
  const raw = Number(priceTuple[0]);
  const currency = String(priceTuple[1] ?? "").toUpperCase();
  if (!Number.isFinite(raw)) {
    return 0;
  }
  if (currency !== "CNY") {
    return 0;
  }
  return Number((raw / 100).toFixed(2));
}

function toExpiryMillis(expiry) {
  const sec = Number(expiry);
  if (!Number.isFinite(sec) || sec <= 0) {
    return 0;
  }
  return sec * 1000;
}

function toExpiryString(expiryMs) {
  if (!expiryMs) {
    return "未确认";
  }
  return new Date(expiryMs).toISOString().replace("T", " ").slice(0, 16);
}

function parseRssDescriptionTiers(descriptionHtml) {
  const chunks = [
    ...descriptionHtml.matchAll(
      /<b>\s*(Tier\s*\d+)\s*<\/b>([\s\S]*?)(?=<b>\s*Tier\s*\d+\s*<\/b>|$)/gi,
    ),
  ];
  return chunks.map((chunk) => {
    const name = stripHtml(chunk[1] ?? "").trim() || "Tier";
    const body = chunk[2] ?? "";
    const priceRaw = readFirstCapture(body, /Price:\s*¥\s*([0-9]+(?:\.[0-9]+)?)/i);
    const games = [...body.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .filter((m) => String(m[1] ?? "").includes("/game/"))
      .map((m) => stripHtml(m[2] ?? ""))
      .filter(Boolean);
    return {
      name,
      price_cny: priceRaw ? Number(priceRaw) : null,
      games,
    };
  });
}

function parseRssExpiry(descriptionHtml) {
  const expiryRaw = readFirstCapture(descriptionHtml, /expires on\s*([^<|]+)/i);
  return expiryRaw || "未确认";
}

function isSteamGame(game, steamShopId) {
  const keys = Array.isArray(game?.keys) ? game.keys : [];
  if (keys.length > 0) {
    return steamShopId > 0 && keys.includes(steamShopId);
  }
  const reviews = Array.isArray(game?.reviews) ? game.reviews : [];
  return reviews.some((x) => String(x?.source ?? "").toLowerCase() === "steam");
}

function computePositiveRateText(review) {
  const positive = Number(review?.positive ?? 0);
  const negative = Number(review?.negative ?? 0);
  const total = positive + negative;
  if (!total) {
    return "未确认";
  }
  return `${Math.round((positive / total) * 100)}%`;
}

function computeGameFingerprint(tiers) {
  const normalized = tiers
    .map((tier) => ({
      name: tier.name,
      price_cny: tier.price_cny,
      games: [...tier.games].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return hashText(JSON.stringify(normalized));
}

function normalizeTierPrice(price, games) {
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) {
    return Array.isArray(games) && games.length > 0 ? 0 : null;
  }
  return Number(num.toFixed(2));
}

function normalizeTiersForComparison(tiers) {
  return (Array.isArray(tiers) ? tiers : [])
    .map((tier, index) => ({
      name: String(tier?.name ?? `Tier ${index + 1}`).trim() || `Tier ${index + 1}`,
      price_cny: normalizeTierPrice(tier?.price_cny, tier?.games),
      games: (Array.isArray(tier?.games) ? tier.games : [])
        .map((game) => decodeHtmlEntities(String(game ?? "").trim()))
        .filter(Boolean),
    }))
    .filter((tier) => tier.games.length > 0 || tier.price_cny !== null);
}

function haveEquivalentTiers(prevTiers, currentTiers) {
  return (
    JSON.stringify(normalizeTiersForComparison(prevTiers)) ===
    JSON.stringify(normalizeTiersForComparison(currentTiers))
  );
}

function normalizeStatus(expiryMs) {
  if (!expiryMs) {
    return "疑似过期";
  }
  return expiryMs > Date.now() ? "在售" : "结束";
}

function normalizeBundleId(officialUrl, itadLink) {
  return officialUrl || itadLink.replace(/\/+$/, "");
}

function buildBundleState(detail, rssItem) {
  const liveData = detail.liveData;
  const shops = detail.shops ?? {};
  const steamEntry = Object.entries(shops).find(
    ([, value]) => String(value?.[0] ?? "").toLowerCase() === "steam",
  );
  const steamShopId = steamEntry ? Number(steamEntry[0]) : -1;
  const detailTiers = Array.isArray(liveData.tiers) ? liveData.tiers : [];
  const rssTiers = parseRssDescriptionTiers(rssItem.description);

  let steamGamesTotal = 0;
  const tiersWithGames = detailTiers.map((tier, index) => {
    const steamGames = (Array.isArray(tier.games) ? tier.games : []).filter((g) =>
      isSteamGame(g, steamShopId),
    );
    steamGamesTotal += steamGames.length;
    const fallbackGames = rssTiers[index]?.games ?? [];
    const fallbackPrice = rssTiers[index]?.price_cny ?? 0;
    const price = fallbackPrice || cnyFromPriceTuple(tier.price);
    const steamGameDetails = steamGames.map((game) => {
      const steamReview = (Array.isArray(game.reviews) ? game.reviews : []).find(
        (x) => String(x?.source ?? "").toLowerCase() === "steam",
      );
      return {
        itad_game_id: String(game.id ?? "").trim() || "",
        title: String(game.title ?? "").trim() || "未确认",
        positive_rate: computePositiveRateText(steamReview),
        historical_low_cny: "未确认",
      };
    });
    const steamDetailsByTitle = new Map(
      steamGameDetails.map((gameDetail) => [gameDetail.title, gameDetail]),
    );
    const displayedGames = fallbackGames.length
      ? fallbackGames
      : steamGameDetails.map((gameDetail) => gameDetail.title);
    const displayedDetails = displayedGames.map((title) => {
      const fromSteam = steamDetailsByTitle.get(title);
      if (fromSteam) {
        return fromSteam;
      }
      return {
        itad_game_id: "",
        title,
        positive_rate: "未确认",
        historical_low_cny: "未确认",
      };
    });

    return {
      name: `Tier ${index + 1}`,
      price_cny: price,
      games: displayedGames,
      game_details: displayedDetails,
    };
  });

  const hasSteam = steamGamesTotal > 0;
  const expiryMs = toExpiryMillis(liveData.expiry);
  const rssExpiry = parseRssExpiry(rssItem.description);
  const officialLink = parseOfficialUrl(String(liveData.url ?? ""));
  const itadLink = rssItem.link.replace(/\/+$/, "");
  const minTierPrice = Math.min(
    ...tiersWithGames.map((tier) => Number(tier.price_cny)).filter((p) => Number.isFinite(p) && p > 0),
  );

  const stateItem = {
    itad_id: itadLink.split("/").pop() || "未确认",
    id: normalizeBundleId(officialLink, itadLink),
    official_link: officialLink || "未确认",
    itad_link: itadLink,
    title: String(liveData.title ?? rssItem.title ?? "未确认").trim() || "未确认",
    merchant: String(liveData.page?.name ?? "未确认").trim() || "未确认",
    status: normalizeStatus(expiryMs),
    expiry: rssExpiry,
    lowest_price_cny: Number.isFinite(minTierPrice) ? Number(minTierPrice.toFixed(2)) : 0,
    tiers: tiersWithGames.map((tier) => ({
      name: tier.name,
      price_cny: tier.price_cny,
      games: tier.games,
    })),
    game_fingerprint: computeGameFingerprint(
      tiersWithGames.map((tier) => ({
        name: tier.name,
        price_cny: tier.price_cny,
        games: tier.games,
      })),
    ),
    last_seen_at: nowIso(),
    _itad_link: itadLink,
    _official_link: officialLink || "未确认",
    _expiry_ms: expiryMs,
    _tier_details_for_message: tiersWithGames,
  };

  return {
    hasSteam,
    stateItem,
  };
}

function dedupeByIdOrOfficial(candidates) {
  const map = new Map();
  for (const bundle of candidates) {
    const key = bundle.id.replace(/\/+$/, "");
    if (!map.has(key)) {
      map.set(key, bundle);
    }
  }
  return [...map.values()];
}

function isInWindow(expiryMs) {
  if (!expiryMs) {
    return true;
  }
  return expiryMs > Date.now();
}

function isCurrentBundle(bundle) {
  return bundle?.status === "在售" && isInWindow(Number(bundle?._expiry_ms ?? 0));
}

function diffBundles(previousBundles, currentBundles) {
  const prevMap = new Map(previousBundles.map((x) => [x.id, x]));
  const currMap = new Map(currentBundles.map((x) => [x.id, x]));

  const added = [];
  const changed = [];
  const removed = [];

  for (const current of currentBundles) {
    const prev = prevMap.get(current.id);
    if (!prev) {
      added.push(current);
      continue;
    }
    const changedFields = [];
    if (prev.status !== current.status) changedFields.push("status");
    if (prev.expiry !== current.expiry) changedFields.push("expiry");
    if (Number(prev.lowest_price_cny) !== Number(current.lowest_price_cny))
      changedFields.push("lowest_price_cny");
    if (!haveEquivalentTiers(prev.tiers, current.tiers)) changedFields.push("game_fingerprint");
    if (prev.title !== current.title) changedFields.push("title");
    if (prev.merchant !== current.merchant) changedFields.push("merchant");

    if (changedFields.length) {
      current._changed_fields = changedFields;
      changed.push(current);
    }
  }

  for (const prev of previousBundles) {
    const current = currMap.get(prev.id);
    if (!current || current.status === "结束") {
      removed.push(current || prev);
    }
  }

  return { added, changed, removed };
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return "未确认";
  }
  return `¥${num.toFixed(2)}`;
}

function formatDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildSummaryMessage({
  added,
  changed,
  removed,
  currentBundles,
  telegraphById,
  useTelegraphLinks,
}) {
  const expiring72h = currentBundles.filter((bundle) => {
    const ms = Number(bundle._expiry_ms ?? 0);
    if (!ms || ms < Date.now()) return false;
    return ms - Date.now() <= 72 * 60 * 60 * 1000;
  }).length;

  const lines = [];
  lines.push(`Steam低价Key日报（${formatDate()}）`);
  lines.push(`新增 ${added.length}，下线 ${removed.length}，72小时内到期 ${expiring72h}`);

  const focusAll = [...added, ...changed];

  if (useTelegraphLinks && telegraphById instanceof Map) {
    focusAll.forEach((bundle, idx) => {
      const store =
        bundle._official_link && bundle._official_link !== "未确认"
          ? bundle._official_link
          : bundle._itad_link || "未确认";
      lines.push(
        `${idx + 1}) ${bundle.title} | ${formatPrice(bundle.lowest_price_cny)}起 | 截止 ${bundle.expiry} | ${store}`,
      );
      const rec = telegraphById.get(bundle.id);
      if (rec?.ok && rec.url) {
        lines.push(`   明细（Telegraph）：${rec.url}`);
      } else {
        const err = rec?.error ? String(rec.error) : "unknown";
        lines.push(`   明细（Telegraph 失败）：${err}`);
      }
    });
    return lines.join("\n");
  }

  const focus = focusAll.slice(0, 3);
  focus.forEach((bundle, idx) => {
    const link =
      bundle._official_link && bundle._official_link !== "未确认"
        ? bundle._official_link
        : bundle._itad_link || "未确认";
    lines.push(
      `${idx + 1}) ${bundle.title} | ${formatPrice(bundle.lowest_price_cny)}起 | 截止 ${bundle.expiry} | ${link}`,
    );
    lines.push("- Tier 明细：");
    const tiers = Array.isArray(bundle._tier_details_for_message)
      ? bundle._tier_details_for_message
      : [];
    tiers.forEach((tier) => {
      const games = Array.isArray(tier.game_details) ? tier.game_details : [];
      const gameCount = games.length;
      const avg = gameCount ? Number(tier.price_cny) / gameCount : 0;
      lines.push(
        `  - ${tier.name}（${formatPrice(tier.price_cny)}，${gameCount}款，单款约${formatPrice(avg)}）`,
      );
      games.forEach((game) => {
        lines.push(
          `    - ${game.title || "未确认"}（Steam）(史低价格 ${game.historical_low_cny || "未确认"} 好评率 ${game.positive_rate || "未确认"})`,
        );
      });
    });
  });
  return lines.join("\n");
}

function toStoredBundle(bundle) {
  return {
    itad_id: bundle.itad_id,
    id: bundle.id,
    official_link: bundle.official_link,
    itad_link: bundle.itad_link,
    title: bundle.title,
    merchant: bundle.merchant,
    status: bundle.status,
    expiry: bundle.expiry,
    lowest_price_cny: bundle.lowest_price_cny,
    tiers: bundle.tiers,
    game_fingerprint: bundle.game_fingerprint,
    last_seen_at: bundle.last_seen_at,
  };
}

function pruneStateBundles(bundles) {
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  const deduped = new Map();
  for (const bundle of bundles) {
    if (bundle?.id) {
      deduped.set(bundle.id, bundle);
    }
  }

  return [...deduped.values()]
    .filter((bundle) => {
      const seen = Date.parse(bundle.last_seen_at ?? "");
      if (!Number.isFinite(seen)) {
        return bundle.status === "在售";
      }
      if (bundle.status === "在售") {
        return true;
      }
      return seen >= cutoff;
    })
    .map(toStoredBundle);
}

function buildNextStateBundles(previousBundles, currentBundles) {
  const currentIds = new Set(currentBundles.map((bundle) => bundle.id));
  const carryForward = previousBundles
    .filter((bundle) => !currentIds.has(bundle.id))
    .map((bundle) => {
      if (bundle.status === "在售") {
        return {
          ...bundle,
          status: "结束",
        };
      }
      return bundle;
    });

  return pruneStateBundles([...carryForward, ...currentBundles]);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readStateOrInit(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.bundles)) {
      return { last_run_at: "", bundles: [] };
    }
    return parsed;
  } catch {
    return { last_run_at: "", bundles: [] };
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = new Array(Math.min(items.length, concurrency)).fill(0).map(async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        break;
      }
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function uploadBundleDetailsToTelegraph(bundles, accessToken) {
  const byId = new Map();
  await mapWithConcurrency(bundles, TELEGRAPH_UPLOAD_CONCURRENCY, async (bundle) => {
    const id = bundle.id;
    try {
      const nodes = buildTelegraphContentNodes(bundle);
      const payload = JSON.stringify(nodes);
      if (utf8ByteLength(payload) > TELEGRAPH_CONTENT_MAX_BYTES) {
        throw new Error("CONTENT_TOO_LARGE");
      }
      const page = await telegraphCreatePage(accessToken, telegraphTitleSafe(bundle.title), nodes);
      byId.set(id, { ok: true, url: page.url, path: page.path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      byId.set(id, { ok: false, error: msg });
    }
  });
  return byId;
}

function truncateTelegramText(text) {
  if (text.length <= TELEGRAM_MAX_TEXT) {
    return text;
  }
  const suffix = "\n...（内容过长，已截断）";
  return `${text.slice(0, TELEGRAM_MAX_TEXT - suffix.length)}${suffix}`;
}

async function sendTelegram(chatId, text) {
  return new Promise((resolve, reject) => {
    const args = ["send", "--chat-id", chatId, "--text", truncateTelegramText(text)];
    const child = spawn("./scripts/telegram.sh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(new Error(`telegram send failed, code=${code}, stderr=${stderr.trim()}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(options.outDir);
  const statePath = path.resolve(options.statePath);
  await ensureDir(outDir);
  await ensureDir(path.dirname(statePath));

  const startedAt = Date.now();
  const metrics = {
    rss_fetch_ms: 0,
    detail_fetch_ms: 0,
    diff_ms: 0,
    history_low_ms: 0,
    total_ms: 0,
  };

  const previousState = await readStateOrInit(statePath);
  const previousBundlesAll = Array.isArray(previousState.bundles) ? previousState.bundles : [];
  const previousSorted = [...previousBundlesAll].sort((a, b) => {
    const aSeen = Date.parse(a.last_seen_at ?? "") || 0;
    const bSeen = Date.parse(b.last_seen_at ?? "") || 0;
    return bSeen - aSeen;
  });
  const previousBundles = previousSorted;

  const rssStart = Date.now();
  const rssXml = await fetchText(RSS_URL);
  const rssItems = parseRssItems(rssXml, MAX_ITEMS);
  metrics.rss_fetch_ms = Date.now() - rssStart;

  const itemDedupMap = new Map();
  for (const item of rssItems) {
    const key = (item.link || item.guid).replace(/\/+$/, "");
    if (!itemDedupMap.has(key)) {
      itemDedupMap.set(key, item);
    }
  }
  const dedupedItems = [...itemDedupMap.values()];

  const detailStart = Date.now();
  const detailResults = await mapWithConcurrency(dedupedItems, CONCURRENCY, async (item) => {
    try {
      const html = await fetchText(item.link);
      const detail = parseDetailPage(html);
      const parsed = buildBundleState(detail, item);
      return parsed;
    } catch (error) {
      return {
        hasSteam: false,
        stateItem: null,
        error: error instanceof Error ? error.message : String(error),
        item_link: item.link,
      };
    }
  });
  metrics.detail_fetch_ms = Date.now() - detailStart;

  const currentBundles = dedupeByIdOrOfficial(
    detailResults
      .filter((result) => result?.hasSteam && result?.stateItem)
      .map((result) => result.stateItem)
      .filter((bundle) => isCurrentBundle(bundle)),
  );
  const currentBundlesForDiff =
    previousBundlesAll.length === 0 && options.previousLimit > 0
      ? currentBundles.slice(0, options.previousLimit)
      : currentBundles;

  const diffStart = Date.now();
  const diff = diffBundles(previousBundles, currentBundlesForDiff);
  metrics.diff_ms = Date.now() - diffStart;

  const enrichIdsRaw = [...diff.added, ...diff.changed].map((b) => b.id);
  const enrichStart = Date.now();
  const historyLowMeta = await enrichBundlesHistoryLowAndWorth(currentBundles, {
    enrichBundleIds: enrichIdsRaw.length > 0 ? new Set(enrichIdsRaw) : null,
    valueFilter: options.valueFilter,
    minSavingsRatio: options.minSavingsRatio,
  });
  metrics.history_low_ms = Date.now() - enrichStart;

  const worthyAdded = options.valueFilter
    ? diff.added.filter((b) => b._worth_buying)
    : [...diff.added];
  const worthyChanged = options.valueFilter
    ? diff.changed.filter((b) => b._worth_buying)
    : [...diff.changed];

  const shouldNotify = worthyAdded.length > 0 || worthyChanged.length > 0;
  const focusBundlesForNotify = [...worthyAdded, ...worthyChanged];
  const telegraphToken = getTelegraphAccessToken();
  const wantTelegraph = Boolean(options.telegraph && telegraphToken);
  let telegraphById = new Map();
  const telegraphRuntime = {
    requested: Boolean(options.telegraph),
    attempted: false,
    used_links_in_message: false,
    reason: !options.telegraph
      ? "disabled_flag"
      : !telegraphToken
        ? "no_access_token"
        : "not_needed",
    pages_ok: 0,
    pages_failed: 0,
  };

  if (shouldNotify && wantTelegraph && !options.dryRun) {
    telegraphRuntime.attempted = true;
    telegraphRuntime.reason = "uploaded";
    telegraphById = await uploadBundleDetailsToTelegraph(focusBundlesForNotify, telegraphToken);
    for (const rec of telegraphById.values()) {
      if (rec?.ok) {
        telegraphRuntime.pages_ok += 1;
      } else {
        telegraphRuntime.pages_failed += 1;
      }
    }
  } else if (shouldNotify && options.telegraph && !telegraphToken) {
    telegraphRuntime.reason = "no_access_token";
  } else if (shouldNotify && options.dryRun && options.telegraph && telegraphToken) {
    telegraphRuntime.reason = "dry_run_skip_upload";
  } else if (!shouldNotify) {
    telegraphRuntime.reason = "not_needed";
  }

  const useTelegraphLinks =
    shouldNotify &&
    wantTelegraph &&
    !options.dryRun &&
    telegraphRuntime.attempted &&
    focusBundlesForNotify.length > 0 &&
    telegraphRuntime.pages_ok > 0;

  if (useTelegraphLinks) {
    telegraphRuntime.used_links_in_message = true;
  } else if (telegraphRuntime.attempted && telegraphRuntime.pages_ok === 0) {
    telegraphRuntime.reason = "all_uploads_failed_fallback_inline";
  }

  const summaryMessage = shouldNotify
    ? buildSummaryMessage({
        added: worthyAdded,
        changed: worthyChanged,
        removed: diff.removed,
        currentBundles,
        telegraphById,
        useTelegraphLinks,
      })
    : "";

  const nextState = {
    last_run_at: nowIso(),
    bundles: buildNextStateBundles(previousBundlesAll, currentBundles),
  };

  const files = {
    diff: path.join(outDir, "diff.json"),
    summary: path.join(outDir, "summary.txt"),
    next_state: path.join(outDir, "next_state.json"),
    runtime: path.join(outDir, "runtime.json"),
  };

  await fs.writeFile(files.diff, JSON.stringify(diff, null, 2));
  await fs.writeFile(files.summary, summaryMessage ? `${summaryMessage}\n` : "", "utf8");
  await fs.writeFile(files.next_state, JSON.stringify(nextState, null, 2), "utf8");

  const runtime = {
    generated_at: nowIso(),
    options: {
      send: options.send,
      write_state: options.writeState,
      dry_run: options.dryRun,
      chat_id: options.chatId,
      previous_limit: options.previousLimit,
      value_filter: options.valueFilter,
      min_savings_ratio: options.minSavingsRatio,
      telegraph: options.telegraph,
    },
    telegraph: telegraphRuntime,
    counts: {
      rss_items: rssItems.length,
      deduped_items: dedupedItems.length,
      previous_bundles_total: previousBundlesAll.length,
      previous_bundles_used_for_diff: previousBundles.length,
      current_bundles_used_for_diff: currentBundlesForDiff.length,
      current_steam_bundles: currentBundles.length,
      added: diff.added.length,
      changed: diff.changed.length,
      worthy_added: worthyAdded.length,
      worthy_changed: worthyChanged.length,
      removed: diff.removed.length,
    },
    history_low: historyLowMeta,
    should_notify: shouldNotify,
    parse_errors: detailResults
      .filter((x) => x?.error)
      .map((x) => ({ link: x.item_link, error: x.error })),
    timings: metrics,
    outputs: files,
  };

  let telegram = {
    attempted: false,
    sent: false,
    reason: "not_requested",
  };

  if (options.send && shouldNotify && !options.dryRun) {
    telegram.attempted = true;
    await sendTelegram(options.chatId, summaryMessage);
    telegram.sent = true;
    telegram.reason = "worthy_added_or_changed";
  } else if (options.send && options.dryRun) {
    telegram.reason = "dry_run";
  } else if (options.send && !shouldNotify) {
    telegram.reason =
      diff.added.length > 0 || diff.changed.length > 0
        ? "no_worthy_added_or_changed"
        : "no_added_or_changed";
  }

  if (options.writeState) {
    await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), "utf8");
  }

  metrics.total_ms = Date.now() - startedAt;
  runtime.timings = metrics;
  runtime.telegram = telegram;
  if (telegraphRuntime.attempted && telegraphById.size > 0) {
    runtime.telegraph_pages = Object.fromEntries(
      [...telegraphById.entries()].map(([id, rec]) => [
        id,
        rec.ok ? { ok: true, url: rec.url } : { ok: false, error: rec.error },
      ]),
    );
  }
  await fs.writeFile(files.runtime, JSON.stringify(runtime, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        success: true,
        should_notify: shouldNotify,
        write_state: options.writeState,
        telegram,
        outputs: files,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
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
