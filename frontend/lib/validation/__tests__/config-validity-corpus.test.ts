import { describe, it, expect } from 'vitest';
import { validateOrgConfig } from '@/lib/validation/config-validators';
import { validateFileState } from '@/lib/validation/content-validators';
import { MIGRATIONS } from '@/lib/database/migrations';

/**
 * TRIPWIRE: a corpus of hardcoded, currently-valid org configs.
 *
 * Every entry MUST validate. The values are written out literally (not derived
 * from the type sources) on purpose: when a config type changes in a way that
 * invalidates a shape real deployments already have stored — e.g. retiring a
 * file type, a viz type, an llm shape, a setupWizard field — the corresponding
 * fixture stops validating and this test goes RED before deploy.
 *
 * That red is the signal to write a data migration for existing stored configs
 * AND to cover it here: add the pre-migration config, assert it is now invalid,
 * run the migration, and assert the result validates.
 *
 * Keep this corpus broad. If you add a new file type / viz type / config
 * section, add a fixture that exercises it.
 */
export const VALID_CONFIG_CORPUS: { name: string; config: Record<string, unknown> }[] = [
  {
    name: 'branding only (minimal)',
    config: { branding: { displayName: 'Acme', agentName: 'Agent', favicon: '/favicon.ico' } },
  },
  {
    name: 'full branding + links',
    config: {
      branding: {
        displayName: 'Acme', agentName: 'Agent', favicon: '/favicon.ico',
        logoLight: '/logo.svg', logoDark: '/logo_dark.svg',
        logoExpanded: '/logo_full.svg', logoExpandedDark: '/logo_full_dark.svg',
        tagline: 'Ask your data anything',
      },
      links: {
        docsUrl: 'https://example.com/docs', supportUrl: 'https://example.com/support',
        githubIssuesUrl: 'https://example.com/issues', termsUrl: 'https://example.com/terms',
      },
    },
  },
  {
    name: 'messaging webhooks — keyword + POST forms',
    config: {
      messaging: {
        webhooks: [
          { type: 'email_alert', keyword: 'EMAIL_DEFAULT' },
          { type: 'slack_alert', keyword: 'SLACK_DEFAULT' },
          {
            type: 'phone_otp', method: 'POST', url: 'https://example.com/otp',
            headers: { 'Content-Type': 'application/json' },
            body: { receiver: '{{USER_NUMBER}}', otp: '{{AUTH_OTP}}' },
          },
        ],
      },
    },
  },
  {
    name: 'accessRules — all roles, all fields, incl. wildcard',
    config: {
      accessRules: {
        admin: { createTypes: ['question', 'dashboard', 'folder', 'context', 'alert', 'connection', 'config', 'styles', 'alert_run', 'story'] },
        editor: { createTypes: ['question', 'dashboard', 'folder', 'context', 'alert', 'alert_run', 'story'], allowedTypes: '*' },
        viewer: {
          allowedTypes: ['dashboard', 'folder', 'question', 'context', 'connection'],
          viewTypes: ['dashboard', 'folder'],
        },
      },
    },
  },
  {
    name: 'allowedVizTypes — EVERY current viz type (retiring one breaks this)',
    config: {
      allowedVizTypes: [
        'table', 'bar', 'row', 'line', 'scatter', 'area', 'funnel',
        'pie', 'pivot', 'trend', 'waterfall', 'combo', 'radar', 'geo',
      ],
    },
  },
  {
    name: 'supportedFileTypes — EVERY current file type (retiring one breaks this)',
    config: {
      supportedFileTypes: [
        'question', 'dashboard', 'story', 'notebook', 'connection', 'context',
        'report', 'config', 'styles', 'alert', 'context_run', 'alert_run',
        'report_run', 'session', 'users', 'folder', 'explore',
      ],
    },
  },
  {
    name: 'setupWizard — complete',
    config: { setupWizard: { status: 'complete' } },
  },
  {
    name: 'setupWizard — pending, every optional field',
    config: {
      setupWizard: {
        status: 'pending', step: 'questionnaire',
        connectionId: 1234, connectionName: 'warehouse', contextFileId: 5678,
        questionnaireAnswers: { datasetDescription: 'sales', keyMetrics: 'revenue', dashboardPreference: 'exec' },
      },
    },
  },
  {
    name: 'llm — providers + grades (all three) + agent policies',
    config: {
      llm: {
        providers: [{ name: 'openai', provider: 'openai', apiKey: '@SECRETS/config/org/llm.providers/openai/apiKey' }],
        grades: {
          lite: { providerName: 'openai', model: 'some-small-model', options: { reasoning: 'low' } },
          core: { providerName: 'openai', model: 'some-mid-model' },
          advanced: { providerName: 'openai', model: 'some-large-model' },
        },
        agents: { analyst: { allowedGrades: ['core', 'advanced'], defaultGrade: 'core' } },
      },
    },
  },
  {
    name: 'llm — managed minusx provider only (no grade mapping)',
    config: { llm: { providers: [{ name: 'minusx', provider: 'minusx' }] } },
  },
  {
    name: 'misc top-level sections',
    config: {
      thinkingPhrases: ['Thinking', 'Analyzing data'],
      analytics: { enabled: true },
      chartColorPalette: ['#16a085', '#2980b9'],
      remoteAgentsEnabled: true,
      city: 'Singapore',
    },
  },
  {
    name: 'kitchen-sink white-label config (a realistic full config)',
    config: {
      branding: { displayName: 'Acme', agentName: 'Agent', favicon: '/static/favicon.ico', logoLight: '/static/logo.svg', logoDark: '/static/logo_dark.svg' },
      links: { docsUrl: 'https://example.com/', supportUrl: 'https://example.com/', githubIssuesUrl: 'https://example.com/' },
      accessRules: {
        admin: { createTypes: ['question', 'dashboard', 'folder', 'context', 'alert', 'connection', 'config', 'styles', 'alert_run', 'story'] },
        editor: { createTypes: ['question', 'dashboard', 'folder', 'context', 'alert', 'alert_run', 'story'] },
        viewer: { allowedTypes: ['dashboard', 'folder', 'question', 'context', 'connection'], viewTypes: ['dashboard', 'folder'] },
      },
      allowedVizTypes: ['table', 'line', 'bar', 'area', 'scatter', 'combo', 'pivot', 'pie', 'waterfall', 'trend'],
      supportedFileTypes: ['question', 'folder', 'dashboard', 'connection', 'context', 'config', 'styles', 'alert', 'context_run', 'alert_run', 'story', 'session', 'users', 'explore'],
      messaging: { webhooks: [{ type: 'phone_alert', method: 'POST', url: 'https://example.com/alert', headers: { Authorization: 'Basic X' }, body: { to: '{{PHONE_ALERT_TO}}' } }] },
      llm: {
        providers: [{ name: 'openai', provider: 'openai', apiKey: '@SECRETS/config/org/llm.providers/openai/apiKey' }],
        grades: { core: { providerName: 'openai', model: 'some-mid-model', options: { reasoning: 'low' } } },
      },
      setupWizard: { status: 'complete' },
      thinkingPhrases: ['Thinking', 'Processing your request'],
    },
  },
];

describe('valid config corpus — every fixture must validate', () => {
  it.each(VALID_CONFIG_CORPUS)('validateOrgConfig accepts: $name', ({ config }) => {
    expect(validateOrgConfig(config)).toBe(true);
  });

  // The config-file save path (FilesAPI.saveFile → validateFileState) is what a
  // real admin hits; it must accept the same corpus.
  it.each(VALID_CONFIG_CORPUS)('config-file save accepts: $name', ({ config }) => {
    expect(validateFileState({ type: 'config', content: config })).toBeNull();
  });
});

/**
 * The worked example of the whole loop: a config that drifted (retired
 * `conversation` file type + retired `llm.assignments`) is INVALID, and the
 * V38 config migration heals it back to valid. This is what the migration
 * story looks like end-to-end — copy this shape when a future type change
 * turns the corpus above red.
 */
const DRIFTED_CONFIG = {
  branding: { displayName: 'Acme', agentName: 'Agent', favicon: '/f.ico' },
  supportedFileTypes: ['question', 'conversation', 'folder'],
  accessRules: { admin: { createTypes: ['question', 'conversation'] } },
  llm: { providers: [{ name: 'openai', provider: 'openai' }], assignments: { analyst: {} } },
  setupWizard: { status: 'complete' },
};

describe('config drift → migration → valid', () => {
  const v38 = MIGRATIONS.find(m => m.dataVersion === 38);

  it('the drifted config is INVALID before migration (the tripwire is red)', () => {
    expect(validateOrgConfig(DRIFTED_CONFIG)).toBe(false);
  });

  it('the V38 config migration heals it back to valid', () => {
    const migrated = v38!.rowMigration!.migrateContent({ id: 1, type: 'config', content: DRIFTED_CONFIG });
    expect(migrated).not.toBeNull();
    expect(validateOrgConfig(migrated)).toBe(true);
    const m = migrated as Record<string, any>;
    expect(m.supportedFileTypes).not.toContain('conversation');
    expect(m.accessRules.admin.createTypes).not.toContain('conversation');
    expect(m.llm.assignments).toBeUndefined();
    expect(m.llm.providers).toHaveLength(1); // provider kept
  });

  it('returns null (no rewrite) for a config with no drift', () => {
    expect(v38!.rowMigration!.migrateContent({
      id: 1, type: 'config', content: { supportedFileTypes: ['question', 'folder'] },
    })).toBeNull();
  });
});
