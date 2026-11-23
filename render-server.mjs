import { createServer } from "node:http";
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import account from "./netlify/functions/account.mjs";
import admin from "./netlify/functions/admin.mjs";
import messages from "./netlify/functions/messages.mjs";
import countTokens from "./netlify/functions/count-tokens.mjs";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
const routes = new Map([
  ["/api/account", account],
  ["/api/admin", admin],
  ["/v1/messages", messages],
  ["/v1/messages/count_tokens", countTokens],
]);
const staticFiles = new Map([
  ["/downloads/apiduck-windows.zip", ["downloads/apiduck-windows.zip", "application/zip"]],
  ["/downloads/apiduck-linux.zip", ["downloads/apiduck-linux.zip", "application/zip"]],
  ["/downloads/SHA256SUMS.txt", ["downloads/SHA256SUMS.txt", "text/plain; charset=utf-8"]],
  ["/console.css", ["console.css", "text/css; charset=utf-8"]],
  ["/mint-duck.svg", ["mint-duck.svg", "image/svg+xml"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/admin", ["admin.html", "text/html; charset=utf-8"]],
  ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/gateway-ui.js", ["gateway-ui.js", "text/javascript; charset=utf-8"]],
  ["/account-client.mjs", ["account-client.mjs", "text/javascript; charset=utf-8"]],
  ["/portal.css", ["portal.css", "text/css; charset=utf-8"]],
  ["/media/claude-setup.mp4", ["media/claude-setup.mp4", "video/mp4"]],
  ["/media/claude-setup-poster.jpg", ["media/claude-setup-poster.jpg", "image/jpeg"]],
  ["/media/overview-illustration.png", ["media/overview-illustration.png", "image/png"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/workspace.css", ["workspace.css", "text/css; charset=utf-8"]],
  ["/fonts/pixelify-sans.ttf", ["fonts/pixelify-sans.ttf", "font/ttf"]],
  ["/fonts/bricolage-grotesque.woff2", ["fonts/bricolage-grotesque.woff2", "font/woff2"]],
  ["/admin.css", ["admin.css", "text/css; charset=utf-8"]],
  ["/workspace.js", ["workspace.js", "text/javascript; charset=utf-8"]],
  ["/preset-gears.js", ["preset-gears.js", "text/javascript; charset=utf-8"]],
]);
for (const filename of ["jetbrains-mono-400.ttf", "jetbrains-mono-500.ttf",
  "schibsted-grotesk-400.ttf", "schibsted-grotesk-500.ttf", "schibsted-grotesk-600.ttf", "schibsted-grotesk-700.ttf"]) {
  staticFiles.set(`/fonts/${filename}`, [`fonts/${filename}`, "font/ttf"]);
}
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

export function createRenderServer(publicOrigin) {
  const origin = new URL(publicOrigin);
  if (origin.pathname !== "/" || origin.search || origin.hash ||
      !["https:", "http:"].includes(origin.protocol) ||
      (origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname))) {
    throw new Error("PUBLIC_ORIGIN must be the HTTPS origin of this Render service");
  }
  const server = createServer(async (req, res) => {
    try {
      const localPortHost = origin.protocol === "http:" && `${origin.host}:${server.address()?.port}`;
      if (req.headers.host !== origin.host && req.headers.host !== localPortHost) {
        res.writeHead(421, { "Cache-Control": "no-store" }).end();
        return;
      }
      if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
        res.writeHead(400, { "Cache-Control": "no-store" }).end();
        return;
      }
      const url = new URL(req.url ?? "/", origin);
      if (url.origin !== origin.origin) {
        res.writeHead(400, { "Cache-Control": "no-store" }).end();
        return;
      }
      const headers = { ...securityHeaders };
      const route = routes.get(url.pathname);
      if (route) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 512_000) {
            res.writeHead(413, { ...headers, "Cache-Control": "no-store" })
              .end(JSON.stringify({ error: "Request body too large" }));
            return;
          }
          chunks.push(chunk);
        }
        const request = new Request(url, {
          method: req.method, headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
        });
        const response = await route(request);
        for (const [name, value] of response.headers) headers[name] = value;
        res.writeHead(response.status, headers);
        if (req.method === "HEAD") res.end();
        else if(response.body) await pipeline(Readable.fromWeb(response.body),res);
        else res.end();
        return;
      }
      const entry = staticFiles.get(url.pathname);
      if (!entry) {
        res.writeHead(404, headers).end("Not found");
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end();
        return;
      }
      const [filename, type] = entry;
      const data = await readFile(join(publicDir, filename));
      if (type === "video/mp4") {
        headers["Accept-Ranges"] = "bytes";
        if (req.method === "GET" && req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          let start, end;
          if (match && (match[1] || match[2])) {
            start = match[1] ? Number(match[1]) : Math.max(0, data.length - Number(match[2]));
            end = match[1] && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
          }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= data.length) {
            res.writeHead(416, { ...headers, "Content-Range": `bytes */${data.length}` }).end();
            return;
          }
          res.writeHead(206, { ...headers, "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${data.length}`,
            "Content-Length": end - start + 1, "Cache-Control": "no-store" });
          res.end(data.subarray(start, end + 1));
          return;
        }
      }
      res.writeHead(200, {
        ...headers,
        "Content-Type": type,
        "Content-Length": data.length,
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      // Never log credentials, authorization headers, URLs with query strings, or request bodies.
      console.error("Render request failed", { code: error?.code ?? "unknown" });
      if (!res.headersSent) {
        res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          .end(JSON.stringify({ error: "Service unavailable" }));
      } else res.end();
    }
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const publicOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  if (!publicOrigin) throw new Error("Set PUBLIC_ORIGIN to the HTTPS origin of this Render service");
  const port = Number(process.env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  createRenderServer(publicOrigin).listen(port, "0.0.0.0", () => {
    console.log(`ApiDuck listening on port ${port}`);
  });
}
