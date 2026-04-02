/**
 * HTML email template for OTP login codes
 * Uses table-based layout for maximum email client compatibility
 * Follows the same design language as alert-email-html.ts
 */

interface OTPEmailParams {
  otp: string;
  agentName: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const LOGO_IMG = `<img src="https://minusx.app/logo_full.png" width="180" height="40" alt="MinusX" style="display:block" />`;

export function buildOTPEmailHtml(params: OTPEmailParams): string {
  const { otp, agentName } = params;
  const safeAgent = escapeHtml(agentName);

  // Build individual digit cells for a clean grid look
  const digitCells = otp.split('').map(d =>
    `<td align="center" style="padding:0 6px">
      <div style="width:48px;height:56px;line-height:56px;background-color:#f4f4f5;border-radius:8px;font-size:28px;font-weight:700;color:#18181b;font-family:'Courier New',Courier,monospace">${escapeHtml(d)}</div>
    </td>`
  ).join('');

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
                    <!-- Card -->
                    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7">
                      <tbody>
                        <tr>
                          <td>
                            <!-- Dark header with logo -->
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#18181b;border-radius:8px 8px 0 0">
                              <tbody>
                                <tr>
                                  <td align="center" style="padding:32px 32px 28px">
                                    ${LOGO_IMG}
                                  </td>
                                </tr>
                              </tbody>
                            </table>

                            <!-- Body -->
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation">
                              <tbody>
                                <tr>
                                  <td style="padding:32px 32px 0">
                                    <h1 style="font-size:22px;line-height:28px;margin:0 0 12px;color:#18181b;font-weight:700">Your ${safeAgent} Login Code</h1>
                                    <p style="font-size:14px;line-height:22px;margin:0;color:#52525b">Enter the verification code below to sign in. This code is valid for 10 minutes.</p>
                                  </td>
                                </tr>
                              </tbody>
                            </table>

                            <!-- OTP Code digits -->
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:28px 32px">
                              <tbody>
                                <tr>
                                  <td align="center">
                                    <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                                      <tbody>
                                        <tr>
                                          ${digitCells}
                                        </tr>
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              </tbody>
                            </table>

                            <!-- Footer note -->
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:0 32px 32px">
                              <tbody>
                                <tr>
                                  <td>
                                    <p style="font-size:13px;line-height:20px;margin:0;color:#a1a1aa">If you didn't request this code, you can safely ignore this email.</p>
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
                            <p style="font-size:12px;line-height:20px;margin:0;color:#a1a1aa">Best,<br/>${safeAgent} Team</p>
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
