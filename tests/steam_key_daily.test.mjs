import test from "node:test";
import assert from "node:assert/strict";

import {
  diffBundles,
  normalizeBundleId,
  pricesDifferMeaningfully,
} from "../tools/steam_key_daily/inspect.mjs";

function makeBundle(overrides = {}) {
  return {
    id: "https://www.humblebundle.com/games/example-bundle",
    title: "Example Bundle",
    merchant: "Humble Bundle",
    status: "在售",
    expiry: "Thu, 30 Apr 2026 17:00:00 +0200",
    lowest_price_cny: 48.1,
    tiers: [
      {
        name: "Tier 1",
        price_cny: 48.1,
        games: ["Game A", "Game B"],
      },
    ],
    ...overrides,
  };
}

test("pricesDifferMeaningfully ignores tiny CNY drift", () => {
  assert.equal(pricesDifferMeaningfully(48.1, 48.18), false);
  assert.equal(pricesDifferMeaningfully(48.1, 48.7), true);
});

test("diffBundles ignores price-only drift within epsilon", () => {
  const previous = [
    makeBundle({
      lowest_price_cny: 48.1,
      tiers: [{ name: "Tier 1", price_cny: 48.1, games: ["Game A", "Game B"] }],
    }),
  ];
  const current = [
    makeBundle({
      lowest_price_cny: 48.18,
      tiers: [{ name: "Tier 1", price_cny: 48.18, games: ["Game A", "Game B"] }],
    }),
  ];

  const diff = diffBundles(previous, current);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 0);
  assert.equal(diff.removed.length, 0);
});

test("diffBundles still detects material tier changes", () => {
  const previous = [makeBundle()];
  const current = [
    makeBundle({
      lowest_price_cny: 39.5,
      tiers: [{ name: "Tier 1", price_cny: 39.5, games: ["Game A", "Game B"] }],
    }),
  ];

  const diff = diffBundles(previous, current);
  assert.equal(diff.changed.length, 1);
  assert.deepEqual(diff.changed[0]._changed_fields, ["lowest_price_cny", "game_fingerprint"]);
});

test("normalizeBundleId canonicalizes Fanatical locale path", () => {
  const withLocale = normalizeBundleId(
    "https://www.fanatical.com/en/pick-and-mix/build-your-own-killer-bundle",
    "",
  );
  const withoutLocale = normalizeBundleId(
    "https://www.fanatical.com/pick-and-mix/build-your-own-killer-bundle",
    "",
  );

  assert.equal(withLocale, withoutLocale);
  assert.equal(withLocale, "https://www.fanatical.com/pick-and-mix/build-your-own-killer-bundle");
});
