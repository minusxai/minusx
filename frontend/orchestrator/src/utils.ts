import { randomBytes } from 'crypto';

export function generateId(): string {
  return `mxgen_${randomBytes(12).toString('hex')}`;
}
