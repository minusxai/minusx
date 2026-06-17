/**
 * Open Graph card layouts (server-only). No DB/connectors here, so this stays safe to
 * pull into any route's <head> metadata graph. Heavy share-card logic (resolve → blur →
 * compose) lives in og-image.tsx.
 */
import 'server-only';
import fs from 'fs';
import path from 'path';
import { ImageResponse } from 'next/og';
import { MINUSX_TAGLINE } from '@/lib/og/og-helpers';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export type CoverTone = 'light' | 'dark';

const PAPER = '#f4f1ea';
const INK_MUTED = '#3a4046';
const FADE = 'linear-gradient(to bottom, rgba(247,246,241,0.3), rgba(247,246,241,0.4) 50%, rgba(247,246,241,0.3))';
const COVER_GRADIENT =
  'linear-gradient(to bottom, rgba(8,13,16,0) 0%, rgba(8,13,16,0.06) 20%, rgba(7,14,16,0.64) 54%, rgba(5,10,12,0.97) 100%)';
const COVER_ACCENT = '#3dd9bf';

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

// d2 hero + minusx wordmarks, read once as base64 (satori needs inline image bytes).
let assetCache: { bg: string; logo: string; logoLight: string } | null = null;
function loadAssets() {
  if (assetCache) return assetCache;
  const root = path.join(process.cwd(), 'public');
  const b64 = (p: string, mime: string) =>
    `data:${mime};base64,${fs.readFileSync(path.join(root, p)).toString('base64')}`;
  assetCache = {
    bg: b64('hero/d2.jpg', 'image/jpeg'),
    logo: b64('logo_full_dark.png', 'image/png'), // black wordmark (for light backgrounds)
    logoLight: b64('logo_full.png', 'image/png'), // white wordmark (for dark backgrounds)
  };
  return assetCache;
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
export function StoryCoverCard(props: { coverUrl: string; title: string; tone?: CoverTone }): React.ReactElement {
  const { logo, logoLight } = loadAssets();
  const topIsLight = (props.tone ?? 'light') === 'dark';
  const topLogo = topIsLight ? logo : logoLight;
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

/** Generic branded card: d2 hero + centered minusx logo + tagline. */
export function GenericCard(): React.ReactElement {
  const { bg, logo } = loadAssets();
  const logoW = 380;
  const logoH = Math.round((logoW * 180) / 820);
  return (
    <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: PAPER, fontFamily: 'JetBrains Mono', overflow: 'hidden' }}>
      {heroBg(bg)}
      {heroFade()}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={logoW} height={logoH} alt="MinusX" />
        <div style={{ display: 'flex', fontSize: 27, color: INK_MUTED, marginTop: 24 }}>{MINUSX_TAGLINE}</div>
      </div>
    </div>
  );
}

/** Generic branded MinusX card — root fallback, un-captured stories, dead/revoked shares. */
export async function renderGenericOgImage(): Promise<Response> {
  return imageResponse(<GenericCard />);
}
