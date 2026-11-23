import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
test("Both pages reference existing local scripts and styles", () => {
  for (const page of ["index.html", "admin.html"]) {
    const html = readFileSync(join(publicDir, page), "utf8");
    for (const [, asset] of html.matchAll(/(?:src|href)="\/([^"#?]+\.(?:css|js))(?:\?[^"]*)?"/g)) {
      assert.ok(existsSync(join(publicDir, asset)), `${page} references missing ${asset}`);
    }
  }
});
test("Customer and admin script hooks survive the HTML integration", () => {
  for (const [page, script] of [["index.html", "gateway-ui.js"], ["admin.html", "admin.js"]]) {
    const html = readFileSync(join(publicDir, page), "utf8");
    const js = readFileSync(join(publicDir, script), "utf8");
    const hooks = script === "gateway-ui.js" ? /\$\(['"]#([\w-]+)['"]\)/g : /\$\(['"]([\w-]+)['"]\)/g;
    for (const [, id] of js.matchAll(hooks)) {
      assert.match(html, new RegExp(`id="${id}"`), `${script} requires ${id}`);
    }
  }
});
test("New portal uses local scripts, styles, fonts and video under the existing CSP", () => {
  const html = readFileSync(join(publicDir, "index.html"), "utf8");
  const css = readFileSync(join(publicDir, "portal.css"), "utf8");
  assert.doesNotMatch(html, /<style\b|<script(?![^>]*\bsrc=)|\sstyle=|data:video|fonts\.google/);
  assert.match(html, /type="module" src="\/gateway-ui\.js"/);
  assert.match(html, /src="\/media\/claude-setup\.mp4"/);
  for (const [, asset] of css.matchAll(/url\(['"]?(\/[^)'"\s]+)['"]?\)/g)) {
    assert.ok(existsSync(join(publicDir, asset.slice(1))), asset);
  }
});
test("Customer navigation stays focused and connector downloads are linked", () => {
  const html = readFileSync(join(publicDir, "index.html"), "utf8");
  const nav = html.match(/<nav class="topnav" aria-label="Workspace navigation">([\s\S]*?)<\/nav>/)?.[1] ?? "";
  assert.deepEqual([...nav.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]), ["overview", "customer", "usage", "chat", "docs"]);
  assert.doesNotMatch(html, /id="toolkit"|releases\/download\//);
  for (const file of ["apiduck-windows.zip", "apiduck-linux.zip", "SHA256SUMS.txt"]) {
    assert.ok(html.includes(`/downloads/${file}`));
  }
  assert.doesNotMatch(html, /release pending|NOT RELEASED|not released yet/);
  for (const field of ["remaining", "granted", "used"]) assert.match(html, new RegExp(`id="balance-${field}"`));
  assert.doesNotMatch(html, /apily\.netlify\.app|api-verify-path|api-auth-method|balances aren't available/);
  assert.match(html, /id="api-base-url" readonly/);
  assert.match(html, /id="overview-progress"/);
});
