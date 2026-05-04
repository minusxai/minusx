import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface EditChange {
  oldMatch: string;
  newMatch: string;
  replaceAll?: boolean;
}

interface Args {
  fileId: number;
  changes: EditChange[];
}

const EDIT_FILE_DESCRIPTION = `Edit a file using an ordered list of string find-and-replace changes.

Search for each oldMatch in the FULL file JSON and replace with newMatch.
The file JSON includes: {"id": 123, "name": "...", "path": "...", "type": "question", "content": {...}}

You can edit ANY field (name, path, or content) using this tool.

Changes are applied sequentially in order — later entries can depend on earlier ones.
All changes succeed or the batch fails: on failure the response includes succeededCount
and failedIndex so you know exactly where to retry.

CRITICAL — query + parameters must stay in sync:
If a change adds or removes :paramName tokens in the query, you MUST include a corresponding
change to the parameters array in the same call.

replaceAll behaviour (per change):
- replaceAll=true (default): replace EVERY occurrence of oldMatch in the file JSON.
- replaceAll=false: replace only if oldMatch is unique. Returns an error if non-unique.

Changes are staged as drafts. The user reviews and publishes via the Publish All button.

String Matching: Use oldMatch copied directly from AppState content — never call ReadFiles just to get content already in AppState.`;

export class EditFile extends Tool<Args> {
  readonly name = 'EditFile';
  readonly description = EDIT_FILE_DESCRIPTION;
  readonly schema = Type.Object({
    fileId: Type.Integer({ description: 'File ID to edit' }),
    changes: Type.Array(
      Type.Object({
        oldMatch: Type.String({ description: 'String to search for in full file JSON' }),
        newMatch: Type.String({ description: 'String to replace with' }),
        replaceAll: Type.Optional(Type.Boolean({ description: 'Replace ALL occurrences (true) or error if not unique (false)' })),
      }),
      { description: 'Ordered list of find-and-replace changes to apply sequentially' },
    ),
  });

  async run(_args: Args): Promise<ToolResult> {
    return {
      state: 'failure',
      error: 'EditFile is not available in server-run mode. File editing requires an interactive session.',
    };
  }
}
