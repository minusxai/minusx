# Analyst Tools Reference

## Search Tools

| Tool | Args | Result |
|------|------|--------|
| **SearchDBSchema** | `{connection_id: str, query?: str}` | No query: `{success: true, schema: [...], queryType: 'none', tableCount: int}`. JSONPath: `{success: true, schema: [{..., _schema: str, _table: str}], queryType: 'jsonpath', tableCount: int}`. String: `{success: true, results: [{schema: obj, score: float, matchCount: int, relevantResults: [{field: str, location: str, snippet: str, matchType: str}]}], queryType: 'string', tableCount: int}` |
| **SearchFiles** | `{query: str, file_types?: str[], folder_path?: str, depth?: int, limit?: int, offset?: int}` | `{success: true, results: [{id: int, name: str, path: str, type: str, score: float, snippets: str[]}], total: int}` |

## File & Query Tools

| Tool | Args | Result |
|------|------|--------|
| **ReadFiles** | `{fileIds: int[]}` | `{success: true, files: [{fileState: {id, name, path, type, isDirty, content}, references: [...], queryResults: [...]}]}` |
| **EditFile** | `{fileId: int, oldMatch: str, newMatch: str}` | `{success: true, diff: str, fileState: {id, name, path, type, isDirty, content}, references: [{id, unchanged: true} or full], queryResults: [{queryResultId, unchanged: true} or full]}` or `{success: false, error: str}` |
| **CreateFile** | `{file_type: str, name?: str, path?: str, content?: dict}` | `{success: true, state: {fileState: {id, name, path, type, isDirty, content}, references: [...], queryResults: [...]}}` or `{success: false, error: str}` |
| **ExecuteQuery** | `{query: str, connectionId: str, parameters?: {key: value}, vizSettings?: str}` | `{columns: str[], types: str[], rows: [{...}]}` |

## App Tools

| Tool | Args | Result |
|------|------|--------|
| **Navigate** | `{file_id?: int, path?: str, newFileType?: str}` | `{success: bool, message: str}` |
| **PublishAll** | `{}` | `{success: true, message: str}` or `{success: false, message: str}` |
| **Clarify** | `{question: str, options: [{label: str, description?: str}], multiSelect?: bool}` | `{success: bool, message: str, selection: object}` |

## Misc Tools

| Tool | Args | Result |
|------|------|--------|
| **TalkToUser** | `{content?: str, citations?: list, content_blocks?: [{...}]}` | `{success: true, content_blocks: [...]}` or `{success: true, content: str, citations: [...]}` |
