// Resolved at build time by a Vite alias (see webapp/vite.config.mjs) to
// either local/optional.js or fallback.js. The exported shape depends on
// which file is resolved, so declare as `any`.
declare module "@optional-module";
