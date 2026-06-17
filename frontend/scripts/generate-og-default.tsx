/**
 * Regenerate the committed default generic OG card → public/ogs/generic.png.
 * Run after changing the generic card design / tagline / d2 hero:  npm run generate-og
 */
import 'dotenv/config';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { renderDefaultGenericCardBuffer } from '../lib/og/og-cards';

async function main() {
  const raw = await renderDefaultGenericCardBuffer();
  const png = await sharp(raw).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  const dir = path.join(process.cwd(), 'public/ogs');
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'generic.png');
  writeFileSync(out, png);
  console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)}KB)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
