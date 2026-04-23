import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST_DIR = path.join(ROOT, 'models', 'openai', 'privacy-filter');
const REQUIRED_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'viterbi_calibration.json',
  path.join('onnx', 'model_q4.onnx'),
  path.join('onnx', 'model_q4.onnx_data'),
];

async function main() {
  const sourceArg = process.argv[2];
  if (!sourceArg) {
    console.error('Usage: npm run stage:model -- /path/to/privacy-filter');
    process.exit(1);
  }

  const sourceRoot = path.resolve(process.cwd(), sourceArg);

  for (const relativePath of REQUIRED_FILES) {
    const sourcePath = path.join(sourceRoot, relativePath);
    try {
      await fs.access(sourcePath);
    } catch {
      console.error(`Missing required model file: ${sourcePath}`);
      process.exit(1);
    }
  }

  await fs.rm(DEST_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(DEST_DIR, 'onnx'), { recursive: true });

  for (const relativePath of REQUIRED_FILES) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destPath = path.join(DEST_DIR, relativePath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(sourcePath, destPath);
    console.log(`Copied ${relativePath}`);
  }

  console.log(`\nPrivacy Filter model staged at ${DEST_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
