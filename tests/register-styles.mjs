import { createRequire } from "node:module";

// Node component tests exercise behavior; Next.js and the browser tests load
// the actual stylesheets and verify their layout, accessibility, and budgets.
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
