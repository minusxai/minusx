import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const src = join(root, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const dest = join(root, 'public', 'duckdb');

if (!existsSync(src)) {
  console.warn('DuckDB WASM dist not found, skipping copy');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });

const files = readdirSync(src).filter(f => f.endsWith('.wasm') || f.endsWith('.worker.js'));
for (const file of files) {
  copyFileSync(join(src, file), join(dest, file));
}

console.log(`DuckDB WASM: copied ${files.length} files to public/duckdb/`);
