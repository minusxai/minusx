import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { DEFAULT_CONFIG, type OrgBranding } from '@/lib/branding/whitelabel';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { immutableSet } from '@/lib/utils/immutable-collections';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_SIZES = immutableSet([192, 512]);
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

function customValue(value: string | undefined, fallback: string | undefined): string | null {
  return value && value !== fallback ? value : null;
}

/** Prefer a configured logo, then a configured favicon, then the bundled MinusX mark. */
function selectPwaIconSource(branding: OrgBranding): string {
  return (
    customValue(branding.logoDark, DEFAULT_CONFIG.branding.logoDark) ||
    customValue(branding.logoLight, DEFAULT_CONFIG.branding.logoLight) ||
    customValue(branding.favicon, DEFAULT_CONFIG.branding.favicon) ||
    branding.logoDark ||
    branding.logoLight ||
    '/logox.svg'
  );
}

async function readSource(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma < 0) throw new Error('Invalid data URL');
    const metadata = source.slice(0, comma);
    const payload = source.slice(comma + 1);
    const bytes = metadata.endsWith(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload));
    if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Brand icon is too large');
    return bytes;
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Brand icon returned HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_SOURCE_BYTES) throw new Error('Brand icon is too large');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Brand icon is too large');
    return bytes;
  }

  const pathname = decodeURIComponent(source.split(/[?#]/, 1)[0]).replace(/^\/+/, '');
  const publicRoot = path.resolve(process.cwd(), 'public');
  const filePath = path.resolve(publicRoot, pathname);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error('Brand icon path escapes public directory');
  }
  const bytes = await fs.readFile(filePath);
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('Brand icon is too large');
  return bytes;
}

async function renderIcon(source: Buffer, size: number, maskable: boolean): Promise<Buffer> {
  // Maskable icons need a larger safe area because launchers may crop them to a circle/squircle.
  const innerSize = Math.round(size * (maskable ? 0.625 : 0.78));
  const foreground = await sharp(source, { density: 384 })
    .resize(innerSize, innerSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: '#0D1117',
    },
  })
    .composite([{ input: foreground, gravity: 'center' }])
    .png()
    .toBuffer();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ size: string }> },
) {
  const size = Number((await params).size);
  if (!ALLOWED_SIZES.has(size)) return new Response('Not found', { status: 404 });

  const config = await getConfigsForMode().then(({ config }) => config).catch(() => DEFAULT_CONFIG);
  const configuredSource = selectPwaIconSource(config.branding);
  let source: Buffer;
  try {
    source = await readSource(configuredSource);
  } catch (error) {
    console.warn('[PWA icon] Failed to load configured brand icon; using default', error);
    source = await readSource('/logox.svg');
  }

  try {
    const png = await renderIcon(source, size, request.nextUrl.searchParams.get('maskable') === '1');
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[PWA icon] Failed to render brand icon', error);
    return new Response('Failed to render icon', { status: 500 });
  }
}
