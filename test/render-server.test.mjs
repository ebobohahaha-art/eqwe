import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderServer } from "../render-server.mjs";

async function serve(t) {
  const server = createRenderServer("http://127.0.0.1");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("Render server serves only public files with CSP and hides source files", async (t) => {
  const base = await serve(t);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(await page.text(), /login-screen/);
  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  for (const path of ["/workspace.js", "/preset-gears.js", "/console.css", "/mint-duck.svg",
    "/fonts/bricolage-grotesque.woff2", "/fonts/pixelify-sans.ttf", "/workspace.css", "/admin.css", "/admin.js", "/style.css",
    "/portal.css", "/gateway-ui.js", "/account-client.mjs", "/fonts/schibsted-grotesk-400.ttf", "/media/claude-setup-poster.jpg"]) {
    const asset = await fetch(`${base}${path}`);
    assert.equal(asset.status, 200, path);
    assert.ok((await asset.text()).length > 0, path);
  }
  for (const path of ["/.env", "/schema.sql", "/netlify/functions/admin.mjs", "/package.json"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404);
  }
  for (const path of ["/downloads/apiduck-windows.zip", "/downloads/apiduck-linux.zip"]) {
    const download = await fetch(`${base}${path}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    assert.equal(new Uint8Array(await download.arrayBuffer())[0], 0x50);
  }
});

test("Setup video supports metadata, byte ranges and seeking without exposing sources", async (t) => {
  const base = await serve(t);
  const head = await fetch(`${base}/media/claude-setup.mp4`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "video/mp4");
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  const size = Number(head.headers.get("content-length"));
  assert.ok(size > 1_000_000);
  const range = await fetch(`${base}/media/claude-setup.mp4`, { headers: { Range: "bytes=0-15" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), `bytes 0-15/${size}`);
  const bytes = new Uint8Array(await range.arrayBuffer());
  assert.equal(bytes.length, 16);
  assert.equal(new TextDecoder().decode(bytes.subarray(4, 8)), "ftyp");
  const suffix = await fetch(`${base}/media/claude-setup.mp4`, { headers: { Range: "bytes=-16" } });
  assert.equal(suffix.status, 206);
  assert.equal((await suffix.arrayBuffer()).byteLength, 16);
  for (const bad of [`bytes=${size}-`, "bytes=30-20", "bytes=-0", "bytes=0-1,4-5"]) {
    assert.equal((await fetch(`${base}/media/claude-setup.mp4`, { headers: { Range: bad } })).status, 416, bad);
  }
});

test("Render local HTTP preview cannot authenticate or send provider requests", async (t) => {
  const base = await serve(t);
  assert.equal((await fetch(`${base}/api/account`)).status, 400);
  assert.equal((await fetch(`${base}/v1/messages`, { method: "POST" })).status, 400);
  const previous = process.env.ADMIN_ACCESS_KEY;
  try {
    delete process.env.ADMIN_ACCESS_KEY;
    assert.equal((await fetch(`${base}/api/admin`)).status, 503);

    // A configured deployment must still reject HTTP, even with valid credentials.
    const key = `sk-admin-${"a".repeat(64)}`;
    process.env.ADMIN_ACCESS_KEY = key;
    assert.equal((await fetch(`${base}/api/admin`)).status, 400);
    assert.equal((await fetch(`${base}/api/admin`, {
      headers: { Authorization: `Bearer ${key}` },
    })).status, 400);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_ACCESS_KEY;
    else process.env.ADMIN_ACCESS_KEY = previous;
  }
  assert.equal((await fetch(`${base}/admin`)).status, 200);
});

test("Render production origin must be HTTPS", () => {
  assert.throws(() => createRenderServer("http://public.example"));
  assert.throws(() => createRenderServer("https://public.example/path"));
  assert.doesNotThrow(() => createRenderServer("https://public.example"));
});
