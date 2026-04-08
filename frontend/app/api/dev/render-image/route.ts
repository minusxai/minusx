/**
 * Dev-only endpoint: server-side chart render for comparison testing.
 *
 * Accepts queryResult + vizSettings from the client, renders via ECharts SSR
 * (renderChartToJpeg), and returns a base64 data URL for display in devtools.
 *
 * Used exclusively by DevToolsPanel to compare server render vs client render quality.
 */
import { NextRequest, NextResponse } from 'next/server';
import { renderChartToJpeg } from '@/lib/chart/render-chart';
import { handleApiError } from '@/lib/api/api-responses';
import type { QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

export async function POST(req: NextRequest) {
  try {
    const { queryResult, vizSettings, colorMode = 'dark' } = (await req.json()) as {
      queryResult: QueryResult;
      vizSettings: VizSettings;
      colorMode?: 'light' | 'dark';
    };

    const buffer = await renderChartToJpeg(queryResult, vizSettings, { colorMode, width: 512, height: 256 });
    if (!buffer) {
      return NextResponse.json({ error: 'Could not render chart (unsupported type or empty data)' }, { status: 422 });
    }

    const base64 = buffer.toString('base64');
    return NextResponse.json({ dataUrl: `data:image/jpeg;base64,${base64}` });
  } catch (error) {
    return handleApiError(error);
  }
}
