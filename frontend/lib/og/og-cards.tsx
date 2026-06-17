/**
 * Open Graph card layouts (server-only). No `lib/connections` here (which pulls the
 * @polyglot-sql WASM), so this stays safe to render from the metadata image routes.
 * Heavy share-card logic (resolve → blur → compose) lives in og-image.tsx.
 */
import 'server-only';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ImageResponse } from 'next/og';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { getBrandLogoExpandedUrl, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import { MINUSX_TAGLINE } from '@/lib/og/og-helpers';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export type CoverTone = 'light' | 'dark';

const PAPER = '#f4f1ea';
const INK_MUTED = '#3a4046';
const FADE = 'linear-gradient(to bottom, rgba(247,246,241,0.3), rgba(247,246,241,0.4) 50%, rgba(247,246,241,0.3))';
const COVER_GRADIENT =
  'linear-gradient(to bottom, rgba(8,13,16,0) 0%, rgba(8,13,16,0.06) 20%, rgba(7,14,16,0.64) 54%, rgba(5,10,12,0.97) 100%)';
const COVER_ACCENT = '#3dd9bf';

/** Resolved assets for one render: the d2 hero + the org's expanded wordmarks (light/dark). */
export interface CardAssets {
  bg: string;
  /** Black wordmark — for light backgrounds. */
  logo: string;
  /** White wordmark — for dark backgrounds. */
  logoLight: string;
}

// JetBrains Mono ships in public/fonts (also used by chart rendering).
let fontCache: Array<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }> | null = null;
function loadFonts() {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), 'public/fonts');
  const read = (f: string) => fs.readFileSync(path.join(dir, f));
  fontCache = [
    { name: 'JetBrains Mono', data: read('JetBrainsMono-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'JetBrains Mono', data: read('JetBrainsMono-Bold.ttf'), weight: 700, style: 'normal' },
  ];
  return fontCache;
}

export function imageResponse(element: React.ReactElement): ImageResponse {
  return new ImageResponse(element, {
    ...OG_SIZE,
    fonts: loadFonts(),
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
  });
}

let bgCache: string | null = null;
function loadBg(): string {
  if (!bgCache) {
    bgCache = `data:image/jpeg;base64,${fs.readFileSync(path.join(process.cwd(), 'public/hero/d2.jpg')).toString('base64')}`;
  }
  return bgCache;
}

/**
 * Resolve a branding logo URL to an inline PNG data URL satori can render. Handles data
 * URLs, remote URLs, and local `/public` paths, and normalizes everything (incl. SVG) to
 * PNG via sharp. Cached per URL.
 */
// Keyed by logo URL (deterministic, not per-request data) → safe to share across requests.
// eslint-disable-next-line no-restricted-syntax
const logoCache = new Map<string, string>();
async function resolveLogo(url: string): Promise<string> {
  const cached = logoCache.get(url);
  if (cached) return cached;
  let bytes: Buffer;
  if (url.startsWith('data:')) {
    bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  } else if (/^https?:/.test(url)) {
    const ab = (await fetch(url).then((r) => r.arrayBuffer())) as ArrayBuffer;
    bytes = Buffer.from(new Uint8Array(ab));
  } else {
    bytes = fs.readFileSync(path.join(process.cwd(), 'public', url.replace(/^\//, '')));
  }
  const png = await sharp(bytes).png().toBuffer(); // normalize PNG/SVG/WebP → PNG
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  logoCache.set(url, dataUrl);
  return dataUrl;
}

/** Load the d2 hero + the org's expanded wordmarks (merged config already includes defaults). */
export async function loadCardAssets(): Promise<CardAssets> {
  const { branding } = (await getConfigsForMode()).config;
  const [logo, logoLight] = await Promise.all([
    resolveLogo(getBrandLogoExpandedUrl(branding, 'light')),
    resolveLogo(getBrandLogoExpandedUrl(branding, 'dark')),
  ]);
  return { bg: loadBg(), logo, logoLight };
}

function heroBg(bg: string): React.ReactElement {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={bg} width={OG_SIZE.width} height={OG_SIZE.height} alt="" style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }} />;
}
function heroFade(): React.ReactElement {
  return <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: FADE }} />;
}
function madeWith(logo: string, color: string, w = 132): React.ReactElement {
  const h = Math.round((w * 180) / 820); // preserve 820×180 wordmark aspect
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
      <span style={{ display: 'flex', fontSize: 14, letterSpacing: 1, color, marginBottom: 8 }}>made with</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} width={w} height={h} alt="MinusX" />
    </div>
  );
}

/**
 * Per-story cover: the pre-blurred story screenshot under a cinematic top→bottom gradient,
 * with the brand mark top-right (black on a brightened/light top, white otherwise) and the
 * title anchored in the deep shadow at the bottom.
 */
export function StoryCoverCard(props: { coverUrl: string; title: string; tone: CoverTone; assets: CardAssets }): React.ReactElement {
  const topIsLight = props.tone === 'dark';
  const topLogo = topIsLight ? props.assets.logo : props.assets.logoLight;
  const topTextColor = topIsLight ? 'rgba(15,20,25,0.62)' : 'rgba(255,255,255,0.82)';
  return (
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', backgroundColor: '#0d1117', fontFamily: 'JetBrains Mono', overflow: 'hidden' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.coverUrl} width={OG_SIZE.width} height={OG_SIZE.height} alt="" style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }} />
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: COVER_GRADIENT }} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', width: '100%', height: '100%', padding: 56 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{madeWith(topLogo, topTextColor)}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 15, fontWeight: 700, letterSpacing: 3, color: COVER_ACCENT, marginBottom: 16 }}>
            <div style={{ display: 'flex', width: 26, height: 2, backgroundColor: COVER_ACCENT, marginRight: 12 }} />
            DATA STORY
          </div>
          <div style={{ display: 'flex', fontSize: 50, fontWeight: 700, color: '#ffffff', lineHeight: 1.08 }}>{props.title}</div>
        </div>
      </div>
    </div>
  );
}

/** Generic branded card: d2 hero + centered wordmark (black, for the light hero) + tagline. */
export function GenericCard(props: { assets: CardAssets }): React.ReactElement {
  const logoW = 450;
  const logoH = Math.round((logoW * 180) / 820);
  return (
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: PAPER, fontFamily: 'JetBrains Mono', overflow: 'hidden' }}>
      {heroBg(props.assets.bg)}
      {heroFade()}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={props.assets.logo} width={logoW} height={logoH} alt="MinusX" />
        <div style={{ display: 'flex', fontSize: 22, color: INK_MUTED, marginTop: 18 }}>{MINUSX_TAGLINE.toLowerCase()}</div>
      </div>
    </div>
  );
}

/**
 * Generic branded card — root fallback, un-captured stories, dead/revoked shares.
 *
 * For the default brand logo this is a fixed image, so serve a committed
 * `public/ogs/generic.png` (zero compute per crawl). Only when an org configures a custom
 * expanded logo — or the static file is missing — do we render it with satori.
 * (Regenerate the static with `npm run generate-og:generic`.)
 */
const GENERIC_STATIC = path.join(process.cwd(), 'public/ogs/generic.png');
export async function renderGenericOgImage(): Promise<Response> {
  const { branding } = (await getConfigsForMode()).config;
  const usesDefaultLogo =
    getBrandLogoExpandedUrl(branding, 'light') === DEFAULT_CONFIG.branding.logoExpanded &&
    getBrandLogoExpandedUrl(branding, 'dark') === DEFAULT_CONFIG.branding.logoExpandedDark;
  if (usesDefaultLogo && fs.existsSync(GENERIC_STATIC)) {
    return new Response(new Uint8Array(fs.readFileSync(GENERIC_STATIC)), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  }
  return imageResponse(<GenericCard assets={await loadCardAssets()} />);
}

/** Render the DEFAULT-branded generic card to a PNG buffer (used by `npm run generate-og`). */
export async function renderDefaultGenericCardBuffer(): Promise<Buffer> {
  const [logo, logoLight] = await Promise.all([
    resolveLogo(getBrandLogoExpandedUrl(DEFAULT_CONFIG.branding, 'light')),
    resolveLogo(getBrandLogoExpandedUrl(DEFAULT_CONFIG.branding, 'dark')),
  ]);
  const assets: CardAssets = { bg: loadBg(), logo, logoLight };
  return Buffer.from(await imageResponse(<GenericCard assets={assets} />).arrayBuffer());
}
