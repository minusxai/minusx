// frontend/compatibility.json is the shared static contract consumed by the
// app (connection form field specs), setup.sh (interview prompts, curled from
// raw.github), and the docs (supported-databases / supported-models tables).
// This test keeps it honest against the code it must agree with:
// - connection types ↔ CONNECTION_TYPES (lib/ui/connection-type-options.ts)
// - LLM registry providers/models ↔ the baked pi-ai registry
// - field specs ↔ the config keys the connectors actually read
import { describe, it, expect } from 'vitest';
import compatibility from '@/compatibility.json';
import { CONNECTION_TYPES } from '@/lib/ui/connection-type-options';
import { LLM_GRADES, MINUSX_PROVIDER, CUSTOM_PROVIDER } from '@/lib/llm/llm-config-types';
import { listProviders, listModels } from '@/orchestrator/llm';

type CompatField = {
  key: string; label: string; kind: 'text' | 'password' | 'number' | 'json' | 'select';
  required?: boolean; secret?: boolean; default?: string | number; options?: string[]; note?: string;
};
type CompatConnectionType = { type: string; name: string; cli: boolean; fields: CompatField[] };
type CompatProvider = {
  id: string; name: string; kind: 'managed' | 'registry' | 'custom';
  credentials: CompatField[];
  defaults?: Record<string, string>;
};

const llmProviders = compatibility.llm.providers as CompatProvider[];
const connectionTypes = compatibility.connections.types as CompatConnectionType[];

describe('compatibility.json — LLM providers', () => {
  it('leads with the managed minusx provider and includes custom', () => {
    expect(llmProviders[0].id).toBe(MINUSX_PROVIDER);
    expect(llmProviders[0].kind).toBe('managed');
    expect(llmProviders.some(p => p.id === CUSTOM_PROVIDER && p.kind === 'custom')).toBe(true);
  });

  it('registry providers exist in the pi-ai registry', () => {
    const known = new Set(listProviders());
    for (const p of llmProviders.filter(p => p.kind === 'registry')) {
      expect(known.has(p.id), `provider ${p.id} not in pi-ai registry`).toBe(true);
    }
  });

  it('registry providers declare one default model per grade, resolvable in the baked registry', () => {
    for (const p of llmProviders.filter(p => p.kind === 'registry')) {
      const baked = new Set(listModels(p.id).map(m => m.id));
      expect(p.defaults, `${p.id} missing defaults map`).toBeTruthy();
      for (const grade of LLM_GRADES) {
        const def = p.defaults![grade];
        expect(def, `${p.id} missing ${grade} default`).toBeTruthy();
        expect(baked.has(def!), `${p.id}/${def} not in baked registry`).toBe(true);
      }
      // Retired keys — a reappearing key means a consumer (install.sh / docs)
      // is reading stale curation. `models` and `recommended` collapsed into
      // one default per grade; the analyst/micro use-case keys were replaced
      // by grades; 'max' was renamed 'advanced'.
      expect((p as { models?: unknown }).models, `${p.id} still carries the retired models key`).toBeUndefined();
      expect((p as { recommended?: unknown }).recommended, `${p.id} still carries the retired recommended key`).toBeUndefined();
      for (const retired of ['analyst', 'micro', 'max']) {
        expect(p.defaults?.[retired], `${p.id} still carries the retired '${retired}' default`).toBeUndefined();
      }
    }
  });

  it('every provider declares its credential fields; secrets marked', () => {
    for (const p of llmProviders) {
      expect(Array.isArray(p.credentials)).toBe(true);
      for (const c of p.credentials) {
        expect(c.key).toBeTruthy();
        expect(c.label).toBeTruthy();
        if (c.key === 'apiKey') expect(c.secret).toBe(true);
      }
    }
    // bedrock needs a region on top of the key
    const bedrock = llmProviders.find(p => p.id === 'amazon-bedrock')!;
    expect(bedrock.credentials.map(c => c.key)).toContain('awsRegion');
  });
});

describe('compatibility.json — connection types', () => {
  it('every entry is a real CONNECTION_TYPES type (no invented types)', () => {
    const known = new Set(CONNECTION_TYPES.map(c => c.type));
    for (const t of connectionTypes) {
      expect(known.has(t.type as never), `type ${t.type} not in CONNECTION_TYPES`).toBe(true);
    }
  });

  it('covers every available external-engine type with cli: true', () => {
    const externals = CONNECTION_TYPES.filter(c => c.group === 'external-engine' && !c.comingSoon).map(c => c.type);
    for (const type of externals) {
      const entry = connectionTypes.find(t => t.type === type);
      expect(entry, `external engine ${type} missing from compatibility.json`).toBeTruthy();
      expect(entry!.cli).toBe(true);
    }
  });

  it('field specs carry the exact config keys the connectors read', () => {
    const keysOf = (type: string) => connectionTypes.find(t => t.type === type)!.fields.map(f => f.key);
    expect(keysOf('postgresql')).toEqual(
      expect.arrayContaining(['host', 'port', 'database', 'username', 'password']));
    expect(keysOf('bigquery')).toEqual(
      expect.arrayContaining(['project_id', 'service_account_json']));
    expect(keysOf('athena')).toEqual(
      expect.arrayContaining(['region_name', 's3_staging_dir', 'aws_access_key_id', 'aws_secret_access_key']));
    expect(keysOf('clickhouse')).toEqual(
      expect.arrayContaining(['host', 'port', 'protocol', 'database', 'username', 'password']));
  });

  it('secret fields are flagged so the script prompts silently and never logs them', () => {
    for (const t of connectionTypes) {
      for (const f of t.fields) {
        const shouldBeSecret = /password|secret|service_account|api_key|access_key/i.test(f.key) && f.key !== 'aws_access_key_id';
        if (shouldBeSecret) expect(f.secret, `${t.type}.${f.key} must be secret`).toBe(true);
        if (f.kind === 'password') expect(f.secret).toBe(true);
      }
    }
  });
});
