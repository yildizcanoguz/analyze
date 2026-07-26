// Bundles the game — Three.js included — into one self-contained HTML file
// that runs from the filesystem with no server and no network access.
//
//   npm install && npm run build
//
// Output: dist/claude-of-duty.html
// Pass --fragment to also emit dist/claude-of-duty.page.html, the same page
// without the <!doctype>/<html>/<head>/<body> wrapper, for embedding.

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const result = await build({
  entryPoints: [path.join(root, "src/main.js")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  legalComments: "inline", // keep the Three.js MIT banner in the output
  target: ["chrome100", "firefox100", "safari15"],
  alias: { three: path.join(root, "vendor/three.module.min.js") },
});

// A literal </script> anywhere in the bundle would close the tag early.
const js = result.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");

const html = read("index.html");
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
const markup = html
  .match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/<script type="importmap">[\s\S]*?<\/script>/g, "")
  .replace(/<script type="module"[^>]*><\/script>/g, "")
  .trim();

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
  "<text y='0.9em' font-size='90'>🎯</text></svg>";

const page = `<title>CLAUDE OF DUTY</title>
<style>
${style}
</style>
${markup}
<script>
${js}
</script>`;

mkdirSync(path.join(root, "dist"), { recursive: true });

const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="${FAVICON}">
${page.slice(0, page.indexOf("</style>") + 8)}
</head>
<body>
${page.slice(page.indexOf("</style>") + 8).trim()}
</body>
</html>
`;

writeFileSync(path.join(root, "dist/claude-of-duty.html"), doc);
console.log(`dist/claude-of-duty.html  ${(doc.length / 1024).toFixed(0)} KB`);

if (process.argv.includes("--fragment")) {
  writeFileSync(path.join(root, "dist/claude-of-duty.page.html"), page + "\n");
  console.log(`dist/claude-of-duty.page.html  ${(page.length / 1024).toFixed(0)} KB`);
}
