import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { resolveBaseUrl } from '@/lib/jobs/job-utils';
import { buildAlertEmailHtml } from '@/lib/messaging/alert-email-html';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { UserDB } from '@/lib/database/user-db';
import { createServerRunner } from '@/lib/tests/server';
import type { AlertContent, AlertOutput, DeliveredRecipient, JobHandlerResult, JobRunnerInput, TestRunResult } from '@/lib/types';
import type { JobHandler } from '../job-registry';


export const alertJobHandler: JobHandler = {
  async execute({ runFileId, jobId, file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const alert = file as AlertContent;
    const alertId = parseInt(jobId, 10);

    const alertResult = await FilesAPI.loadFile(alertId, user);
    const alertName = alertResult.data?.name ?? `Alert ${alertId}`;

    const tests = alert.tests ?? [];
    if (tests.length === 0) {
      const output: AlertOutput = {
        alertId,
        alertName,
        status: 'not_triggered',
        testResults: [],
        triggeredBy: [],
      };
      return { output, messages: [] };
    }

    // Run all tests
    const runner = createServerRunner(user, '');
    const testResults: TestRunResult[] = await Promise.all(tests.map(t => runner.execute(t)));

    // Determine trigger condition
    const notifyOn = alert.notifyOn ?? 'any_fail';
    const failedTests = testResults.filter(r => !r.passed);
    const triggered = notifyOn === 'all_fail'
      ? failedTests.length === testResults.length && testResults.length > 0
      : failedTests.length > 0;

    const output: AlertOutput = {
      alertId,
      alertName,
      status: triggered ? 'triggered' : 'not_triggered',
      testResults,
      triggeredBy: triggered ? failedTests : [],
    };

    const messages: JobHandlerResult['messages'] = [];

    if (triggered && alert.recipients && alert.recipients.length > 0) {
      const subject = `[Alert Triggered] ${alertName}`;
      const baseUrl = await resolveBaseUrl();
      const alertLink = `${baseUrl}/f/${runFileId}`;

      const { config } = await getConfigsForMode(user.mode);
      const agentName = config.branding.agentName;

      // Load users for dynamic address resolution
      const dbUsers = await UserDB.listAll();
      const userById = Object.fromEntries(dbUsers.map(u => [u.id, u]));

      const failSummary = failedTests.map((r, i) => {
        const label = `Test ${i + 1}`;
        return r.error ? `${label}: ${r.error}` : `${label}: got ${r.actualValue}, expected ${r.test.operator} ${r.expectedValue}`;
      }).join('; ');

      const plainText = `Alert "${alertName}" triggered. ${failedTests.length}/${testResults.length} test(s) failed. ${failSummary}`;

      const emailHtml = buildAlertEmailHtml({
        alertName,
        failedTests,
        totalTests: testResults.length,
        alertLink,
        agentName,
      });

      const deliveredTo: DeliveredRecipient[] = [];

      for (const recipient of alert.recipients) {
        if ('userId' in recipient) {
          const u = userById[recipient.userId];
          if (!u) continue; // user deleted — skip silently
          const address = recipient.channel === 'email' ? u.email : u.phone;
          if (!address) continue;
          deliveredTo.push({ name: u.name, channel: recipient.channel, address });
          if (recipient.channel === 'email') {
            messages.push({ type: 'email_alert', content: emailHtml, metadata: { to: address, subject } });
          } else {
            messages.push({
              type: 'phone_alert',
              content: plainText,
              metadata: {
                to: address,
                title: alertName,
                desc: alert.description ?? plainText,
                link: alertLink,
                summary: plainText,
              },
            });
          }
        } else {
          // channelName-based — look up from config.channels
          const ch = config.channels?.find(c => c.name === recipient.channelName);
          if (!ch) continue;
          if (recipient.channel === 'slack' && ch.type === 'slack') {
            deliveredTo.push({ name: ch.name, channel: 'slack', address: ch.name });
            messages.push({
              type: 'slack_alert',
              content: `*${alertName}*\n${plainText}\n<${alertLink}|View>`,
              metadata: {
                channel: ch.name,
                webhook_url: ch.webhook_url,
                properties: ch.properties,
              },
            });
          } else if (recipient.channel === 'email' && ch.type === 'email') {
            deliveredTo.push({ name: ch.name, channel: 'email', address: ch.address });
            messages.push({ type: 'email_alert', content: emailHtml, metadata: { to: ch.address, subject } });
          } else if (recipient.channel === 'phone' && ch.type === 'phone') {
            deliveredTo.push({ name: ch.name, channel: 'phone', address: ch.address });
            messages.push({
              type: 'phone_alert',
              content: plainText,
              metadata: {
                to: ch.address,
                title: alertName,
                desc: alert.description ?? plainText,
                link: alertLink,
                summary: plainText,
              },
            });
          }
        }
      }

      output.deliveredTo = deliveredTo;
    }

    return { output, messages };
  },
};
