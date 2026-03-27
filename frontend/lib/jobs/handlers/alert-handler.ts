import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { AUTH_URL } from '@/lib/config';
import { CompanyDB } from '@/lib/database/company-db';
import { isSubdomainRoutingEnabled } from '@/lib/utils/subdomain';
import { buildAlertEmailHtml } from '@/lib/messaging/alert-email-html';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
import { createServerRunner } from '@/lib/tests/server';
import type { AlertContent, AlertOutput, JobHandlerResult, JobRunnerInput, TestRunResult } from '@/lib/types';
import type { JobHandler } from '../job-registry';

async function resolveBaseUrl(companyId: number): Promise<string> {
  if (!isSubdomainRoutingEnabled()) return AUTH_URL;
  const company = await CompanyDB.getById(companyId);
  if (!company?.subdomain) return AUTH_URL;
  const url = new URL(AUTH_URL);
  return `${url.protocol}//${company.subdomain}.${url.host}`;
}

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
      const baseUrl = await resolveBaseUrl(user.companyId);
      const alertLink = `${baseUrl}/f/${runFileId}`;

      const { config } = await getConfigsByCompanyId(user.companyId, user.mode);
      const agentName = config.branding.agentName;

      // Build summary from failed tests
      const failSummary = failedTests.map(r => {
        const label = r.test.label ?? (r.test.type === 'llm' && r.test.subject.type === 'llm' ? r.test.subject.prompt : 'Test');
        return r.error ? `${label}: ${r.error}` : `${label}: ${r.actualValue} (expected ${r.expectedValue})`;
      }).join('; ');

      const plainText = `Alert "${alertName}" triggered. ${failedTests.length}/${testResults.length} test(s) failed. ${failSummary}`;

      // Build email HTML — pass a summary value for display
      const emailHtml = buildAlertEmailHtml({
        alertName,
        actualValue: failedTests.length,
        operator: '>',
        threshold: 0,
        column: undefined,
        questionName: `${failedTests.length}/${testResults.length} tests failed`,
        alertLink,
        agentName,
      });

      for (const recipient of alert.recipients) {
        if (recipient.channel === 'email_alert') {
          messages.push({ type: 'email_alert', content: emailHtml, metadata: { to: recipient.address, subject } });
        } else if (recipient.channel === 'phone_alert') {
          messages.push({
            type: 'phone_alert',
            content: plainText,
            metadata: {
              to: recipient.address,
              title: alertName,
              desc: alert.description ?? plainText,
              link: alertLink,
              summary: plainText,
            },
          });
        } else if (recipient.channel === 'slack_alert') {
          const channelConfig = config.channels?.find(c => c.name === recipient.address);
          messages.push({
            type: 'slack_alert',
            content: `*${alertName}*\n${plainText}\n<${alertLink}|View>`,
            metadata: {
              channel: recipient.address,
              webhook_url: channelConfig?.webhook_url ?? '',
              properties: channelConfig?.properties,
            },
          });
        }
      }
    }

    return { output, messages };
  },
};
