import { Agent } from '@/orchestrator/agent';
import type { Tool } from '@/orchestrator/tool';
import type { RunContext } from '@/orchestrator/types';
import { Clarify } from './tools/clarify';
import { CreateFile } from './tools/create-file';
import { EditFile } from './tools/edit-file';
import { ExecuteQuery } from './tools/execute-query';
import { LoadSkill } from './tools/load-skill';
import { PublishAll } from './tools/publish-all';
import { ReadFiles } from './tools/read-files';
import { SearchDBSchema } from './tools/search-db-schema';
import { SearchFiles } from './tools/search-files';
import { CannotAnswer } from '../CommonTools/cannot-answer';
import { SubmitBinary } from '../CommonTools/submit-binary';
import { SubmitNumber } from '../CommonTools/submit-number';
import { SubmitString } from '../CommonTools/submit-string';
import { TalkToUser } from '../CommonTools/talk-to-user';
import { getPrompt } from './prompt-loader';
import './types';
import type { SchemaWhitelistEntry } from './types';

export const MAX_STEPS = 35;

export interface AnalystAgentOptions {
  goal: string;
  connectionId?: string;
  schema?: SchemaWhitelistEntry[] | null;
  context?: string;
  appState?: Record<string, unknown> | null;
  homeFolder?: string;
  agentName?: string;
  allowedVizTypes?: string[] | null;
  role?: string;
  attachments?: Array<{ type: string; name?: string; content?: string; metadata?: Record<string, unknown> }>;
}

export class AnalystAgent extends Agent {
  readonly name: string = 'AnalystAgent';
  tools: Tool[];

  protected readonly opts: AnalystAgentOptions;

  constructor(opts: AnalystAgentOptions) {
    super();
    this.opts = opts;
    this.tools = this.getDefaultTools();
  }

  /**
   * Default tool set. Subclasses (SlackAgent, WebAnalystAgent) override or filter.
   * Mirrors `_get_available_tools()` in Python AnalystAgent.
   */
  protected getDefaultTools(): Tool[] {
    return [
      new ReadFiles(),
      new EditFile(),
      new ExecuteQuery(),
      new PublishAll(),
      new Clarify(),
      new SearchDBSchema(),
      new SearchFiles(),
      new CreateFile(),
      new LoadSkill(),
      new TalkToUser(),
      // Eval-time tools — present in headless mode for evals
      new SubmitBinary(),
      new SubmitNumber(),
      new SubmitString(),
      new CannotAnswer(),
    ];
  }

  /**
   * Inject `_schema` into ctx.contextArgs. SearchDBSchema and ExecuteQuery declare
   * `_schema` in their TypeBox schema, so they receive it automatically. Other tools
   * ignore it. Mirrors the per-call `call.args['_schema'] = self.schema` injection in
   * Python AnalystAgent.run().
   *
   * `null` (no active context) → don't inject; tools see full schema.
   * `[]`  (empty whitelist)    → inject so tools return nothing.
   * `[…]` (whitelist)          → inject to filter results.
   */
  buildAgentTools(ctx: RunContext) {
    if (this.opts.schema != null) {
      ctx.contextArgs = { ...(ctx.contextArgs ?? {}), _schema: this.opts.schema };
    }
    return super.buildAgentTools(ctx);
  }

  systemPrompt(): string {
    const allowedVizTypesStr = this.opts.allowedVizTypes && this.opts.allowedVizTypes.length > 0
      ? this.opts.allowedVizTypes.join(', ')
      : 'all';
    return getPrompt('default.system', {
      schema: this.opts.schema ?? [],
      context: this.opts.context ?? '',
      connection_id: this.opts.connectionId ?? '',
      home_folder: this.opts.homeFolder ?? '',
      max_steps: MAX_STEPS - 5,
      agent_name: this.opts.agentName ?? 'MinusX',
      allowed_viz_types: allowedVizTypesStr,
      role: this.opts.role ?? '',
      skills_catalog: '',  // TODO: build skills catalog
      preloaded_skills: '',  // TODO: build preloaded skills content
    });
  }

  /**
   * Build the user message. Used by route.ts when constructing the initial prompt.
   * Mirrors `_get_user_message()` in Python.
   */
  userMessage(): string {
    const appStateStr = this.opts.appState ? JSON.stringify(this.opts.appState) : 'null';
    const attachmentsStr = this.formatAttachments();
    return getPrompt('default.user', {
      app_state: appStateStr,
      goal: this.opts.goal,
      current_date: new Date().toISOString().slice(0, 10),
      attachments: attachmentsStr,
    });
  }

  protected formatAttachments(): string {
    if (!this.opts.attachments) return '';
    const parts: string[] = [];
    for (const att of this.opts.attachments) {
      if (att.type !== 'text') continue;
      const name = att.name ?? 'attachment';
      const content = att.content ?? '';
      const pages = (att.metadata as { pages?: number } | undefined)?.pages;
      const header = `[${name}]${pages ? ` (${pages} pages)` : ''}`;
      parts.push(`<Attachment ${header}>\n${content}\n</Attachment>`);
    }
    return parts.join('\n');
  }
}

/**
 * Slack-restricted agent: read-only tool set, plus slack_addendum appended to system prompt.
 * Mirrors Python SlackAgent.
 */
export class SlackAgent extends AnalystAgent {
  readonly name = 'SlackAgent';

  protected getDefaultTools(): Tool[] {
    return [
      new ReadFiles(),
      new ExecuteQuery(),
      new SearchDBSchema(),
      new SearchFiles(),
      new LoadSkill(),
      new TalkToUser(),
    ];
  }

  systemPrompt(): string {
    const base = super.systemPrompt();
    const addendum = getPrompt('slack_addendum');
    return `${base}\n\n${addendum}`;
  }
}
