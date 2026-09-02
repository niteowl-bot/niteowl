// Node cannot resolve "next/link" outside the Next build, and the leads
// dashboard component imports it at module scope. Rendering that
// component in a test therefore fails on the import alone, before any
// assertion runs.
//
// Deliberately minimal: an <a>. The tests that use it assert on the
// canonical VALUES a surface renders, never on Next's routing, so a
// faithful Link implementation would add moving parts without adding
// coverage. See tests/stubs/next-server.mjs for the same reasoning.
import { createElement } from "react";

export default function Link({ href, children, ...rest }) {
  return createElement("a", { href, ...rest }, children);
}
