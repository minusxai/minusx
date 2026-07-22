'use client';

/**
 * StoryJsxBody — the live React body of a NEW-FORMAT (format: 'jsx') story (Story_Design_V2 §2).
 *
 * The story's `content.story` is STATIC JSX source; this component parses it (lib/jsx) and
 * renders it through the story interpreter (lib/story-ui) over the shadcn registry plus the
 * three embed adapters below. It mounts through the SAME nested-in-iframe React root
 * architecture the legacy placeholder path uses (AgentHtml portals it into the story surface
 * root), re-providing the app contexts via StoryEmbedProviders — so Radix interactivity and
 * the embedded chart stack both get real event delegation inside the iframe.
 *
 * The embed adapters (<Question>, <Number>, <Param>) map the interpreter's props — the exact
 * JSX attr names lib/data/story/story-v2.ts documents — onto the SAME components the legacy
 * `data-*` placeholders resolve to (SmartEmbeddedQuestionContainer / EmbeddedQuestionContainer /
 * InlineNumber / StoryParamControl). Chart rendering is never reimplemented here.
 *
 * WYSIWYG editing (Story_Design_V2 §2): with `editable`, HTML text hosts (direct non-whitespace
 * text, no component/embed descendants — isEditableTextHost) render contenteditable; component
 * chrome stays locked. A blur after REAL user input commits by AST write-back
 * (applyDomEditsToJsx against the CURRENT `jsx` prop, with the full accumulated edit set so
 * sequential edits compose) and emits the new source via `onChange`. While a host has focus its
 * rendered subtree is FROZEN (the last element is returned by reference, so React bails out of
 * reconciling it) — an upstream re-render (param change, embed refetch) can never clobber typing.
 */
import {
  createContext, memo, useContext, useEffect, useMemo, useState,
  cloneElement, type ComponentType, type ReactElement, type RefObject, type FocusEvent, type FormEvent,
} from 'react';
import { Box } from '@chakra-ui/react';

import { parseJsx, type JsxNode, type JsxElement } from '@/lib/jsx';
import {
  STORY_UI_COMPONENTS, TooltipProvider, renderStoryNodes, AST_PATH_ATTR,
} from '@/lib/story-ui';
import { StoryEmbedProviders } from '@/components/views/shared/StoryEmbeds';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';
import StoryParamControl from '@/components/views/story/StoryParamControl';
import InlineNumber from '@/components/views/story/InlineNumber';
import {
  inlineQuestionFromJsxAttrs, inlineEmbedToQuestionContent, vizEnvelopeFromAttr,
} from '@/lib/data/story/story-question';
import { numberFromJsxAttrs } from '@/lib/data/story/story-number';
import {
  paramFromJsxAttrs, storyParamToQuestionParameter, type StoryParam,
} from '@/lib/data/story/story-params';
import { applyDomEditsToJsx, isEditableTextHost } from '@/lib/data/story/jsx-edit';
import { envelopeVizType } from '@/lib/viz/viz-templates';
import type { QuestionParameter } from '@/lib/types';

// Embed sizing floors/defaults — the same contract AgentHtml applies to legacy placeholders.
const MIN_CHART_H = 340;
const DEFAULT_CHART_H = 400;
const SINGLE_VALUE_MIN_H = 48;
const SINGLE_VALUE_DEFAULT_H = 120;

export interface StoryJsxBodyProps {
  /** The iframe's document — floating content (ark-ui, Radix poppers) positions against it. */
  doc: Document;
  /** The story's JSX source (`content.story` of a format:'jsx' story). */
  jsx: string;
  /** Public read-only render (shared story): embedded charts hide actions + auth-gated links. */
  readOnly: boolean;
  /** Default/current shared param values (keyed by `<Param name>`); seeded once. */
  paramValues?: Record<string, unknown>;
  onParamValuesChange?: (values: Record<string, unknown>) => void;
  /** Path of the hosting story — forwarded to embeds' /api/query so guests pass the embed allowlist. */
  filePath?: string;
  /** The story surface's color mode — pins the embedded chart stack's theme (see StoryEmbeds). */
  colorMode?: 'light' | 'dark';
  /** WYSIWYG edit mode: text hosts become contenteditable (component chrome stays locked). */
  editable?: boolean;
  /** Fired with the updated JSX SOURCE after each blur-commit (AST write-back, never DOM scrape). */
  onChange?: (story: string) => void;
  /** Imperative pending-edit access for AgentHtml's serialize() handle. */
  editApiRef?: RefObject<StoryJsxEditApi | null>;
}

export interface StoryJsxEditApi {
  /** The current source with all pending edits applied — null when there is nothing to commit. */
  serialize: () => string | null;
}

/**
 * Mutable WYSIWYG session shared between the render-time decorator and the host handlers.
 * ONE stable instance per body; ALL mutable state lives in the factory's closure (an
 * imperative subsystem beside React, like a store), so handlers captured by a frozen host
 * always read live state and commits always run against the CURRENT source prop.
 */
interface EditSession {
  /** Sync the latest props in (post-commit, before any user event can fire). */
  setProps: (jsx: string, onChange?: (story: string) => void) => void;
  /** True while `path` is the focused host — its rendered subtree must stay frozen. */
  isEditing: (path: string) => boolean;
  onFocus: (path: string, el: HTMLElement) => void;
  onInput: () => void;
  onBlur: () => void;
  /** Current source with all pending edits applied; null when there is nothing to commit. */
  serialize: () => string | null;
}

function createEditSession(): EditSession {
  let jsx = '';
  let onChange: ((story: string) => void) | undefined;
  let active: { path: string; el: HTMLElement; snapshot: string; userEdited: boolean } | null = null;
  // Committed edits (astPath → innerHTML), ALL re-applied against the CURRENT source prop on
  // every commit — sequential edits compose even though the rendered AST stays the original's.
  const edits = new Map<string, string>();
  const asEdits = (m: Map<string, string>) => [...m].map(([astPath, innerHtml]) => ({ astPath, innerHtml }));
  return {
    setProps(nextJsx, nextOnChange) {
      jsx = nextJsx;
      onChange = nextOnChange;
    },
    isEditing: (path) => active?.path === path,
    onFocus(path, el) {
      active = { path, el, snapshot: el.innerHTML, userEdited: false };
    },
    onInput() {
      if (active) active.userEdited = true;
    },
    onBlur() {
      const a = active;
      active = null;
      // Real user input only (the legacy userEdited gate): programmatic focus churn from
      // embeds mounting/unmounting must never echo a serialization into the file.
      if (!a || !a.userEdited || a.el.innerHTML === a.snapshot) return;
      edits.set(a.path, a.el.innerHTML);
      onChange?.(applyDomEditsToJsx(jsx, asEdits(edits)).source);
    },
    serialize() {
      // Committed edits + the in-progress one (Save can land before the host blurs).
      const pending = new Map(edits);
      if (active && active.userEdited && active.el.innerHTML !== active.snapshot) {
        pending.set(active.path, active.el.innerHTML);
      }
      if (pending.size === 0) return null;
      return applyDomEditsToJsx(jsx, asEdits(pending)).source;
    },
  };
}

/**
 * Wraps a text host with scoped contenteditable. The memo comparator IS the render-during-edit
 * guard (§2): while this host has focus (`session.isEditing(path)`) it reports props "equal",
 * so React bails out and never reconciles the focused subtree — an upstream re-render (param
 * change, embed refetch) cannot clobber in-progress typing. Handlers are gated to the editing
 * host itself (`target === currentTarget`) so bubbled focus/input from nested markup — or, with
 * nested hosts, from the outer editing host — never double-commits.
 */
const EditableTextHost = memo(function EditableTextHost({ path, session, children }: {
  path: string;
  session: EditSession;
  children: ReactElement<Record<string, unknown>>;
}) {
  const gate = <E extends { target: EventTarget; currentTarget: EventTarget }>(fn: (e: E) => void) =>
    (e: E) => { if (e.target === e.currentTarget) fn(e); };
  return cloneElement(children, {
    contentEditable: true,
    suppressContentEditableWarning: true,
    onFocus: gate((e: FocusEvent<HTMLElement>) => session.onFocus(path, e.currentTarget)),
    onInput: gate((_e: FormEvent<HTMLElement>) => session.onInput()),
    onBlur: gate((_e: FocusEvent<HTMLElement>) => session.onBlur()),
  });
}, (_prev, next) => next.session.isEditing(next.path));

/** Shared embed context: what every adapter needs beyond its own JSX attrs. */
interface StoryJsxEmbedContextValue {
  readOnly: boolean;
  filePath?: string;
  /** Story-declared params (from the body's `<Param>` elements) — external params for embeds. */
  externalParameters?: QuestionParameter[];
  /** Reader's current param values. */
  values: Record<string, unknown>;
  setParamValue: (name: string, v: unknown) => void;
}

const StoryJsxEmbedContext = createContext<StoryJsxEmbedContextValue>({
  readOnly: true,
  values: {},
  setParamValue: () => {},
});

/** "300px" | 300 → clamped px height for an embed card (legacy sizeEmbedEl contract). */
function embedHeightPx(h: unknown, minH: number, defaultH: number): number {
  const n = typeof h === 'number' ? h : typeof h === 'string' ? parseFloat(h) : NaN;
  return Number.isFinite(n) ? Math.max(n, minH) : defaultH;
}

/**
 * `<Question id={N} viz={…} height=… />` (saved) or `<Question query={`…`} connection=…
 * viz={…} params={…} spreadsheet={…} height=… />` (inline) — same polymorphic contract as
 * story-v2.ts's placeholder compile, mounted on the same embed containers as StoryEmbeds.
 */
function QuestionEmbedAdapter(props: Record<string, unknown>) {
  const ctx = useContext(StoryJsxEmbedContext);
  const extParams = ctx.externalParameters?.length ? ctx.externalParameters : undefined;
  const extValues = ctx.externalParameters?.length ? ctx.values : undefined;
  const astPath = props[AST_PATH_ATTR];

  // Saved question by id — the `data-question-id` placeholder's equivalent.
  if (typeof props.id === 'number') {
    return (
      <Box
        {...{ [AST_PATH_ATTR]: astPath }}
        className="mx-chart-fill"
        width="100%"
        height={`${embedHeightPx(props.height, MIN_CHART_H, DEFAULT_CHART_H)}px`}
        bg="bg.subtle"
        borderWidth="1px"
        borderColor="border.default"
        borderRadius="md"
        overflow="hidden"
        display="flex"
        flexDirection="column"
      >
        <SmartEmbeddedQuestionContainer
          questionId={props.id}
          vizOverride={vizEnvelopeFromAttr(props.viz) ?? null}
          showTitle={true}
          readOnly={ctx.readOnly}
          showActionsMenu={false}
          enableDrilldown={false}
          externalParameters={extParams}
          externalParamValues={extValues}
        />
      </Box>
    );
  }

  // Inline story-local question — the `data-question-inline` placeholder's equivalent.
  const embed = inlineQuestionFromJsxAttrs(props);
  if (!embed) return null;
  const bare = envelopeVizType(embed.viz) === 'single_value';
  const h = embedHeightPx(
    embed.height,
    bare ? SINGLE_VALUE_MIN_H : MIN_CHART_H,
    bare ? SINGLE_VALUE_DEFAULT_H : DEFAULT_CHART_H,
  );
  return (
    <Box
      {...{ [AST_PATH_ATTR]: astPath }}
      className="mx-chart-fill"
      position="relative"
      width="100%"
      height={`${h}px`}
      {...(bare ? {} : { bg: 'bg.subtle', borderWidth: '1px', borderColor: 'border.default', borderRadius: 'md' })}
      overflow="hidden"
      display="flex"
      flexDirection="column"
    >
      <EmbeddedQuestionContainer
        question={inlineEmbedToQuestionContent(embed)}
        questionId={0}
        externalParameters={extParams}
        externalParamValues={extValues}
        enableDrilldown={false}
        filePath={ctx.filePath}
      />
    </Box>
  );
}

/** `<Number id={N}|query={`…`} connection=… col=… prefix=… suffix=… style={…} />`. */
function NumberEmbedAdapter(props: Record<string, unknown>) {
  const ctx = useContext(StoryJsxEmbedContext);
  const embed = numberFromJsxAttrs(props);
  if (!embed) return null;
  const extValues = ctx.externalParameters?.length ? ctx.values : undefined;
  return (
    <InlineNumber
      embed={embed}
      externalParamValues={extValues}
      editable={false}
      filePath={ctx.filePath}
    />
  );
}

/** `<Param name=… type=… nullable=… id={N} column=… widget=… min/max/step style/labelStyle />`. */
function ParamControlAdapter(props: Record<string, unknown>) {
  const ctx = useContext(StoryJsxEmbedContext);
  const param = paramFromJsxAttrs(props);
  if (!param) return null;
  return (
    <StoryParamControl
      param={param}
      value={ctx.values[param.name]}
      onChange={(v) => ctx.setParamValue(param.name, v)}
    />
  );
}

/** The interpreter registry for jsx stories: shadcn components + the three embed adapters. */
const STORY_JSX_REGISTRY: Record<string, ComponentType<Record<string, unknown>>> = {
  ...STORY_UI_COMPONENTS,
  Question: QuestionEmbedAdapter,
  Number: NumberEmbedAdapter,
  Param: ParamControlAdapter,
};

/** Walk the AST for `<Param>` declarations — the story's shared params (external params for embeds). */
function collectStoryParams(nodes: JsxNode[]): StoryParam[] {
  const out: StoryParam[] = [];
  const walk = (list: JsxNode[]) => {
    for (const n of list) {
      if (n.type !== 'element') continue;
      if (n.isComponent && n.tag === 'Param') {
        const attrs: Record<string, unknown> = {};
        for (const a of n.attributes) if (a.value.static) attrs[a.name] = a.value.json;
        const p = paramFromJsxAttrs(attrs);
        if (p) out.push(p);
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const NO_NODES: JsxNode[] = [];

export default function StoryJsxBody({
  doc, jsx, readOnly, paramValues, onParamValuesChange, filePath, colorMode, editable, onChange, editApiRef,
}: StoryJsxBodyProps) {
  const parsed = useMemo(() => parseJsx(jsx), [jsx]);

  // ── WYSIWYG edit session ─────────────────────────────────────────────────────────────────
  // One stable session per body; the latest source/callback are synced in (post-commit, before
  // any user event can fire) so handlers captured inside frozen, cached elements always commit
  // against the current props.
  const session = useMemo(() => createEditSession(), []);
  useEffect(() => {
    session.setProps(jsx, onChange);
  }, [session, jsx, onChange]);

  useEffect(() => {
    if (!editApiRef) return;
    editApiRef.current = { serialize: () => session.serialize() };
    return () => { editApiRef.current = null; };
  }, [editApiRef, session]);

  // Text hosts get contenteditable + the render-during-edit freeze; everything else is locked
  // by default (only decorated hosts ever carry contentEditable under the interpreter).
  const decorateElement = editable
    ? (element: ReactElement, node: JsxElement, path: string) =>
        isEditableTextHost(node)
          ? <EditableTextHost key={path} path={path} session={session}>{element as ReactElement<Record<string, unknown>>}</EditableTextHost>
          : element
    : undefined;
  const nodes = parsed.ok ? parsed.nodes : NO_NODES;
  const storyParams = useMemo(() => collectStoryParams(nodes), [nodes]);
  const externalParameters = useMemo(
    () => storyParams.map(storyParamToQuestionParameter),
    [storyParams],
  );

  // Shared param context (reader's current values), seeded once from the story defaults —
  // the body remounts (with the iframe) when the story content changes, re-seeding.
  const [values, setValues] = useState<Record<string, unknown>>(paramValues ?? {});
  const setParamValue = (name: string, v: unknown) => setValues(prev => {
    const next = { ...prev, [name]: v };
    onParamValuesChange?.(next);
    return next;
  });

  const ctx: StoryJsxEmbedContextValue = {
    readOnly,
    filePath,
    externalParameters: externalParameters.length ? externalParameters : undefined,
    values,
    setParamValue,
  };

  if (!parsed.ok) {
    // Read path stays graceful on a bad body (save-time validation is the real gate).
    return <div aria-label="Story parse error" style={{ display: 'none' }}>{parsed.error}</div>;
  }

  return (
    <StoryEmbedProviders doc={doc} colorMode={colorMode}>
      <StoryJsxEmbedContext.Provider value={ctx}>
        <TooltipProvider>
          {renderStoryNodes(nodes, { components: STORY_JSX_REGISTRY, decorateElement })}
        </TooltipProvider>
      </StoryJsxEmbedContext.Provider>
    </StoryEmbedProviders>
  );
}
