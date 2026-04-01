/**
 * Generate a preview HTML file for the alert email template.
 * Run: npx tsx lib/messaging/preview-alert-email.ts
 * Output: /tmp/alert-email-preview.html
 */
import { writeFileSync } from 'fs';
import { buildAlertEmailHtml } from './alert-email-html';

const html = buildAlertEmailHtml({
  alertName: 'Revenue Drop — Weekly GMV',
  failedTests: [
    {
      test: { type: 'query', subject: { type: 'query', question_id: 1 }, answerType: 'number', operator: '<', value: { type: 'constant', value: 200000 }, label: 'Weekly GMV' },
      passed: false,
      actualValue: 142300,
      expectedValue: 200000,
    },
    {
      test: { type: 'query', subject: { type: 'query', question_id: 2 }, answerType: 'number', operator: '>', value: { type: 'constant', value: 0 }, label: 'Order Count' },
      passed: false,
      actualValue: 0,
      expectedValue: 0,
    },
  ],
  totalTests: 3,
  alertLink: 'https://app.example.com/f/42',
  agentName: 'MinusX',
});

writeFileSync('/tmp/alert-email-preview.html', html);
console.log('Written to /tmp/alert-email-preview.html');
