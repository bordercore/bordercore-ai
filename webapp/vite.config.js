const path = require("path");
const { defineConfig } = require("vite");
const fs = require("fs");

const isProduction = process.env.NODE_ENV === "production";

// Resolve @optional-module: use local/optional.js if it exists, otherwise fallback.js
const optionalModulePath = fs.existsSync(path.resolve(__dirname, "local/optional.js"))
  ? path.resolve(__dirname, "local/optional.js")
  : path.resolve(__dirname, "fallback.js");

module.exports = defineConfig({
  plugins: [],
  esbuild: {
    jsx: "automatic",
  },
  base: isProduction ? "/static/vite/" : "/",
  root: __dirname,
  server: {
    host: "0.0.0.0",
    port: 5180,
    strictPort: true,
    cors: true,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "ssl/server.key")),
      cert: fs.readFileSync(path.resolve(__dirname, "ssl/server.crt")),
    },
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
          "three": ["three"],
        },
      },
    },
  },
});
