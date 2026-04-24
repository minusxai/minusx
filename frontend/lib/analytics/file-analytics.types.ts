export const FileEventType = {
  CREATED: 0,
  READ_DIRECT: 1,
  READ_AS_REFERENCE: 2,
  UPDATED: 3,
  DELETED: 4,
} as const;

export type FileEventTypeValue = typeof FileEventType[keyof typeof FileEventType];

export interface FileEvent {
  eventType: FileEventTypeValue;
  fileId: number;
  fileVersion?: number | null;
  referencedByFileId?: number | null;
  userId?: number | null;
}

export interface ConversationAnalyticsSummary {
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, { calls: number; tokens: number; cost: number }>;
}

export interface RecentFile {
  fileId: number;
  fileType: string;
  fileName: string;
  filePath: string;
  lastVisited: string;
  viewCount?: number;
  uniqueViewers?: number;
}

export interface FileAnalyticsSummary {
  totalViews: number;
  uniqueViewers: number;
  totalEdits: number;
  uniqueEditors: number;
  usedByFiles: number;
  createdAt: string | null;
  createdBy: string | null;
  lastEditedAt: string | null;
  lastEditedBy: string | null;
}
