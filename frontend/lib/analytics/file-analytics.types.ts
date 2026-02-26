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
