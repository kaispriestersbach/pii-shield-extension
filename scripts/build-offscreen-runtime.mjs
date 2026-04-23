import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'node_modules', '@huggingface', 'transformers', 'dist');
const TARGET_DIR = path.join(ROOT, 'offscreen', 'vendor');
const RUNTIME_FILES = [
  'transformers.web.js',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];
const LEGACY_ARTIFACTS = [
  path.join(ROOT, 'offscreen', 'offscreen.bundle.js'),
  path.join(ROOT, 'offscreen', 'offscreen.bundle.js.map'),
];

async function main() {
  await fs.mkdir(TARGET_DIR, { recursive: true });

  for (const filename of RUNTIME_FILES) {
    const sourcePath = path.join(SOURCE_DIR, filename);
    const targetPath = path.join(TARGET_DIR, filename);
    await fs.copyFile(sourcePath, targetPath);
    console.log(`Copied ${filename}`);
  }

  for (const artifactPath of LEGACY_ARTIFACTS) {
    await fs.rm(artifactPath, { force: true });
  }

  console.log(`\nOffscreen runtime staged at ${TARGET_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
