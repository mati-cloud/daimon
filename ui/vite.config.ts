import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { wraith } from "wraithterm/vite";
import type { Plugin } from "vite";

// Content-Security-Policy for the shipped page (build only: Vite's dev server needs inline
// scripts for HMR). Any injected script is limited to the app's own code and the local
// daemon: no remote scripts, frames, forms or connections.
//   script-src blob:            plugins and their module shims are imported from blob: URLs
//   'wasm-unsafe-eval'          the terminal renderer's WebAssembly
//   style-src 'unsafe-inline'   coloured output is <span style>, plugin CSS is a <style>
//   img-src https:              link-preview images and favicons
//   connect-src ws://localhost  the pty-daemon (port chosen at runtime)
export const CSP = [
  "default-src 'none'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "daimon-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  assetsInclude: ["**/*.wasm"],
  define: {
    __HOME__: JSON.stringify(process.env.HOME ?? "/Users/" + (process.env.USER ?? "")),
    __USER__: JSON.stringify(process.env.USER ?? ""),
  },
  // wraith(): keeps wraithterm's worker / wasm / font URLs intact through dep prebundling.
  plugins: [react(), tailwindcss(), wraith(), csp()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Never ship source maps.
    sourcemap: false,
    rolldownOptions: {
      input: "index.html",
      output: {
        // Libraries in their own chunks: no single bundle over Vite's 500 kB warning, and the
        // app's own chunk changes without invalidating the (larger, rarely changing) vendor ones.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "highlight", test: /node_modules[\\/]highlight\.js[\\/]/ },
            { name: "markdown", test: /node_modules[\\/](marked|dompurify)[\\/]/ },
            { name: "wraith", test: /node_modules[\\/]wraithterm[\\/]/ },
            { name: "ui-vendor", test: /node_modules[\\/](@radix-ui|@floating-ui|@tanstack|cmdk|lucide-react|sonner|vaul)[\\/]/ },
            // Plugin runtime: loaded only when a plugin needs it (see lib/daimon/plugins.ts).
            { name: "plugin-tailwind", test: /node_modules[\\/]tailwindcss[\\/]/ },
            { name: "plugin-sucrase", test: /node_modules[\\/](sucrase|lines-and-columns|ts-interface-checker)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  // Dev server (loopback by default), fixed port (the app's dev build loads it).
  server: { port: 7881, strictPort: true },
});
