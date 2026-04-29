/**
 * HTML email template for alert notifications
 * Uses table-based layout for maximum email client compatibility
 */

import type { TestRunResult } from '@/lib/types';

interface AlertEmailParams {
  alertName: string;
  failedTests: TestRunResult[];
  totalTests: number;
  alertLink: string;
  agentName: string;
}

const OPERATOR_SYMBOLS: Record<string, string> = {
  '>': '&gt;',
  '<': '&lt;',
  '=': '=',
  '>=': '&ge;',
  '<=': '&le;',
  '!=': '&ne;',
  '~': '~',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function formatValue(v: string | number | boolean | null | undefined): string {
  if (v == null) return 'N/A';
  if (typeof v === 'number') {
    // Trim long decimals
    return Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/\.?0+$/, '');
  }
  return escapeHtml(String(v));
}

function buildTestRow(result: TestRunResult, index: number): string {
  const label = `Test ${index + 1}`;
  const operator = result.test.operator ?? '=';
  const opSymbol = OPERATOR_SYMBOLS[operator] ?? escapeHtml(operator);
  const actual = formatValue(result.actualValue);
  const expected = formatValue(result.expectedValue);

  if (result.error) {
    return `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:14px;color:#18181b">${escapeHtml(label)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:14px;color:#71717a" colspan="2">${escapeHtml(result.error)}</td>
      </tr>`;
  }

  return `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:14px;color:#18181b">${escapeHtml(label)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:14px;color:#18181b;font-weight:600">${actual}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:14px;color:#71717a">${opSymbol} ${expected}</td>
    </tr>`;
}

export function buildAlertEmailHtml(params: AlertEmailParams): string {
  const { alertName, failedTests, totalTests, alertLink, agentName } = params;
  const safeName = escapeHtml(alertName);
  const safeAgent = escapeHtml(agentName);
  const summary = failedTests.length === totalTests
    ? `All ${totalTests} test${totalTests !== 1 ? 's' : ''} failed`
    : `${failedTests.length} of ${totalTests} test${totalTests !== 1 ? 's' : ''} failed`;

  const testRows = failedTests.map((r, i) => buildTestRow(r, i)).join('');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>* { box-sizing: border-box; }</style>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,'Helvetica Neue',sans-serif">
    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f5">
      <tbody>
        <tr>
          <td align="center" style="padding:40px 20px">
            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px">
              <tbody>
                <tr>
                  <td>
                    <!-- Icon -->
                    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding-bottom:24px">
                      <tbody>
                        <tr>
                          <td align="center">
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <!-- Card -->
                    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7">
                      <tbody>
                        <tr>
                          <td>
                            <!-- Header -->
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#fef2f2">
                              <tbody>
                                <tr>
                                  <td style="padding:28px 32px 24px">
                                    <p style="font-size:13px;line-height:20px;margin:0 0 8px;color:#ef4444;text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Alert Triggered</p>
                                    <h1 style="font-size:22px;line-height:28px;margin:0 0 8px;color:#18181b;font-weight:700">${safeName}</h1>
                                    <p style="font-size:14px;line-height:20px;margin:0;color:#71717a">${escapeHtml(summary)}</p>
                                  </td>
                                </tr>
                              </tbody>
                            </table>

                            <!-- Test results table -->
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 32px 8px">
                              <tbody>
                                <tr>
                                  <td>
                                    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:6px;overflow:hidden">
                                      <thead>
                                        <tr style="background-color:#fafafa">
                                          <th style="padding:8px 16px;text-align:left;font-size:12px;font-weight:600;color:#71717a;border-bottom:1px solid #e4e4e7">Test</th>
                                          <th style="padding:8px 16px;text-align:left;font-size:12px;font-weight:600;color:#71717a;border-bottom:1px solid #e4e4e7">Got</th>
                                          <th style="padding:8px 16px;text-align:left;font-size:12px;font-weight:600;color:#71717a;border-bottom:1px solid #e4e4e7">Expected</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        ${testRows}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              </tbody>
                            </table>

                            <!-- CTA button -->
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 32px 28px">
                              <tbody>
                                <tr>
                                  <td>
                                    <a href="${escapeHtml(alertLink)}" target="_blank" style="display:inline-block;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:600;line-height:100%;padding:12px 24px;border-radius:6px;text-decoration:none;text-align:center">View Alert Run</a>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <!-- Footer -->
                    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding-top:24px">
                      <tbody>
                        <tr>
                          <td align="center">
                            <p style="font-size:12px;line-height:20px;margin:0;color:#a1a1aa">${safeAgent} &middot; Automated alert notification</p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
}
