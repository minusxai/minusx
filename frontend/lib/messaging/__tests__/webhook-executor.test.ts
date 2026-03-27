import { executeWebhook, sendEmailViaWebhook, sendPhoneAlertViaWebhook, sendSlackViaWebhook } from '../webhook-executor';
import type { MessagingWebhook } from '@/lib/types';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const okResponse = () =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('ok') } as Response);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(okResponse);
});

// ─── executeWebhook ───────────────────────────────────────────────────────────

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

// ─── sendEmailViaWebhook ──────────────────────────────────────────────────────

describe('sendEmailViaWebhook', () => {
  const emailWebhook: MessagingWebhook = {
    type: 'email_alert',
    url: 'https://api.email.example.com/send',
    method: 'POST',
    body: { to: '{{EMAIL_TO}}', subject: '{{EMAIL_SUBJECT}}', body: '{{EMAIL_BODY}}' },
  };

  it('sends to the correct URL', async () => {
    await sendEmailViaWebhook(emailWebhook, 'user@example.com', 'Alert', 'body text');
    expect(mockFetch).toHaveBeenCalledWith('https://api.email.example.com/send', expect.any(Object));
  });

  it('substitutes EMAIL_TO, EMAIL_SUBJECT, EMAIL_BODY in body', async () => {
    await sendEmailViaWebhook(emailWebhook, 'user@example.com', 'Alert triggered', '<p>Details</p>');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      to: 'user@example.com',
      subject: 'Alert triggered',
      body: '<p>Details</p>',
    });
  });

  it('escapes special characters in body', async () => {
    await sendEmailViaWebhook(emailWebhook, 'user@example.com', 'Subject', 'Line1\nLine2 "quoted"');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).body).toBe('Line1\nLine2 "quoted"');
  });
});

// ─── sendPhoneAlertViaWebhook ─────────────────────────────────────────────────

describe('sendPhoneAlertViaWebhook', () => {
  const phoneWebhook: MessagingWebhook = {
    type: 'phone_alert',
    url: 'https://api.sms.example.com/send',
    method: 'POST',
    body: { to: '{{PHONE_ALERT_TO}}', message: '{{PHONE_ALERT_BODY}}', title: '{{PHONE_ALERT_TITLE}}' },
  };

  it('sends to the correct URL', async () => {
    await sendPhoneAlertViaWebhook(phoneWebhook, '+15550001234', 'Alert fired');
    expect(mockFetch).toHaveBeenCalledWith('https://api.sms.example.com/send', expect.any(Object));
  });

  it('substitutes PHONE_ALERT_TO and PHONE_ALERT_BODY', async () => {
    await sendPhoneAlertViaWebhook(phoneWebhook, '+15550001234', 'Alert fired');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toMatchObject({
      to: '+15550001234',
      message: 'Alert fired',
    });
  });

  it('substitutes optional extras (title, desc, link)', async () => {
    await sendPhoneAlertViaWebhook(phoneWebhook, '+15550001234', 'Alert fired', {
      title: 'My Alert',
      link: 'https://app.example.com/f/42',
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).title).toBe('My Alert');
  });

  it('falls back to body as summary when summary not provided', async () => {
    const webhook: MessagingWebhook = {
      type: 'phone_alert',
      url: 'https://api.sms.example.com/send',
      method: 'POST',
      body: { summary: '{{PHONE_ALERT_SUMMARY}}' },
    };
    await sendPhoneAlertViaWebhook(webhook, '+15550001234', 'the body text');
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).summary).toBe('the body text');
  });
});

// ─── sendSlackViaWebhook ──────────────────────────────────────────────────────

describe('sendSlackViaWebhook', () => {
  const slackWebhook: MessagingWebhook = {
    type: 'slack_alert',
    url: '{{SLACK_WEBHOOK}}',
    method: 'POST',
    body: '{{SLACK_PROPERTIES}}',
  };

  it('sends to the channel webhook URL', async () => {
    await sendSlackViaWebhook(slackWebhook, 'Alert fired!', {
      webhook_url: 'https://hooks.slack.com/services/T123/B456/token',
      properties: { text: '{{SLACK_MESSAGE}}' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/T123/B456/token',
      expect.any(Object)
    );
  });

  it('substitutes SLACK_MESSAGE in properties', async () => {
    await sendSlackViaWebhook(slackWebhook, 'Alert fired!', {
      webhook_url: 'https://hooks.slack.com/services/T123/B456/token',
      properties: { text: '{{SLACK_MESSAGE}}', username: 'AlertBot' },
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: 'Alert fired!', username: 'AlertBot' });
  });

  it('handles properties without SLACK_MESSAGE template', async () => {
    await sendSlackViaWebhook(slackWebhook, 'ignored', {
      webhook_url: 'https://hooks.slack.com/services/T123/B456/token',
      properties: { text: 'fixed message', icon_emoji: ':bell:' },
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: 'fixed message', icon_emoji: ':bell:' });
  });

  it('escapes special characters in SLACK_MESSAGE', async () => {
    await sendSlackViaWebhook(slackWebhook, 'Line1\nLine2 "quoted"', {
      webhook_url: 'https://hooks.slack.com',
      properties: { text: '{{SLACK_MESSAGE}}' },
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: 'Line1\nLine2 "quoted"' });
  });

  it('sends empty object as body when no properties given', async () => {
    await sendSlackViaWebhook(slackWebhook, 'hello', {
      webhook_url: 'https://hooks.slack.com',
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({});
  });
});
