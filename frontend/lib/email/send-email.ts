import { Resend } from 'resend';

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

const CHUNK_SIZE = 100;

/**
 * Send an email via Resend.
 * @param to - Recipient addresses
 * @param subject - Email subject
 * @param text - Plain text body
 * @param html - Optional HTML body
 * @param batch - When true: individual email per recipient via Batch API (chunked at 100).
 *                When false (default): one email with all recipients in To: field.
 */
export async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  html?: string,
  batch = false
): Promise<void> {
  const client = getResend();
  if (!client) {
    console.warn('[sendEmail] RESEND_API_KEY not set, skipping email delivery');
    return;
  }

  const from = process.env.RESEND_FROM ?? 'alerts@noreply.example.com';

  if (!batch) {
    await client.emails.send({ from, to, subject, text, html });
    return;
  }

  for (let i = 0; i < to.length; i += CHUNK_SIZE) {
    const chunk = to.slice(i, i + CHUNK_SIZE);
    await client.batch.send(
      chunk.map((recipient) => ({ from, to: [recipient], subject, text, html }))
    );
  }
}
