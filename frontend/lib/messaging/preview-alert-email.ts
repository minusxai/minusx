/**
 * Generate a preview HTML file for the alert email template.
 * Run: npx tsx lib/messaging/preview-alert-email.ts
 * Output: /tmp/alert-email-preview.html
 */
import { writeFileSync } from 'fs';
import { buildAlertEmailHtml } from './alert-email-html';

const html = buildAlertEmailHtml({
  alertName: 'Revenue Drop — Weekly GMV',
  actualValue: 142300,
  operator: '<',
  threshold: 200000,
  column: 'total_gmv',
  questionName: 'Weekly GMV by Region',
  alertLink: 'https://app.example.com/f/42',
  agentName: 'MinusX',
});

writeFileSync('/tmp/alert-email-preview.html', html);
console.log('Written to /tmp/alert-email-preview.html');
