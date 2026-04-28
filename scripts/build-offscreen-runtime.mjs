import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRANSFORMERS_DIST_DIR = path.join(ROOT, 'node_modules', '@huggingface', 'transformers', 'dist');
const ONNXRUNTIME_WEB_DIST_DIR = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const TARGET_DIR = path.join(ROOT, 'offscreen', 'vendor');
const RUNTIME_FILES = [
  { sourceDir: TRANSFORMERS_DIST_DIR, filename: 'transformers.js' },
  { sourceDir: TRANSFORMERS_DIST_DIR, filename: 'ort-wasm-simd-threaded.jsep.mjs' },
  { sourceDir: TRANSFORMERS_DIST_DIR, filename: 'ort-wasm-simd-threaded.jsep.wasm' },
  { sourceDir: ONNXRUNTIME_WEB_DIST_DIR, filename: 'ort.bundle.min.mjs' },
];
const LEGACY_ARTIFACTS = [
  path.join(ROOT, 'offscreen', 'offscreen.bundle.js'),
  path.join(ROOT, 'offscreen', 'offscreen.bundle.js.map'),
  path.join(TARGET_DIR, 'transformers.web.js'),
];

async function main() {
  await fs.mkdir(TARGET_DIR, { recursive: true });

  for (const { sourceDir, filename } of RUNTIME_FILES) {
    const sourcePath = path.join(sourceDir, filename);
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
