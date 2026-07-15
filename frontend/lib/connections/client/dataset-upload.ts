/**
 * Client-side dataset creation — the self-serve "add data to my folder" flow.
 * Upload: presign → PUT to S3 → POST /api/datasets (registers + creates the doc).
 * Link:   POST /api/datasets with source_url (server fetches + snapshots it).
 */

export interface DatasetCreateResult {
  success: boolean;
  id?: number;
  message?: string;
}

function contentType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'parquet' || ext === 'pq') return 'application/octet-stream';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'text/csv';
}

async function presign(file: File, name: string): Promise<{ uploadUrl: string; s3Key: string }> {
  const params = new URLSearchParams({
    filename: file.name, contentType: contentType(file), keyType: 'csvs', connectionName: name,
  });
  const res = await fetch(`/api/object-store/upload-url?${params}`);
  if (!res.ok) throw new Error(`Failed to get upload URL: ${await res.text()}`);
  return res.json();
}

async function register(body: object): Promise<DatasetCreateResult> {
  const res = await fetch('/api/datasets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    return { success: false, message: json?.error?.message ?? json?.message ?? 'Could not create the dataset' };
  }
  return { success: true, id: json.data?.id };
}

/** Upload local files (CSV/XLSX/Parquet) into a new dataset in `folder`. */
export async function createDatasetFromUploads(
  folder: string, name: string, schemaName: string, files: File[],
  onStage?: (msg: string) => void,
): Promise<DatasetCreateResult> {
  try {
    const records: Array<{ s3_key: string; filename: string; schema_name: string }> = [];
    for (const file of files) {
      onStage?.(`Uploading ${file.name}…`);
      const { uploadUrl, s3Key } = await presign(file, name);
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType(file) }, body: file });
      if (!put.ok) throw new Error(`Upload failed for ${file.name}: ${put.status}`);
      records.push({ s3_key: s3Key, filename: file.name, schema_name: schemaName });
    }
    onStage?.('Registering tables…');
    return await register({ path: folder, name, files: records });
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Upload failed' };
  }
}

/** Import a link source (Google Sheets today) into a new dataset in `folder`. */
export async function createDatasetFromLink(
  folder: string, name: string, schemaName: string, sourceUrl: string,
): Promise<DatasetCreateResult> {
  return register({ path: folder, name, schema_name: schemaName, source_url: sourceUrl });
}

/** Append uploaded files to an EXISTING dataset. */
export async function addFilesToDataset(
  fileId: number, datasetName: string, schemaName: string, files: File[],
  onStage?: (msg: string) => void,
): Promise<DatasetCreateResult> {
  try {
    const records: Array<{ s3_key: string; filename: string; schema_name: string }> = [];
    for (const file of files) {
      onStage?.(`Uploading ${file.name}…`);
      const { uploadUrl, s3Key } = await presign(file, datasetName);
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType(file) }, body: file });
      if (!put.ok) throw new Error(`Upload failed for ${file.name}: ${put.status}`);
      records.push({ s3_key: s3Key, filename: file.name, schema_name: schemaName });
    }
    return await patchDataset(fileId, { action: 'add-files', files: records });
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Upload failed' };
  }
}

/** Remove one table (and its stored object) from a dataset. */
export async function deleteDatasetTable(fileId: number, table: string): Promise<DatasetCreateResult> {
  return patchDataset(fileId, { action: 'delete-table', table });
}

/** Re-snapshot a link source group (Google Sheets today). */
export async function reimportDatasetGroup(fileId: number, sourceGroup: string): Promise<DatasetCreateResult> {
  return patchDataset(fileId, { action: 'reimport', source_group: sourceGroup });
}

async function patchDataset(fileId: number, body: object): Promise<DatasetCreateResult> {
  const res = await fetch(`/api/datasets/${fileId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    return { success: false, message: json?.error?.message ?? json?.message ?? 'Action failed' };
  }
  return { success: true, id: fileId };
}
