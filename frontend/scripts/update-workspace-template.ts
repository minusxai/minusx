#!/usr/bin/env tsx
/**
 * Update workspace-template.json to LATEST_DATA_VERSION.
 *
 * Runs migrations on dummy placeholder data, restores {{TEMPLATE_VAR}} markers,
 * and writes the result directly to workspace-template.json.
 * Use `git diff` to review the changes before committing.
 *
 * Safe to run anytime — does not touch the database.
 *
 * Usage:
 *   npm run update-workspace-template
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { applyMigrations } from '../lib/database/migrations';
import type { InitData } from '../lib/database/import-export';
import { LATEST_DATA_VERSION } from '../lib/database/constants';

// Dummy values substituted before running migrations.
// Chosen to be unique strings that migrations won't accidentally modify.
const DUMMY: Record<string, string> = {
  '{{ORG_NAME}}':            'TMPL__ORG_NAME__TMPL',
  '{{ADMIN_EMAIL}}':         'admin@tmplexample.com',
  '{{ADMIN_NAME}}':          'TMPL__ADMIN_NAME__TMPL',
  '{{ADMIN_PASSWORD_HASH}}': 'TMPL__PASSWORD_HASH__TMPL',
  '{{TIMESTAMP}}':           '2020-01-01T00:00:00.000Z',
};

const TEMPLATE_PATH = join(__dirname, '../lib/database/workspace-template.json');
const PREVIEW_PATH  = join(__dirname, '../lib/database/workspace-template.preview.json');

function substitute(raw: string): string {
  let s = raw;
  for (const [placeholder, dummy] of Object.entries(DUMMY)) s = s.replaceAll(placeholder, dummy);
  return s;
}

function restore(json: string): string {
  let s = json;
  for (const [placeholder, dummy] of Object.entries(DUMMY)) s = s.replaceAll(dummy, placeholder);
  // Normalize any ISO timestamps added by migrations
  s = s.replace(/"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)"/g, '"{{TIMESTAMP}}"');
  return s;
}

function resolveFlatData(data: any): { users: any[]; documents: any[] } {
  const nested = data.orgs ?? data.companies;
  if (Array.isArray(nested)) {
    const users: any[] = [];
    const documents: any[] = [];
    for (const org of nested) {
      if (Array.isArray(org.users)) users.push(...org.users);
      if (Array.isArray(org.documents)) documents.push(...org.documents);
    }
    return { users, documents };
  }
  return { users: data.users ?? [], documents: data.documents ?? [] };
}

const raw = readFileSync(TEMPLATE_PATH, 'utf-8');
const data: InitData = JSON.parse(substitute(raw));

console.log(`Template version : ${data.version}`);
console.log(`Latest version   : ${LATEST_DATA_VERSION}`);

if (data.version >= LATEST_DATA_VERSION) {
  console.log('✅ Template is already at latest version — nothing to do.');
  if (existsSync(PREVIEW_PATH)) unlinkSync(PREVIEW_PATH);
  process.exit(0);
}

console.log(`Applying migrations v${data.version} → v${LATEST_DATA_VERSION}...`);
const migrated = applyMigrations(data, data.version);

const { users, documents } = resolveFlatData(migrated);

// fullSchema and fullDocs are runtime-computed from connections — never store them in the template
for (const doc of documents) {
  if (doc.type === 'context' && doc.content) {
    doc.content.fullSchema = [];
    doc.content.fullDocs   = [];
  }
}

const flat: InitData = { version: LATEST_DATA_VERSION, users, documents };
const output = restore(JSON.stringify(flat, null, 2));

// Sanity check: all {{TEMPLATE_VARS}} present
const missingVars = Object.keys(DUMMY).filter(v => !output.includes(v));
if (missingVars.length > 0) {
  console.error('❌ Template vars missing from output — migrations may have dropped them:');
  missingVars.forEach(v => console.error(`   ${v}`));
  process.exit(1);
}

writeFileSync(TEMPLATE_PATH, output + '\n', 'utf-8');
if (existsSync(PREVIEW_PATH)) unlinkSync(PREVIEW_PATH);

console.log(`✅ Template updated to v${LATEST_DATA_VERSION}`);
console.log(`   Users    : ${users.length}`);
console.log(`   Documents: ${documents.length}`);
console.log(`   Run \`git diff lib/database/workspace-template.json\` to review.`);
