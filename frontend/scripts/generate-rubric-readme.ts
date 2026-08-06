#!/usr/bin/env tsx
/**
 * Generate `lib/rubric/README.md` from the rubric check catalogs.
 *
 * Both deterministic and LLM tables come directly from the catalogs in `lib/rubric/checks.ts`.
 *
 * Usage:
 *   npm run generate-rubric-readme
 *   npm run generate-rubric-readme -- --check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DETERMINISTIC_CHECKS, LLM_CHECKS } from '../lib/rubric/checks';
import type { RubricCategory, RubricFileType, RubricSeverity } from '../lib/rubric/types';

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(FRONTEND_ROOT, 'lib/rubric/README.md');
const FILE_TYPES: readonly RubricFileType[] = ['question', 'dashboard', 'story', 'context'];
const CATEGORY_ORDER: readonly RubricCategory[] = ['correctness', 'clarity', 'aesthetics'];
function validateCatalogs(): void {
  const cataloged = new Set<string>();
  for (const fileType of FILE_TYPES) {
    for (const check of DETERMINISTIC_CHECKS[fileType]) {
      if (cataloged.has(check.ruleId)) throw new Error(`Duplicate deterministic check id: ${check.ruleId}`);
      cataloged.add(check.ruleId);
      if (!check.ruleId.startsWith(`${fileType}.`)) {
        throw new Error(`Deterministic check ${check.ruleId} does not belong to ${fileType}`);
      }
      if (Array.isArray(check.severity) && check.severity.length === 0) {
        throw new Error(`Deterministic check ${check.ruleId} has no failure severity`);
      }
    }
  }

  const llmIds = new Set<string>();
  for (const fileType of FILE_TYPES) {
    for (const check of LLM_CHECKS[fileType]) {
      const ruleId = `llm.${check.id}`;
      if (llmIds.has(ruleId)) throw new Error(`Duplicate LLM check id: ${ruleId}`);
      llmIds.add(ruleId);
    }
  }
}

function cell(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
}

function code(value: string): string {
  return `\`${value}\``;
}

function categoryList(categories: Iterable<RubricCategory>): string {
  const set = new Set(categories);
  return CATEGORY_ORDER.filter((category) => set.has(category)).join(', ') || 'none';
}

function severityList(severity: RubricSeverity | readonly RubricSeverity[]): string {
  return (typeof severity === 'string' ? [severity] : severity).join(' / ');
}

function summaryTable(): string[] {
  const rows = FILE_TYPES.map((fileType) => {
    const deterministic = DETERMINISTIC_CHECKS[fileType];
    const llm = LLM_CHECKS[fileType];
    return `| ${fileType} | ${deterministic.length} | ${categoryList(deterministic.map((c) => c.category))} | ${llm.length} | ${categoryList(llm.map((c) => c.category))} |`;
  });
  return [
    '| File type | Deterministic checks | Deterministic categories | LLM checks | LLM categories |',
    '|---|---:|---|---:|---|',
    ...rows,
  ];
}

function actionTable(): string[] {
  return [
    '| Action or surface | Deterministic checks | LLM checks | Behavior |',
    '|---|---|---|---|',
    '| `CreateFile` | Yes | No | A new file is a background draft, so the tool returns a rules-only rubric. |',
    '| `EditFile` (default) | Yes | When possible | Captures the mounted, settled live view and runs the combined rubric. A background, unsettled, or failed capture degrades to deterministic checks. |',
    '| `EditFile` with `review:false` | Yes | No | Skips screenshot capture and the visual judge for an intermediate edit. |',
    '| `ReviewFile` | Yes | When possible | Reviews without editing. A mounted, settled view gets screenshot + combined rubric; otherwise it returns the deterministic fallback. |',
    '| `Screenshot` (legacy alias) | Yes | When possible | Uses the same handler and behavior as `ReviewFile`. |',
    '| `CheckFileHealth` | Yes | Opt-in | Defaults to saved-content deterministic checks. `llmJudge:true` adds the LLM checklist and reuses an explicit or current app-state screenshot when available. |',
    '| File-health badge / refresh | Yes | No | Scores locally. The badge normally uses saved content; drafts and manual refreshes use current merged content. |',
    '| File-health “Run visual review” | Yes | Yes | Captures the current view and sends current merged content to the combined rubric API. |',
    '| `GET /api/files/[id]/rubric` | Yes | No | Server-side deterministic report for saved content. |',
    '| `POST /api/files/[id]/rubric` | Yes | Yes | Combined report; accepts current content, screenshot, and measured story-embed widths. |',
  ];
}

function deterministicTable(fileType: RubricFileType): string[] {
  return [
    '| Check id | Pass condition | Category | Failure severity |',
    '|---|---|---|---|',
    ...DETERMINISTIC_CHECKS[fileType].map((check) =>
      `| ${code(check.ruleId)} | ${cell(check.label)} | ${check.category} | ${severityList(check.severity)} |`),
  ];
}

function llmTable(fileType: RubricFileType): string[] {
  const checks = LLM_CHECKS[fileType];
  if (checks.length === 0) return ['_No LLM checks. This file type is deterministic-only._'];
  return [
    '| Check id | Label | Category | Failure severity | Pass condition | Fix on failure |',
    '|---|---|---|---|---|---|',
    ...checks.map((check) =>
      `| ${code(`llm.${check.id}`)} | ${cell(check.label)} | ${check.category} | ${check.severity} | ${cell(check.question)} | ${cell(check.fix)} |`),
  ];
}

function generate(): string {
  validateCatalogs();

  const lines: string[] = [
    '<!-- Generated by frontend/scripts/generate-rubric-readme.ts. Do not edit directly. -->',
    '',
    '# Agent file-health rubric',
    '',
    'This is the generated inventory of file-health checks and the actions that run them. The deterministic and LLM check tables—including category and failure severity—come from `checks.ts`.',
    '',
    'From `frontend/`, regenerate with `npm run generate-rubric-readme`. CI-style drift checking is available with `npm run generate-rubric-readme -- --check` and is included in `npm run validate`.',
    '',
    '## Coverage',
    '',
    ...summaryTable(),
    '',
    'A `context` is a non-visual knowledge file, so it has no LLM checks. For other file types, deterministic checks cover structural correctness and clarity; the LLM checklist adds visual and subjective assessment.',
    '',
    '## What runs the rubric',
    '',
    ...actionTable(),
    '',
    '`ReadFiles` and app-state projection do not attach a rubric. Rubric feedback is attached where the agent acts (`CreateFile`, `EditFile`, and `ReviewFile`) or when health is explicitly requested.',
    '',
    '## Scoring',
    '',
    '- Every assessed category starts at 5. Every warning deducts 1 point from its category.',
    '- Any error sets its category and the overall score to 0 until fixed.',
    '- Scores round to the nearest 0.5. Grades are `good` at 4 or above, `fair` at 2.5–3.5, and `poor` below 2.5.',
    '- Question, dashboard, and story weights are 30% correctness, 30% clarity, and 40% aesthetics. Context is 50% correctness and 50% clarity.',
    '- Unassessed categories are excluded rather than treated as passing. A deterministic-only visual-file score therefore does not claim an aesthetics score.',
    '',
    '## Checks by file type',
  ];

  for (const fileType of FILE_TYPES) {
    lines.push(
      '',
      `### ${fileType[0].toUpperCase()}${fileType.slice(1)}`,
      '',
      '#### Deterministic',
      '',
      ...deterministicTable(fileType),
      '',
      '#### LLM',
      '',
      ...llmTable(fileType),
    );
  }

  return `${lines.join('\n')}\n`;
}

const generated = generate();
if (process.argv.includes('--check')) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (current !== generated) {
    console.error('rubric README is out of date. Run: npm run generate-rubric-readme');
    process.exit(1);
  }
  console.log('rubric README is up to date.');
} else {
  writeFileSync(OUTPUT, generated);
  console.log(`generated ${OUTPUT}`);
}
