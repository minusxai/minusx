/**
 * Dev-only endpoint: server-side chart render for comparison testing.
 *
 * Accepts queryResult + vizSettings from the client (or an array for dashboards),
 * renders via ECharts SSR (renderChartToJpeg), and returns a base64 data URL.
 *
 * Never adds its own logo/branding — the devtools panel handles watermarking
 * client-side so the watermark checkbox controls all render paths uniformly.
 *
 * Used exclusively by DevToolsPanel to compare server render vs client render quality.
 */
import { NextRequest, NextResponse } from 'next/server';
import { renderChartToJpeg } from '@/lib/chart/render-chart';
import { handleApiError } from '@/lib/api/api-responses';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

type SinglePayload = {
  mode: 'single';
  queryResult: QueryResult;
  vizSettings: VizSettings;
  titleOverride?: string;
  colorMode?: 'light' | 'dark';
  width?: number;
  height?: number;
};

type DashboardPayload = {
  mode: 'dashboard';
  charts: Array<{ queryResult: QueryResult; vizSettings: VizSettings; titleOverride?: string }>;
  colorMode?: 'light' | 'dark';
  width?: number;
  height?: number;
};

// Disable logo by passing a path that won't exist — renderChartToJpeg skips logo if file not found
const NO_LOGO = '/dev/null/no-logo';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SinglePayload | DashboardPayload;
    const colorMode = body.colorMode ?? 'dark';
    const width = body.width ?? 512;
    const height = body.height ?? 256;
    const renderOpts = { colorMode, width, height, logoPath: NO_LOGO };

    if (body.mode === 'single' || !body.mode) {
      const { queryResult, vizSettings, titleOverride } = body as SinglePayload;
      const buffer = await renderChartToJpeg(queryResult, vizSettings, { ...renderOpts, titleOverride });
      if (!buffer) {
        return NextResponse.json({ error: 'Could not render chart (unsupported type or empty data)' }, { status: 422 });
      }
      return NextResponse.json({ dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` });
    }

    // Dashboard: render each chart and stack vertically
    const { charts } = body as DashboardPayload;
    if (!charts.length) {
      return NextResponse.json({ error: 'No renderable charts in dashboard' }, { status: 422 });
    }

    const buffers: Buffer[] = [];
    for (const { queryResult, vizSettings, titleOverride } of charts) {
      const buf = await renderChartToJpeg(queryResult, vizSettings, { ...renderOpts, titleOverride });
      if (buf) buffers.push(buf);
    }

    if (!buffers.length) {
      return NextResponse.json({ error: 'All charts failed to render' }, { status: 422 });
    }

    // Return each chart as a separate image (client stacks/displays them individually)
    const images = buffers.map(buf => `data:image/jpeg;base64,${buf.toString('base64')}`);
    return NextResponse.json({ images });
  } catch (error) {
    return handleApiError(error);
  }
}
