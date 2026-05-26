#!/usr/bin/env node
/**
 * Aggregates React DevTools "Consider memoization" warnings from a Chrome
 * DevTools performance trace, and reports the worst-offending components and
 * props.
 *
 * Capture a trace in Chrome DevTools (Performance panel) with React DevTools
 * extension installed and "User timings" enabled — React emits `blink.user_timing`
 * begin/end events for every component render, with a `detail` payload that
 * includes the "Referentially unequal but deeply equal objects. Consider
 * memoization." annotation per prop.
 *
 * Usage:
 *   node frontend/scripts/analyze-perf-trace.mjs path/to/trace.json
 *
 * The trace file is typically large (hundreds of MB). Run with extra heap if
 * needed: `node --max-old-space-size=4096 ...`.
 */
import fs from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: analyze-perf-trace.mjs <trace.json>');
  process.exit(1);
}

const raw = fs.readFileSync(path, 'utf8');
const trace = JSON.parse(raw);
const events = trace.traceEvents;

const memoNeedle = 'Consider memoization';

// componentName -> count of render events that mentioned "Consider memoization"
const byComponent = new Map();
// componentName -> prop -> count
const byProp = new Map();
// componentName -> total render events (regardless of memoization)
const componentRenderTotals = new Map();

let totalRenders = 0;
let totalMemoFlags = 0;

for (const ev of events) {
  if (typeof ev !== 'object' || ev === null) continue;
  if (ev.cat !== 'blink.user_timing') continue;
  if (ev.ph !== 'b') continue; // begin events carry the detail
  const name = (ev.name || '').replace(/^​/, ''); // strip zero-width space prefix
  if (!name) continue;

  totalRenders++;
  componentRenderTotals.set(name, (componentRenderTotals.get(name) || 0) + 1);

  const detailStr = ev.args?.detail;
  if (typeof detailStr !== 'string') continue;
  if (!detailStr.includes(memoNeedle)) continue;

  totalMemoFlags++;
  byComponent.set(name, (byComponent.get(name) || 0) + 1);

  // Parse detail to extract prop names that were flagged
  try {
    const d = JSON.parse(detailStr);
    const props = d.devtools?.properties || [];
    for (const [propName, propVal] of props) {
      if (typeof propVal === 'string' && propVal.includes(memoNeedle)) {
        const key = propName.trim().replace(/^[+\-±•]\s*/, '');
        const m = byProp.get(name) || new Map();
        m.set(key, (m.get(key) || 0) + 1);
        byProp.set(name, m);
      }
    }
  } catch {
    // best-effort; skip malformed detail
  }
}

console.log(`Total render events: ${totalRenders}`);
console.log(`Render events flagged "${memoNeedle}": ${totalMemoFlags} (${(100 * totalMemoFlags / totalRenders).toFixed(1)}%)\n`);

const arr = [...byComponent.entries()].sort(([, a], [, b]) => b - a);
console.log('Top components by memoization warnings:');
console.log('  flags |  total renders | %wasted | component');
console.log('--------+----------------+---------+----------');
for (const [name, flags] of arr.slice(0, 40)) {
  const total = componentRenderTotals.get(name) || flags;
  const pct = (100 * flags / total).toFixed(0);
  console.log(`${String(flags).padStart(7)} | ${String(total).padStart(14)} | ${pct.padStart(5)}% | ${name}`);
}

console.log('\nTop offending (component, prop) pairs:');
const pairs = [];
for (const [comp, m] of byProp) {
  for (const [prop, n] of m) pairs.push({ comp, prop, n });
}
pairs.sort((a, b) => b.n - a.n);
for (const p of pairs.slice(0, 30)) {
  console.log(`  ${String(p.n).padStart(6)}  ${p.comp.padEnd(28)}  prop=${p.prop}`);
}
