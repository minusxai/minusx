import { describe, it, expect } from 'vitest';
import { sanitizeOrgConfig } from '@/lib/validation/config-sanitizer';
import { validateOrgConfig } from '@/lib/validation/config-validators';

/**
 * A drifted-but-otherwise-fine stored config: it references the retired
 * `conversation` file type (×4) and the retired `llm.assignments` shape. Under
 * the old all-or-nothing validator the WHOLE document was discarded on read —
 * resetting `setupWizard` to pending and re-showing the setup wizard — and
 * could not be saved. This fixture is the regression guard.
 */
const DRIFTED_CONFIG = {
  accessRules: {
    admin: {
      createTypes: ['question', 'dashboard', 'folder', 'context', 'alert', 'connection', 'conversation', 'config', 'styles', 'alert_run', 'story'],
    },
    editor: {
      createTypes: ['question', 'dashboard', 'folder', 'context', 'alert', 'conversation', 'alert_run', 'story'],
    },
    viewer: {
      allowedTypes: ['dashboard', 'folder', 'question', 'context', 'connection', 'conversation'],
      viewTypes: ['dashboard', 'folder'],
    },
  },
  allowedVizTypes: ['table', 'line', 'bar', 'area', 'scatter', 'combo', 'pivot', 'combo', 'pie', 'waterfall', 'trend'],
  branding: {
    agentName: 'Agent',
    displayName: 'Acme',
    favicon: '/static/favicon.ico',
    logoDark: '/static/logo_dark.svg',
    logoExpanded: '/static/logo_full.svg',
    logoExpandedDark: '/static/logo_full_dark.svg',
    logoLight: '/static/logo.svg',
  },
  links: {
    docsUrl: 'https://example.com/',
    githubIssuesUrl: 'https://example.com/',
    supportUrl: 'https://example.com/',
  },
  llm: {
    assignments: {
      analyst: { chain: [{ model: 'some-model-a', options: { reasoning: 'low' }, providerName: 'openai' }] },
      micro: { chain: [{ model: 'some-model-b', options: { reasoning: 'low' }, providerName: 'openai' }] },
    },
    providers: [{ apiKey: '@SECRETS/config/org/llm.providers/openai/apiKey', name: 'openai', provider: 'openai' }],
  },
  messaging: {
    webhooks: [
      { body: { key: '{{VALUE}}' }, headers: { 'Content-Type': 'application/json' }, method: 'POST', type: 'phone_otp', url: 'https://example.test/otp' },
    ],
  },
  setupWizard: { status: 'complete' },
  supportedFileTypes: ['question', 'folder', 'dashboard', 'connection', 'context', 'config', 'styles', 'alert', 'context_run', 'alert_run', 'story', 'conversation', 'session', 'users', 'explore'],
  thinkingPhrases: ['Thinking', 'Processing your request'],
};

describe('sanitizeOrgConfig — the drift regression', () => {
  it('heals the exact bricked config into a valid one', () => {
    const { config } = sanitizeOrgConfig(DRIFTED_CONFIG, { dropInvalidSections: true });
    expect(validateOrgConfig(config)).toBe(true);
  });

  it('preserves setupWizard.status === "complete" (the wizard never comes back)', () => {
    const { config } = sanitizeOrgConfig(DRIFTED_CONFIG, { dropInvalidSections: true });
    expect(config.setupWizard).toEqual({ status: 'complete' });
  });

  it('strips the retired `conversation` file type from every accessRules field', () => {
    const { config } = sanitizeOrgConfig(DRIFTED_CONFIG, { dropInvalidSections: true });
    expect(config.accessRules?.admin?.createTypes).not.toContain('conversation');
    expect(config.accessRules?.editor?.createTypes).not.toContain('conversation');
    expect(config.accessRules?.viewer?.allowedTypes).not.toContain('conversation');
    // ...while keeping the valid ones
    expect(config.accessRules?.admin?.createTypes).toContain('question');
    expect(config.accessRules?.viewer?.viewTypes).toEqual(['dashboard', 'folder']);
  });

  it('strips `conversation` from supportedFileTypes but keeps the valid types', () => {
    const { config } = sanitizeOrgConfig(DRIFTED_CONFIG, { dropInvalidSections: true });
    expect(config.supportedFileTypes).not.toContain('conversation');
    expect(config.supportedFileTypes).toContain('question');
    expect(config.supportedFileTypes).toContain('explore');
  });

  it('drops the retired llm.assignments key but keeps the provider (so it resolves as Auto)', () => {
    const { config } = sanitizeOrgConfig(DRIFTED_CONFIG, { dropInvalidSections: true });
    expect((config.llm as Record<string, unknown> | undefined)?.assignments).toBeUndefined();
    expect(config.llm?.providers).toEqual([
      { apiKey: '@SECRETS/config/org/llm.providers/openai/apiKey', name: 'openai', provider: 'openai' },
    ]);
  });

  it('preserves the valid sections untouched (branding, links, messaging)', () => {
    const { config } = sanitizeOrgConfig(DRIFTED_CONFIG, { dropInvalidSections: true });
    expect(config.branding?.displayName).toBe('Acme');
    expect(config.branding?.agentName).toBe('Agent');
    expect(config.links?.docsUrl).toBe('https://example.com/');
    expect(config.messaging?.webhooks).toHaveLength(1);
  });

  it('reports what it healed via warnings', () => {
    const { warnings } = sanitizeOrgConfig(DRIFTED_CONFIG, { dropInvalidSections: true });
    expect(warnings.join('\n')).toMatch(/conversation/);
    expect(warnings.join('\n')).toMatch(/assignments/);
  });

  it('leaves no residual errors — the healed config is fully valid', () => {
    const { errors } = sanitizeOrgConfig(DRIFTED_CONFIG, {});
    expect(errors).toEqual([]);
  });
});

describe('sanitizeOrgConfig — write path (dropInvalidSections: false) rejects genuine mistakes', () => {
  it('does NOT silently drop a genuinely malformed section — it reports an error', () => {
    // A real admin typo: branding must be an object, not a string.
    const { errors } = sanitizeOrgConfig({ branding: 'hello' }, { dropInvalidSections: false });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reports a specific reason for an invalid llm grade reference (not a canned message)', () => {
    const { errors } = sanitizeOrgConfig({
      llm: { providers: [{ name: 'a', provider: 'openai' }], grades: { core: { providerName: 'nope' } } },
    }, { dropInvalidSections: false });
    expect(errors.join(' ')).toMatch(/references provider 'nope', which does not exist/);
  });

  it('heals inert drift even on the write path, so a drift-only config saves clean', () => {
    const { config, errors } = sanitizeOrgConfig({
      supportedFileTypes: ['question', 'conversation'],
    }, { dropInvalidSections: false });
    expect(errors).toEqual([]);
    expect(config.supportedFileTypes).toEqual(['question']);
  });
});

describe('sanitizeOrgConfig — read path (dropInvalidSections: true) never bricks', () => {
  it('drops a still-invalid section but keeps the rest of the document', () => {
    const { config } = sanitizeOrgConfig({
      branding: 'hello',                 // genuinely broken → dropped
      setupWizard: { status: 'complete' } // valid → survives
    }, { dropInvalidSections: true });
    expect(config.branding).toBeUndefined();
    expect(config.setupWizard).toEqual({ status: 'complete' });
    expect(validateOrgConfig(config)).toBe(true);
  });

  it('returns an empty config for non-object input rather than throwing', () => {
    expect(sanitizeOrgConfig(null, { dropInvalidSections: true }).config).toEqual({});
    expect(sanitizeOrgConfig('nope', { dropInvalidSections: true }).config).toEqual({});
  });
});
