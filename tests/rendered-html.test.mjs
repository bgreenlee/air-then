import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("the explorer is no longer a starter preview", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /AirThen/);
  assert.match(page, /Daily AQI calendar/);
  assert.match(page, /Why this source\?/);
  assert.match(layout, /Historical air quality/);
  assert.doesNotMatch(page, /SkeletonPreview/);
});
