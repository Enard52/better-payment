import assert from "node:assert/strict";
import test from "node:test";
import { nextProviderTabIndex } from "../lib/provider-tabs.mjs";

const tabCount = 11;

for (const viewport of [
  { name: "mobile", width: 390 },
  { name: "desktop", width: 1280 },
]) {
  test(`${viewport.name} (${viewport.width}px) follows the same horizontal arrow-key order`, () => {
    assert.equal(nextProviderTabIndex("ArrowRight", 0, tabCount), 1);
    assert.equal(nextProviderTabIndex("ArrowLeft", 1, tabCount), 0);
    assert.equal(nextProviderTabIndex("ArrowLeft", 0, tabCount), tabCount - 1);
    assert.equal(nextProviderTabIndex("ArrowRight", tabCount - 1, tabCount), 0);
  });

  test(`${viewport.name} (${viewport.width}px) supports Home and End`, () => {
    assert.equal(nextProviderTabIndex("Home", 5, tabCount), 0);
    assert.equal(nextProviderTabIndex("End", 5, tabCount), tabCount - 1);
  });
}

test("unrelated keys preserve native button behavior", () => {
  assert.equal(nextProviderTabIndex("Tab", 2, tabCount), null);
  assert.equal(nextProviderTabIndex("Enter", 2, tabCount), null);
  assert.equal(nextProviderTabIndex("ArrowRight", 0, 0), null);
});
