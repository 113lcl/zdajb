import fs from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function copyPublicAssets(): Plugin {
  const files = ["favicon.svg", "og-image.svg"];

  return {
    name: "copy-public-assets-without-media",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const requestedFile = req.url?.split("?")[0]?.replace(/^\/+/, "");
        if (!requestedFile || !files.includes(requestedFile)) return next();

        const source = path.resolve("public", requestedFile);
        if (!fs.existsSync(source)) return next();

        res.setHeader("Content-Type", "image/svg+xml");
        fs.createReadStream(source).pipe(res);
      });
    },
    closeBundle() {
      for (const file of files) {
        const source = path.resolve("public", file);
        const target = path.resolve("dist", file);
        if (fs.existsSync(source)) fs.copyFileSync(source, target);
      }
    }
  };
}

function localApiProxy(): Plugin {
  return {
    name: "local-api-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api") && !url.startsWith("/media")) return next();

        const proxyReq = http.request(
          {
            hostname: "127.0.0.1",
            port: 4174,
            path: url,
            method: req.method,
            headers: {
              ...req.headers,
              host: "127.0.0.1:4174"
            }
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );

        proxyReq.on("error", () => {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          }
          res.end(JSON.stringify({ error: "DEV_PROXY_FAILED" }));
        });

        req.pipe(proxyReq);
      });
    }
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [
    localApiProxy(),
    react(),
    copyPublicAssets(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Zdaj B",
        short_name: "Zdaj B",
        description: "Trening teorii prawa jazdy kategorii B z trybem egzaminu i powtorkami.",
        theme_color: "#1E1E22",
        background_color: "#1E1E22",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4174", "/media": "http://127.0.0.1:4174" }
  },
  build: {
    chunkSizeWarningLimit: 900
  }
});
