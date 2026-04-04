import test from "node:test";
import assert from "node:assert/strict";

import { diffBundles, normalizeBundleId } from "../tools/steam_key_daily/inspect.mjs";

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

test("diffBundles no longer reports changed bundles", () => {
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

test("diffBundles ignores material edits for existing bundles", () => {
  const previous = [makeBundle()];
  const current = [
    makeBundle({
      lowest_price_cny: 39.5,
      tiers: [{ name: "Tier 1", price_cny: 39.5, games: ["Game A", "Game B"] }],
    }),
  ];

  const diff = diffBundles(previous, current);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 0);
  assert.equal(diff.removed.length, 0);
});

test("diffBundles still reports truly new bundles", () => {
  const previous = [makeBundle()];
  const current = [
    makeBundle(),
    makeBundle({
      id: "https://www.humblebundle.com/games/new-bundle",
      title: "Brand New Bundle",
    }),
  ];

  const diff = diffBundles(previous, current);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].title, "Brand New Bundle");
  assert.equal(diff.changed.length, 0);
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
