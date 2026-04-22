import { hasDeliveryEnabled, buildDropdownOptions } from '../delivery-options';
import { executeWebhook, sendEmailViaWebhook, sendPhoneAlertViaWebhook, sendSlackViaWebhook } from '../webhook-executor';
import type { OrgConfig } from '@/lib/branding/whitelabel';
import type { AlertRecipient, MessagingWebhook, User } from '@/lib/types';

// ─── delivery-options fixtures ────────────────────────────────────────────────

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

// ─── webhook-executor fixtures ────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

const okResponse = () =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('ok') } as Response);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(okResponse);
});

// ─────────────────────────────────────────────────────────────────────────────
// delivery-options
// ─────────────────────────────────────────────────────────────────────────────

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
    expect(hasDeliveryEnabled(cfg, [])).toBe(true);
  });
});

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

// ─────────────────────────────────────────────────────────────────────────────
// webhook-executor
// ─────────────────────────────────────────────────────────────────────────────

describe('executeWebhook', () => {
  it('substitutes variables in the URL', async () => {
    const webhook: MessagingWebhook = { type: 'email_alert', url: 'https://api.example.com/{{TOKEN}}', method: 'POST' };
    await executeWebhook(webhook, { TOKEN: 'abc123' });
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/abc123', expect.any(Object));
  });

  it('substitutes variables in object body string values', async () => {
    const webhook: MessagingWebhook = {
      type: 'email_alert',
      url: 'https://api.example.com',
      method: 'POST',
      body: { to: '{{EMAIL_TO}}', subject: '{{EMAIL_SUBJECT}}' },
    };
    await executeWebhook(webhook, { EMAIL_TO: 'user@example.com', EMAIL_SUBJECT: 'Hello' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ to: 'user@example.com', subject: 'Hello' });
  });

  it('parses string body as JSON after substitution', async () => {
    const webhook: MessagingWebhook = {
      type: 'slack_alert',
      url: 'https://hooks.slack.com',
      method: 'POST',
      body: '{{SLACK_PROPERTIES}}',
    };
    const props = JSON.stringify({ text: 'hello', username: 'Bot' });
    await executeWebhook(webhook, { SLACK_PROPERTIES: props });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: 'hello', username: 'Bot' });
  });

  it('sends no body when body is not configured', async () => {
    const webhook: MessagingWebhook = { type: 'slack_alert', url: 'https://hooks.slack.com', method: 'POST' };
    await executeWebhook(webhook, {});
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.body).toBeUndefined();
  });

  it('returns success=false on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request', text: () => Promise.resolve('err') } as Response);
    const webhook: MessagingWebhook = { type: 'slack_alert', url: 'https://hooks.slack.com', method: 'POST' };
    const result = await executeWebhook(webhook, {});
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});

describe('sendEmailViaWebhook', () => {
  const emailWh: MessagingWebhook = {
    type: 'email_alert',
    url: 'https://api.email.example.com/send',
    method: 'POST',
    body: { to: '{{EMAIL_TO}}', subject: '{{EMAIL_SUBJECT}}', body: '{{EMAIL_BODY}}' },
  };

  it('sends to the correct URL', async () => {
    await sendEmailViaWebhook(emailWh, 'user@example.com', 'Alert', 'body text');
    expect(mockFetch).toHaveBeenCalledWith('https://api.email.example.com/send', expect.any(Object));
  });

  it('substitutes EMAIL_TO, EMAIL_SUBJECT, EMAIL_BODY in body', async () => {
    await sendEmailViaWebhook(emailWh, 'user@example.com', 'Alert triggered', '<p>Details</p>');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ to: 'user@example.com', subject: 'Alert triggered', body: '<p>Details</p>' });
  });

  it('escapes special characters in body', async () => {
    await sendEmailViaWebhook(emailWh, 'user@example.com', 'Subject', 'Line1\nLine2 "quoted"');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).body).toBe('Line1\nLine2 "quoted"');
  });
});

describe('sendPhoneAlertViaWebhook', () => {
  const phoneWh: MessagingWebhook = {
    type: 'phone_alert',
    url: 'https://api.sms.example.com/send',
    method: 'POST',
    body: { to: '{{PHONE_ALERT_TO}}', message: '{{PHONE_ALERT_BODY}}', title: '{{PHONE_ALERT_TITLE}}' },
  };

  it('sends to the correct URL', async () => {
    await sendPhoneAlertViaWebhook(phoneWh, '+15550001234', 'Alert fired');
    expect(mockFetch).toHaveBeenCalledWith('https://api.sms.example.com/send', expect.any(Object));
  });

  it('substitutes PHONE_ALERT_TO and PHONE_ALERT_BODY', async () => {
    await sendPhoneAlertViaWebhook(phoneWh, '+15550001234', 'Alert fired');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toMatchObject({ to: '+15550001234', message: 'Alert fired' });
  });

  it('substitutes optional extras (title, desc, link)', async () => {
    await sendPhoneAlertViaWebhook(phoneWh, '+15550001234', 'Alert fired', { title: 'My Alert', link: 'https://app.example.com/f/42' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).title).toBe('My Alert');
  });

  it('falls back to body as summary when summary not provided', async () => {
    const wh: MessagingWebhook = { type: 'phone_alert', url: 'https://api.sms.example.com/send', method: 'POST', body: { summary: '{{PHONE_ALERT_SUMMARY}}' } };
    await sendPhoneAlertViaWebhook(wh, '+15550001234', 'the body text');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).summary).toBe('the body text');
  });
});

describe('sendSlackViaWebhook', () => {
  const slackWh: MessagingWebhook = { type: 'slack_alert', url: '{{SLACK_WEBHOOK}}', method: 'POST', body: '{{SLACK_PROPERTIES}}' };

  it('sends to the channel webhook URL', async () => {
    await sendSlackViaWebhook(slackWh, 'Alert fired!', { webhook_url: 'https://hooks.slack.com/services/T123/B456/token', properties: { text: '{{SLACK_MESSAGE}}' } });
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.slack.com/services/T123/B456/token', expect.any(Object));
  });

  it('substitutes SLACK_MESSAGE in properties', async () => {
    await sendSlackViaWebhook(slackWh, 'Alert fired!', { webhook_url: 'https://hooks.slack.com/services/T123/B456/token', properties: { text: '{{SLACK_MESSAGE}}', username: 'AlertBot' } });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: 'Alert fired!', username: 'AlertBot' });
  });

  it('handles properties without SLACK_MESSAGE template', async () => {
    await sendSlackViaWebhook(slackWh, 'ignored', { webhook_url: 'https://hooks.slack.com/services/T123/B456/token', properties: { text: 'fixed message', icon_emoji: ':bell:' } });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: 'fixed message', icon_emoji: ':bell:' });
  });

  it('escapes special characters in SLACK_MESSAGE', async () => {
    await sendSlackViaWebhook(slackWh, 'Line1\nLine2 "quoted"', { webhook_url: 'https://hooks.slack.com', properties: { text: '{{SLACK_MESSAGE}}' } });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: 'Line1\nLine2 "quoted"' });
  });

  it('sends empty object as body when no properties given', async () => {
    await sendSlackViaWebhook(slackWh, 'hello', { webhook_url: 'https://hooks.slack.com' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({});
  });
});
