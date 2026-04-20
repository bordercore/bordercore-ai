import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

// Resolve @optional-module: use local/optional.js if it exists, otherwise fallback.js
const optionalModulePath = fs.existsSync(path.resolve(__dirname, "local/optional.js"))
  ? path.resolve(__dirname, "local/optional.js")
  : path.resolve(__dirname, "fallback.js");

// SSL certs are gitignored and only exist in local dev environments; skip
// HTTPS config entirely when they're missing so CI (build-only) can load this
// file without ENOENT.
const sslKeyPath = path.resolve(__dirname, "ssl/server.key");
const sslCertPath = path.resolve(__dirname, "ssl/server.crt");
const httpsConfig =
  fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)
    ? {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath),
      }
    : undefined;

export default defineConfig({
  plugins: [tailwindcss()],
  esbuild: {
    jsx: "automatic",
  },
  base: isProduction ? "/static/vite/" : "/",
  root: __dirname,
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5180,
    strictPort: true,
    cors: true,
    // Vite 5.4+ rejects WS upgrades from any hostname not in this list
    // (only IPv4 and *.localhost are auto-allowed). Without this, HMR
    // breaks for custom hostnames like ai.bordercore.com.
    allowedHosts: ["ai.bordercore.com", "deepvirtual"],
    https: httpsConfig,
    hmr: {
      port: 5180,
    },
    proxy: {
      "/chat": { target: "https://localhost:5000", secure: false },
      "/rag": { target: "https://localhost:5000", secure: false },
      "/audio": { target: "https://localhost:5000", secure: false },
      "/info": { target: "https://localhost:5000", secure: false },
      "/list": { target: "https://localhost:5000", secure: false },
      "/load": { target: "https://localhost:5000", secure: false },
      "/speech2text": { target: "https://localhost:5000", secure: false },
      "/mark_as_played": { target: "https://localhost:5000", secure: false },
      "/gpu": { target: "https://localhost:5000", secure: false },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "front-end"),
      "@optional-module": optionalModulePath,
    },
  },
  build: {
    outDir: path.resolve(__dirname, "static", "vite"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        "dist/css/styles": path.resolve(__dirname, "front-end", "entries", "styles-css.js"),
        "dist/js/chatbot": path.resolve(__dirname, "front-end", "entries", "chatbot.tsx"),
      },
      output: {
        entryFileNames: "[name]-[hash].js",
        assetFileNames: "[name]-[hash][extname]",
        manualChunks: {
          "highlight.js": ["highlight.js"],
          "katex": ["katex"],
          "markdown-it": ["markdown-it"],
          "ogl": ["ogl"],
          "three": ["three"],
        },
      },
    },
  },
});
