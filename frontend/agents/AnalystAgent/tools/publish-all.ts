import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { ToolResult } from '@/orchestrator/types';

const SCHEMA = Type.Object({});

export class PublishAll extends Tool<typeof SCHEMA> {
  readonly name = 'PublishAll';
  readonly description =
    'Request the user to review and publish all unsaved changes. Opens a modal showing all draft files. If there are no unsaved changes, returns immediately.';
  readonly schema = SCHEMA;

  async run(): Promise<ToolResult> {
    return {
      state: 'failure',
      error: 'PublishAll is not available in server-run mode. Publishing requires an interactive session.',
    };
  }
}
