#!/usr/bin/env tsx
/**
 * Render chart previews for visual inspection.
 *
 * Generates PNG images for various chart types and viz settings combinations.
 * Output: frontend/.chart-previews/<chartType>/<variant>.png
 *
 * Usage: npx tsx scripts/render-chart-previews.ts
 */
import fs from 'fs';
import path from 'path';
import { renderChartToPng } from '../lib/chart/render-chart';
import type { QueryResult } from '../lib/types';
import type { VizSettings } from '../lib/types.gen';

const OUTPUT_DIR = path.join(__dirname, '..', '.chart-previews');

// ── Sample datasets ──────────────────────────────────────────────────────────

const MONTHLY_REVENUE: QueryResult = {
  columns: ['month', 'revenue', 'cost', 'profit'],
  types: ['VARCHAR', 'INTEGER', 'INTEGER', 'INTEGER'],
  rows: [
    { month: 'Jan', revenue: 120, cost: 45, profit: 75 },
    { month: 'Feb', revenue: 200, cost: 80, profit: 120 },
    { month: 'Mar', revenue: 150, cost: 60, profit: 90 },
    { month: 'Apr', revenue: 280, cost: 100, profit: 180 },
    { month: 'May', revenue: 220, cost: 90, profit: 130 },
    { month: 'Jun', revenue: 310, cost: 120, profit: 190 },
  ],
};

const QUARTERLY_BY_REGION: QueryResult = {
  columns: ['quarter', 'region', 'sales'],
  types: ['VARCHAR', 'VARCHAR', 'INTEGER'],
  rows: [
    { quarter: 'Q1', region: 'North', sales: 400 },
    { quarter: 'Q1', region: 'South', sales: 300 },
    { quarter: 'Q1', region: 'East', sales: 250 },
    { quarter: 'Q2', region: 'North', sales: 450 },
    { quarter: 'Q2', region: 'South', sales: 350 },
    { quarter: 'Q2', region: 'East', sales: 280 },
    { quarter: 'Q3', region: 'North', sales: 500 },
    { quarter: 'Q3', region: 'South', sales: 320 },
    { quarter: 'Q3', region: 'East', sales: 310 },
    { quarter: 'Q4', region: 'North', sales: 520 },
    { quarter: 'Q4', region: 'South', sales: 400 },
    { quarter: 'Q4', region: 'East', sales: 350 },
  ],
};

const SCATTER_DATA: QueryResult = {
  columns: ['height', 'weight', 'gender'],
  types: ['FLOAT', 'FLOAT', 'VARCHAR'],
  rows: [
    { height: 165, weight: 60, gender: 'F' },
    { height: 170, weight: 70, gender: 'M' },
    { height: 175, weight: 75, gender: 'M' },
    { height: 160, weight: 55, gender: 'F' },
    { height: 180, weight: 85, gender: 'M' },
    { height: 168, weight: 65, gender: 'F' },
    { height: 172, weight: 72, gender: 'M' },
    { height: 163, weight: 58, gender: 'F' },
    { height: 185, weight: 90, gender: 'M' },
    { height: 158, weight: 52, gender: 'F' },
  ],
};

const CATEGORY_DATA: QueryResult = {
  columns: ['product', 'units_sold'],
  types: ['VARCHAR', 'INTEGER'],
  rows: [
    { product: 'Widget A', units_sold: 1200 },
    { product: 'Widget B', units_sold: 800 },
    { product: 'Widget C', units_sold: 600 },
    { product: 'Widget D', units_sold: 400 },
    { product: 'Widget E', units_sold: 200 },
  ],
};

const LARGE_TIMESERIES: QueryResult = {
  columns: ['date', 'users', 'sessions', 'bounces'],
  types: ['VARCHAR', 'INTEGER', 'INTEGER', 'INTEGER'],
  rows: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, '0')}`,
    users: Math.floor(500 + Math.random() * 500),
    sessions: Math.floor(800 + Math.random() * 700),
    bounces: Math.floor(100 + Math.random() * 300),
  })),
};

// ── Chart variations ─────────────────────────────────────────────────────────

interface ChartVariation {
  name: string;
  data: QueryResult;
  vizSettings: VizSettings;
  width?: number;
  height?: number;
}

const variations: ChartVariation[] = [
  // Bar charts
  { name: 'bar/single-series', data: MONTHLY_REVENUE, vizSettings: { type: 'bar', xCols: ['month'], yCols: ['revenue'] } },
  { name: 'bar/multi-series', data: MONTHLY_REVENUE, vizSettings: { type: 'bar', xCols: ['month'], yCols: ['revenue', 'cost', 'profit'] } },
  { name: 'bar/grouped-by-region', data: QUARTERLY_BY_REGION, vizSettings: { type: 'bar', xCols: ['quarter', 'region'], yCols: ['sales'] } },
  { name: 'bar/wide', data: MONTHLY_REVENUE, vizSettings: { type: 'bar', xCols: ['month'], yCols: ['revenue'] }, width: 1200 },
  { name: 'bar/many-categories', data: LARGE_TIMESERIES, vizSettings: { type: 'bar', xCols: ['date'], yCols: ['users'] }, width: 1200 },

  // Line charts
  { name: 'line/single-series', data: MONTHLY_REVENUE, vizSettings: { type: 'line', xCols: ['month'], yCols: ['revenue'] } },
  { name: 'line/multi-series', data: MONTHLY_REVENUE, vizSettings: { type: 'line', xCols: ['month'], yCols: ['revenue', 'cost', 'profit'] } },
  { name: 'line/timeseries-30d', data: LARGE_TIMESERIES, vizSettings: { type: 'line', xCols: ['date'], yCols: ['users', 'sessions'] }, width: 1000 },
  { name: 'line/three-series-30d', data: LARGE_TIMESERIES, vizSettings: { type: 'line', xCols: ['date'], yCols: ['users', 'sessions', 'bounces'] }, width: 1200 },

  // Area charts
  { name: 'area/single-series', data: MONTHLY_REVENUE, vizSettings: { type: 'area', xCols: ['month'], yCols: ['revenue'] } },
  { name: 'area/multi-series', data: MONTHLY_REVENUE, vizSettings: { type: 'area', xCols: ['month'], yCols: ['revenue', 'cost'] } },
  { name: 'area/timeseries', data: LARGE_TIMESERIES, vizSettings: { type: 'area', xCols: ['date'], yCols: ['users', 'bounces'] }, width: 1000 },

  // Scatter charts
  { name: 'scatter/basic', data: SCATTER_DATA, vizSettings: { type: 'scatter', xCols: ['height'], yCols: ['weight'] } },
  { name: 'scatter/grouped', data: SCATTER_DATA, vizSettings: { type: 'scatter', xCols: ['height', 'gender'], yCols: ['weight'] } },

  // Pie charts
  { name: 'pie/basic', data: CATEGORY_DATA, vizSettings: { type: 'pie', xCols: ['product'], yCols: ['units_sold'] } },
  { name: 'pie/revenue-by-month', data: MONTHLY_REVENUE, vizSettings: { type: 'pie', xCols: ['month'], yCols: ['revenue'] } },

  // Funnel charts
  { name: 'funnel/basic', data: CATEGORY_DATA, vizSettings: { type: 'funnel', xCols: ['product'], yCols: ['units_sold'] } },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }

  let rendered = 0;
  let failed = 0;

  for (const v of variations) {
    const pngBuf = await renderChartToPng(v.data, v.vizSettings, {
      width: v.width ?? 800,
      height: v.height ?? 400,
    });

    if (!pngBuf) {
      console.log(`  SKIP  ${v.name} (returned null)`);
      failed++;
      continue;
    }

    const outPath = path.join(OUTPUT_DIR, `${v.name}.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, pngBuf);

    console.log(`  OK    ${v.name}`);
    rendered++;
  }

  console.log(`\nDone: ${rendered} rendered, ${failed} skipped`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
