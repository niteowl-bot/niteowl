// Resolves this project's "@/*" path alias for the Node test runner.
//
// Node has no knowledge of tsconfig "paths", so importing a module that
// itself does `import ... from "@/lib/supabase/admin"` fails without this.
// Loaded via `--import ./tests/register.mjs` (see the "test" script).
// TypeScript itself needs no loader — Node 24 strips types natively.

import { registerHooks, createRequire } from "node:module";
import { existsSync, statSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

// Framework modules the lead engine imports but Node cannot resolve
// outside the Next build. See tests/stubs/next-server.mjs.
const STUBS = {
  "next/server": path.resolve(import.meta.dirname, "stubs", "next-server.mjs"),
  // Needed by lib/supabase/server.ts, i.e. by every authenticated
  // dashboard route a test drives. See tests/stubs/next-headers.mjs.
  "next/headers": path.resolve(import.meta.dirname, "stubs", "next-headers.mjs"),
  // Needed by any test that RENDERS a dashboard component: they import
  // it at module scope. See tests/stubs/next-link.mjs.
  "next/link": path.resolve(import.meta.dirname, "stubs", "next-link.mjs"),
};

// ── .tsx support ──────────────────────────────────────────────────
// Node's native type stripping covers every ".ts" module here. It does
// NOT transform JSX, so importing a ".tsx" fails with
// ERR_UNKNOWN_FILE_EXTENSION — which is why no test could render a
// dashboard component until now, and why the leads drawer had no
// coverage of what it actually puts on screen.
//
// The project's own TypeScript compiler does the transform. It is
// already a devDependency and already what `npx tsc --noEmit` checks
// these files with, so this adds no dependency and no second toolchain:
// the same compiler, asked for JS instead of diagnostics. Types are
// erased here, never checked — tsc remains the only type authority.
//
// Loaded through createRequire because registerHooks' hooks run
// SYNCHRONOUSLY, in-thread: there is no await available inside load().
const require = createRequire(import.meta.url);
let ts;

function transpileTsx(source, url) {
  ts ??= require("typescript");
  return ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      // The automatic runtime, matching this project's tsconfig, so the
      // emitted code imports react/jsx-runtime rather than needing React
      // in scope.
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "react",
    },
  }).outputText;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { url: pathToFileURL(STUBS[specifier]).href, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
      for (const candidate of candidates) {
        // isFile(), not existsSync(): a bare "@/lib/integrations/providers"
        // matches the DIRECTORY, and handing Node a directory to load
        // fails with EISDIR instead of falling through to its index.ts.
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // ".ts" is deliberately untouched: Node already handles it, and
    // every existing test depends on that path staying exactly as it is.
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const loaded = nextLoad(url, { ...context, format: "module" });
    const source = typeof loaded.source === "string"
      ? loaded.source
      : Buffer.from(loaded.source).toString("utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: transpileTsx(source, url),
    };
  },
});
