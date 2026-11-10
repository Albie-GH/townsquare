// Copies the RNNoise worklet and wasm files from node_modules into public/rnnoise,
// so the browser can load them as plain files.
// Run once after installing:  node scripts/copy-rnnoise.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkgDir = path.join(root, "node_modules", "@sapphi-red", "web-noise-suppressor");
const outDir = path.join(root, "public", "rnnoise");

if (!fs.existsSync(pkgDir)) {
  console.error("Package not found. Run first:  npm install @sapphi-red/web-noise-suppressor");
  process.exit(1);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

// skip any node_modules nested inside the package (the package itself lives in one)
const files = walk(pkgDir).filter(
  f => !path.relative(pkgDir, f).split(path.sep).includes("node_modules")
);
const find = test => files.find(f => test(f.split(path.sep).join("/")));

const wanted = {
  "rnnoise.wasm": find(f => f.endsWith("/rnnoise.wasm")),
  "rnnoise_simd.wasm": find(f => f.endsWith("/rnnoise_simd.wasm")),
  "rnnoiseWorklet.js": find(
    f => /rnnoise/i.test(f) && /(workletProcessor|rnnoiseWorklet)\.js$/.test(f)
  )
};

fs.mkdirSync(outDir, { recursive: true });
let missing = 0;
for (const [name, src] of Object.entries(wanted)) {
  if (!src) {
    console.error(`Could not find ${name} in the package`);
    missing++;
    continue;
  }
  fs.copyFileSync(src, path.join(outDir, name));
  console.log(`Copied ${name}`);
}
if (missing) {
  console.error("\nFiles in the package:");
  files.forEach(f => console.error("  " + path.relative(pkgDir, f)));
  process.exit(1);
}
console.log("Done. RNNoise files are in public/rnnoise");
