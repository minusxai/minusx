export type FileEventType = 'created' | 'updated' | 'deleted' | 'read_direct' | 'read_as_reference';

export interface FileEvent {
  eventType: FileEventType;
  fileId: number;
  fileType?: string;
  filePath?: string;
  fileName?: string;
  userId?: number;
  userEmail?: string;
  userRole?: string;
  companyId: number;  // used to route to correct DB file, not stored in row
  referencedByFileId?: number;
  referencedByFileType?: string;
}

export interface FileAnalyticsSummary {
  totalViews: number;           // COUNT(*) WHERE event_type = 'read_direct'
  uniqueViewers: number;        // COUNT(DISTINCT user_id) WHERE event_type = 'read_direct'
  totalEdits: number;           // COUNT(*) WHERE event_type = 'updated'
  uniqueEditors: number;        // COUNT(DISTINCT user_id) WHERE event_type = 'updated'
  usedByFiles: number;          // COUNT(DISTINCT referenced_by_file_id) WHERE event_type = 'read_as_reference'
  createdAt: string | null;     // MIN(timestamp) WHERE event_type = 'created'
  createdBy: string | null;     // user_email of first 'created' event
  lastEditedAt: string | null;  // MAX(timestamp) WHERE event_type = 'updated'
  lastEditedBy: string | null;  // user_email of latest 'updated' event
}
