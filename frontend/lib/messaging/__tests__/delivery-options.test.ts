import { hasDeliveryEnabled, buildDropdownOptions } from '../delivery-options';
import type { OrgConfig } from '@/lib/branding/whitelabel';
import type { AlertRecipient, User } from '@/lib/types';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const slackWebhook = { type: 'slack_alert' as const, url: '{{SLACK_WEBHOOK}}', method: 'POST' as const, body: '{{SLACK_PROPERTIES}}' };
const emailWebhook = { type: 'email_alert' as const, url: 'https://api.example.com/email', method: 'POST' as const };
const phoneWebhook = { type: 'phone_alert' as const, url: 'https://api.example.com/sms',   method: 'POST' as const };

const slackChannel  = { type: 'slack' as const,  name: 'Engineering', webhook_url: 'https://hooks.slack.com/xxx' };
const emailChannel  = { type: 'email' as const,  name: 'Team Email',   address: 'team@example.com' };
const phoneChannel  = { type: 'phone' as const,  name: 'On-Call',      address: '+15550001234' };

const alice: User = { id: 1, name: 'Alice', email: 'alice@example.com', role: 'admin' };
const bob: User   = { id: 2, name: 'Bob',   email: 'bob@example.com',   role: 'viewer', phone: '+15550009999' };

function config(overrides: Partial<OrgConfig> = {}): OrgConfig {
  return {
    branding: { displayName: 'Test', agentName: 'Agent', favicon: '/favicon.ico' },
    links: { docsUrl: '', supportUrl: '', githubIssuesUrl: '' },
    ...overrides,
  };
}

// ─── hasDeliveryEnabled ───────────────────────────────────────────────────────

describe('hasDeliveryEnabled', () => {
  it('returns false when no webhooks configured', () => {
    const cfg = config({ channels: [slackChannel] });
    expect(hasDeliveryEnabled(cfg, [alice])).toBe(false);
  });

  it('slack webhook + slack channel → true', () => {
    const cfg = config({ messaging: { webhooks: [slackWebhook] }, channels: [slackChannel] });
    expect(hasDeliveryEnabled(cfg, [])).toBe(true);
  });

  it('slack webhook + no channels → false  (the bug: channel required)', () => {
    const cfg = config({ messaging: { webhooks: [slackWebhook] } });
    expect(hasDeliveryEnabled(cfg, [])).toBe(false);
  });

  it('no slack webhook + slack channel → false  (webhook required)', () => {
    const cfg = config({ channels: [slackChannel] });
    expect(hasDeliveryEnabled(cfg, [])).toBe(false);
  });

  it('email webhook + users → true', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] } });
    expect(hasDeliveryEnabled(cfg, [alice])).toBe(true);
  });

  it('email webhook + no users + no email channels → false', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] } });
    expect(hasDeliveryEnabled(cfg, [])).toBe(false);
  });

  it('email webhook + email channel (no users) → true', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] }, channels: [emailChannel] });
    expect(hasDeliveryEnabled(cfg, [])).toBe(true);
  });

  it('phone webhook + user with phone → true', () => {
    const cfg = config({ messaging: { webhooks: [phoneWebhook] } });
    expect(hasDeliveryEnabled(cfg, [bob])).toBe(true);
  });

  it('phone webhook + user without phone + no phone channels → false', () => {
    const cfg = config({ messaging: { webhooks: [phoneWebhook] } });
    expect(hasDeliveryEnabled(cfg, [alice])).toBe(false);
  });

  it('phone webhook + phone channel → true', () => {
    const cfg = config({ messaging: { webhooks: [phoneWebhook] }, channels: [phoneChannel] });
    expect(hasDeliveryEnabled(cfg, [])).toBe(true);
  });

  it('multiple webhooks: enabled if any combination matches', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook, slackWebhook] }, channels: [slackChannel] });
    expect(hasDeliveryEnabled(cfg, [])).toBe(true);  // slack matches
  });
});

// ─── buildDropdownOptions ─────────────────────────────────────────────────────

describe('buildDropdownOptions', () => {
  const noRecipients: AlertRecipient[] = [];

  it('slack channel appears when slack webhook configured', () => {
    const cfg = config({ messaging: { webhooks: [slackWebhook] }, channels: [slackChannel] });
    const opts = buildDropdownOptions(cfg, [], noRecipients, '');
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ kind: 'slack', via: 'channel', channel: slackChannel });
  });

  it('slack channel absent when no slack webhook', () => {
    const cfg = config({ channels: [slackChannel] });
    expect(buildDropdownOptions(cfg, [], noRecipients, '')).toHaveLength(0);
  });

  it('user email appears when email webhook configured', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] } });
    const opts = buildDropdownOptions(cfg, [alice], noRecipients, '');
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ kind: 'email', via: 'user', user: alice });
  });

  it('user phone appears when phone webhook configured', () => {
    const cfg = config({ messaging: { webhooks: [phoneWebhook] } });
    const opts = buildDropdownOptions(cfg, [bob], noRecipients, '');
    const phone = opts.find(o => o.kind === 'phone');
    expect(phone).toBeDefined();
    expect(phone).toMatchObject({ kind: 'phone', via: 'user', user: bob });
  });

  it('user without phone skipped for phone', () => {
    const cfg = config({ messaging: { webhooks: [phoneWebhook] } });
    const opts = buildDropdownOptions(cfg, [alice], noRecipients, '');
    expect(opts).toHaveLength(0);
  });

  it('email channel appears when email webhook configured', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] }, channels: [emailChannel] });
    const opts = buildDropdownOptions(cfg, [], noRecipients, '');
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ kind: 'email', via: 'channel', channel: emailChannel });
  });

  it('already-selected slack channel excluded from options', () => {
    const cfg = config({ messaging: { webhooks: [slackWebhook] }, channels: [slackChannel] });
    const selected: AlertRecipient[] = [{ channelName: 'Engineering', channel: 'slack' }];
    expect(buildDropdownOptions(cfg, [], selected, '')).toHaveLength(0);
  });

  it('already-selected user email excluded', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] } });
    const selected: AlertRecipient[] = [{ userId: 1, channel: 'email' }];
    expect(buildDropdownOptions(cfg, [alice], selected, '')).toHaveLength(0);
  });

  it('query filters users by name', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] } });
    expect(buildDropdownOptions(cfg, [alice, bob], noRecipients, 'ali')).toHaveLength(1);
    expect(buildDropdownOptions(cfg, [alice, bob], noRecipients, 'ali')[0]).toMatchObject({ user: alice });
  });

  it('query filters users by email', () => {
    const cfg = config({ messaging: { webhooks: [emailWebhook] } });
    expect(buildDropdownOptions(cfg, [alice, bob], noRecipients, 'bob@')).toHaveLength(1);
  });

  it('empty query returns all options', () => {
    const cfg = config({
      messaging: { webhooks: [emailWebhook, slackWebhook] },
      channels: [slackChannel, emailChannel],
    });
    const opts = buildDropdownOptions(cfg, [alice], noRecipients, '');
    const kinds = opts.map(o => o.kind);
    expect(kinds).toContain('email');
    expect(kinds).toContain('slack');
  });
});
