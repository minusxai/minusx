import 'server-only';
import { BACKEND_URL } from '@/lib/config';

export interface GoogleSheetsDeleteResult {
  success: boolean;
  message: string;
}

export async function deleteGoogleSheetsData(
  connectionName: string,
  mode: string
): Promise<GoogleSheetsDeleteResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/google-sheets/delete/${encodeURIComponent(connectionName)}`, {
      method: 'DELETE',
      headers: {
        'x-mode': mode
      }
    });

    if (!res.ok) {
      const error = await res.text();
      return { success: false, message: `Delete failed: ${error}` };
    }

    return await res.json();
  } catch (error) {
    return { success: false, message: `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}
