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

import { parseJsx, type JsxNode, type JsxElement } from '@/lib/jsx';
import {
  STORY_UI_COMPONENTS, TooltipProvider, renderStoryNodes, AST_PATH_ATTR,
} from '@/lib/story-ui';
import {
  StoryEmbedProviders, InlineCardActionsMenu,
  type StoryParamQueryEditRequest, type StoryQuestionEditRequest,
} from '@/components/views/shared/StoryEmbeds';
import type { NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';
import StoryParamControl from '@/components/views/story/StoryParamControl';
import InlineNumber from '@/components/views/story/InlineNumber';
import {
  inlineQuestionFromJsxAttrs, inlineEmbedToQuestionContent, vizEnvelopeFromAttr,
} from '@/lib/data/story/story-question';
import { numberFromJsxAttrs } from '@/lib/data/story/story-number';
import {
  isStorySqlParamSource, paramFromJsxAttrs, storyParamToQuestionParameter, type StoryParam,
} from '@/lib/data/story/story-params';
import { applyDomEditsToJsx, applyFormatEditsToJsx, resolveJsxNodeAtPath, type JsxFormatEdit, isEditableTextHost } from '@/lib/data/story/jsx-edit';
import { crumbHint } from '@/lib/data/story/typography';
import { envelopeVizType } from '@/lib/viz/viz-templates';
import type { QuestionParameter } from '@/lib/types';

// Embed sizing floors/defaults — the same contract AgentHtml applies to legacy placeholders
// (and the default the skill documents: "Missing height defaults to 430px").
const MIN_CHART_H = 340;
const DEFAULT_CHART_H = 430;
const SINGLE_VALUE_MIN_H = 48;
const SINGLE_VALUE_DEFAULT_H = 120;

// The embed card's chrome, as TOKEN CLASSES compiled into every story's CSS (this file is in
// EMBED_CHROME_FILES). The story iframe has no other style source — Chakra/emotion rules live
// in the top document and never reach it, so wrapper chrome must be Tailwind classes and
// SIZING must be inline style (see QuestionEmbedAdapter). Class parity with dashboard tiles.
const EMBED_CARD_CLASSES = 'flex flex-col overflow-hidden rounded-md border border-border bg-card';
const EMBED_BARE_CLASSES = 'flex flex-col overflow-hidden';

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
  /** Edit mode: opens the question-embed modal (saved / override / ephemeral) with a jsx AST-path ref. */
  onEditQuestion?: (req: StoryQuestionEditRequest) => void;
  /** Edit mode: opens the full SQL editor for a query-backed Param source. */
  onEditParamQuery?: (req: StoryParamQueryEditRequest) => void;
  /** Edit mode: requests an inline `<Number>` query edit, carrying the embed's AST path. */
  onEditNumber?: (req: NumberQueryEditRequest) => void;
  /** Imperative pending-edit access for AgentHtml's serialize() handle. */
  editApiRef?: RefObject<StoryJsxEditApi | null>;
  /**
   * Edit mode: fired when an editable text host gains/loses focus — anchors the typography
   * toolbar. `null` on blur / session teardown.
   */
  onTextHostFocusChange?: (target: StoryTextHostTarget | null) => void;
  /**
   * Edit mode: fired when a plain, non-text-host element (section, wrapper div, embed-carrying
   * heading) is click-selected as a FORMAT target (Phase 2) — same shape as the focus anchor.
   * `null` when the selection clears (text-host click, Escape, empty click, teardown).
   */
  onElementSelectChange?: (target: StoryTextHostTarget | null) => void;
}

/** Render artifact marking the click-selected format target (outline via STORY_SELECTION_CSS;
 *  stripped by the DOM→JSX sanitizer, so it can never persist into source). */
export const SELECTED_DOM_ATTR = 'data-mx-selected';
/** Render artifact previewing what a click would select (edit-mode hover). */
export const HOVER_DOM_ATTR = 'data-mx-hover';

/** Selection + hover-preview outline rules — injected into the iframe head by AgentHtml. */
export const STORY_SELECTION_CSS = [
  `[${SELECTED_DOM_ATTR}] { outline: 2px dashed #14b8a6; outline-offset: 2px; }`,
  `[${HOVER_DOM_ATTR}]:not([${SELECTED_DOM_ATTR}]) { outline: 1px dashed rgba(20, 184, 166, 0.45); outline-offset: 2px; }`,
].join('\n');

/** One ancestor in the universal toolbar breadcrumb: enough to label and re-anchor to it. */
export interface StoryAncestorCrumb {
  astPath: string;
  tag: string;
  /** The most salient class (width constraint / layout role) — see crumbHint. */
  hint: string;
}

/** A focused or selected typography-toolbar target. `el` lives in the iframe DOM. */
export interface StoryTextHostTarget {
  astPath: string;
  el: HTMLElement;
  /** The selectable ancestor chain, OUTERMOST first (universal toolbar breadcrumb). */
  ancestors?: StoryAncestorCrumb[];
}

/** A typography-toolbar edit: each present field is the attr's full new value ('' removes). */
export type StoryFormatEdit = Omit<JsxFormatEdit, 'astPath'>;

export interface StoryJsxEditApi {
  /** The current source with all pending edits applied — null when there is nothing to commit. */
  serialize: () => string | null;
  /**
   * Record a className/style edit for the element at `astPath` (typography toolbar commit).
   * Staged in the edit session beside contenteditable edits — every commit composes BOTH kinds
   * against the current source, and onChange fires immediately with the composed result.
   */
  applyFormatEdit: (astPath: string, edit: StoryFormatEdit) => void;
  /**
   * Re-anchor the click-selection to the element at `astPath` (breadcrumb navigation). Only
   * selectable targets (plain, non-text-host, non-root) take effect; anything else is ignored.
   */
  selectElement: (astPath: string) => void;
}

/** Late-bound select-by-path entry point (set by the selection effect, read by the edit API). */
function createSelectByPathSlot() {
  let fn: (astPath: string) => void = () => {};
  return {
    set(next: (astPath: string) => void) { fn = next; },
    invoke(astPath: string) { fn(astPath); },
  };
}

/**
 * Mutable WYSIWYG session shared between the render-time decorator and the host handlers.
 * ONE stable instance per body; ALL mutable state lives in the factory's closure (an
 * imperative subsystem beside React, like a store), so handlers captured by a frozen host
 * always read live state and commits always run against the CURRENT source prop.
 */
interface EditSession {
  /** Sync the latest props in (post-commit, before any user event can fire). */
  setProps: (jsx: string, onChange?: (story: string) => void, onFocusChange?: (target: StoryTextHostTarget | null) => void) => void;
  /** True while `path` is the focused host — its rendered subtree must stay frozen. */
  isEditing: (path: string) => boolean;
  onFocus: (path: string, el: HTMLElement) => void;
  onInput: () => void;
  onBlur: () => void;
  /** Stage a className/style edit for the element at `path` (typography toolbar) and fire onChange. */
  applyFormatEdit: (path: string, edit: StoryFormatEdit) => void;
  /** Current source with all pending edits applied; null when there is nothing to commit. */
  serialize: () => string | null;
}

function createEditSession(): EditSession {
  let jsx = '';
  let onChange: ((story: string) => void) | undefined;
  let onFocusChange: ((target: StoryTextHostTarget | null) => void) | undefined;
  let active: { path: string; el: HTMLElement; snapshot: string; userEdited: boolean } | null = null;
  // Committed edits (astPath → innerHTML), ALL re-applied against the CURRENT source prop on
  // every commit — sequential edits compose even though the rendered AST stays the original's.
  const edits = new Map<string, string>();
  // Staged className/style edits (astPath → attr values, typography toolbar). Composed AFTER the
  // innerHTML edits on EVERY commit — a text-edit blur must never re-derive the source without
  // the format changes, and vice versa (the no-clobber invariant).
  const formatEdits = new Map<string, Omit<JsxFormatEdit, 'astPath'>>();
  const asEdits = (m: Map<string, string>) => [...m].map(([astPath, innerHtml]) => ({ astPath, innerHtml }));
  const composed = (inner: Map<string, string>) =>
    applyFormatEditsToJsx(
      applyDomEditsToJsx(jsx, asEdits(inner)).source,
      [...formatEdits].map(([astPath, edit]) => ({ astPath, ...edit })),
    );
  return {
    setProps(nextJsx, nextOnChange, nextOnFocusChange) {
      jsx = nextJsx;
      onChange = nextOnChange;
      onFocusChange = nextOnFocusChange;
    },
    isEditing: (path) => active?.path === path,
    onFocus(path, el) {
      active = { path, el, snapshot: el.innerHTML, userEdited: false };
      onFocusChange?.({ astPath: path, el });
    },
    onInput() {
      if (active) active.userEdited = true;
    },
    onBlur() {
      const a = active;
      active = null;
      onFocusChange?.(null);
      // Real user input only (the legacy userEdited gate): programmatic focus churn from
      // embeds mounting/unmounting must never echo a serialization into the file.
      if (!a || !a.userEdited || a.el.innerHTML === a.snapshot) return;
      edits.set(a.path, a.el.innerHTML);
      onChange?.(composed(edits));
    },
    applyFormatEdit(path, edit) {
      formatEdits.set(path, { ...formatEdits.get(path), ...edit });
      onChange?.(composed(edits));
    },
    serialize() {
      // Committed edits + the in-progress one (Save can land before the host blurs).
      const pending = new Map(edits);
      if (active && active.userEdited && active.el.innerHTML !== active.snapshot) {
        pending.set(active.path, active.el.innerHTML);
      }
      if (pending.size === 0 && formatEdits.size === 0) return null;
      return composed(pending);
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
  /** Story edit mode — gates the embeds' edit affordances (actions menus, number edit). */
  editable: boolean;
  onEditQuestion?: (req: StoryQuestionEditRequest) => void;
  onEditNumber?: (req: NumberQueryEditRequest) => void;
  onEditParamQuery?: (req: StoryParamQueryEditRequest) => void;
}

const StoryJsxEmbedContext = createContext<StoryJsxEmbedContextValue>({
  readOnly: true,
  values: {},
  setParamValue: () => {},
  editable: false,
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
  // Edit affordances need the write-back target: only a real AST path qualifies.
  const editPath = ctx.editable && typeof astPath === 'string' ? astPath : undefined;

  // Saved question by id — the `data-question-id` placeholder's equivalent.
  if (typeof props.id === 'number') {
    const questionId = props.id;
    const vizOverride = vizEnvelopeFromAttr(props.viz) ?? null;
    return (
      <div
        {...{ [AST_PATH_ATTR]: astPath }}
        aria-label="Question embed"
        className={EMBED_CARD_CLASSES}
        style={{ width: '100%', height: `${embedHeightPx(props.height, MIN_CHART_H, DEFAULT_CHART_H)}px` }}
      >
        <SmartEmbeddedQuestionContainer
          questionId={questionId}
          vizOverride={vizOverride}
          showTitle={true}
          readOnly={ctx.readOnly}
          showActionsMenu={ctx.editable}
          enableDrilldown={false}
          externalParameters={extParams}
          externalParamValues={extValues}
          onEdit={ctx.onEditQuestion && editPath ? () => ctx.onEditQuestion!({
            kind: 'saved', questionId, vizOverride, ref: { format: 'jsx', astPath: editPath },
          }) : undefined}
        />
      </div>
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
    <div
      {...{ [AST_PATH_ATTR]: astPath }}
      aria-label="Question embed"
      className={`relative ${bare ? EMBED_BARE_CLASSES : EMBED_CARD_CLASSES}`}
      style={{ width: '100%', height: `${h}px` }}
    >
      <EmbeddedQuestionContainer
        question={inlineEmbedToQuestionContent(embed)}
        questionId={0}
        externalParameters={extParams}
        externalParamValues={extValues}
        enableDrilldown={false}
        filePath={ctx.filePath}
      />
      {/* Same "Card actions" menu the saved cards get — inline cards have no title bar. */}
      {ctx.onEditQuestion && editPath && (
        <InlineCardActionsMenu
          onEdit={() => ctx.onEditQuestion!({ kind: 'inline', embed, ref: { format: 'jsx', astPath: editPath } })}
        />
      )}
    </div>
  );
}

/** `<Number id={N}|query={`…`} connection=… col=… prefix=… suffix=… style={…} />`. */
function NumberEmbedAdapter(props: Record<string, unknown>) {
  const ctx = useContext(StoryJsxEmbedContext);
  const embed = numberFromJsxAttrs(props);
  const astPath = props[AST_PATH_ATTR];
  if (!embed) return null;
  const extValues = ctx.externalParameters?.length ? ctx.values : undefined;
  // Jsx path: the edit request carries the AST path — the story view owns the source
  // write-back (updateNumberQueryInJsx), unlike the legacy path's DOM-attribute apply.
  const canEdit = ctx.editable && !!ctx.onEditNumber && !!embed.query && typeof astPath === 'string';
  // The stamped wrapper marks the COMPONENT BOUNDARY in the DOM (click-to-select ignores clicks
  // inside it; the innerHTML write-back splices it from the AST). display:contents = no layout box.
  return (
    <span {...{ [AST_PATH_ATTR]: astPath }} style={{ display: 'contents' }}>
      <InlineNumber
        embed={embed}
        externalParamValues={extValues}
        editable={ctx.editable}
        filePath={ctx.filePath}
        onRequestEdit={canEdit ? () => ctx.onEditNumber!({
          query: embed.query!,
          connection: embed.connection,
          astPath: astPath as string,
        }) : undefined}
      />
    </span>
  );
}

/** `<Param name=… label=… type=… nullable=… id={N} column=… widget=… min/max/step style/labelStyle />`. */
function ParamControlAdapter(props: Record<string, unknown>) {
  const ctx = useContext(StoryJsxEmbedContext);
  const param = paramFromJsxAttrs(props);
  if (!param) return null;
  const source = param.source && isStorySqlParamSource(param.source) ? param.source : undefined;
  const astPath = props[AST_PATH_ATTR];
  // Stamped component-boundary wrapper — see NumberEmbedAdapter.
  return (
    <span {...{ [AST_PATH_ATTR]: astPath }} style={{ display: 'contents' }}>
      <StoryParamControl
        param={param}
        value={ctx.values[param.name]}
        filePath={ctx.filePath}
        onRequestEdit={(ctx.editable && ctx.onEditParamQuery && source && typeof astPath === 'string')
          ? () => ctx.onEditParamQuery!({
              name: param.name,
              query: source.query,
              connection: source.connection,
              ref: { format: 'jsx', astPath },
            })
          : undefined}
        onChange={(v) => ctx.setParamValue(param.name, v)}
      />
    </span>
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

/** A breadcrumb destination: plain HTML, not a text host (focus owns those), never the root. */
function isSelectableFormatTarget(
  path: string,
  node: ReturnType<typeof resolveJsxNodeAtPath>,
): node is JsxElement {
  return !!node
    && node.type === 'element'
    && !node.isComponent
    && !isEditableTextHost(node)
    && path.includes('.');
}

/** Build the toolbar's ancestor hierarchy from the rendered DOM and validate it against source. */
function buildAncestorCrumbs(el: HTMLElement, parsedNodes: JsxNode[]): StoryAncestorCrumb[] {
  const out: StoryAncestorCrumb[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const path = p.getAttribute?.(AST_PATH_ATTR);
    if (!path) continue;
    const node = resolveJsxNodeAtPath(parsedNodes, path);
    if (isSelectableFormatTarget(path, node)) {
      out.push({ astPath: path, tag: node.tag, hint: crumbHint(p.className) });
    }
  }
  return out.reverse();
}

export default function StoryJsxBody({
  doc, jsx, readOnly, paramValues, onParamValuesChange, filePath, colorMode, editable, onChange,
  onEditQuestion, onEditNumber, onEditParamQuery, editApiRef, onTextHostFocusChange, onElementSelectChange,
}: StoryJsxBodyProps) {
  const parsed = useMemo(() => parseJsx(jsx), [jsx]);
  const parsedNodes = parsed.ok ? parsed.nodes : NO_NODES;

  // ── WYSIWYG edit session ─────────────────────────────────────────────────────────────────
  // One stable session per body; the latest source/callback are synced in (post-commit, before
  // any user event can fire) so handlers captured inside frozen, cached elements always commit
  // against the current props.
  const session = useMemo(() => createEditSession(), []);
  useEffect(() => {
    const reportTextHostFocus = onTextHostFocusChange
      ? (target: StoryTextHostTarget | null) => onTextHostFocusChange(
          target ? { ...target, ancestors: buildAncestorCrumbs(target.el, parsedNodes) } : null,
        )
      : undefined;
    session.setProps(jsx, onChange, reportTextHostFocus);
  }, [session, jsx, onChange, onTextHostFocusChange, parsedNodes]);

  // Breadcrumb navigation (toolbar crumbs) needs to re-anchor the selection from OUTSIDE the
  // effect closure — the effect publishes its select-by-path entry point into this slot
  // (closure-state-behind-methods, the same imperative-subsystem shape as the edit session).
  const selectByPath = useMemo(() => createSelectByPathSlot(), []);

  useEffect(() => {
    if (!editApiRef) return;
    editApiRef.current = {
      serialize: () => session.serialize(),
      applyFormatEdit: (astPath, edit) => session.applyFormatEdit(astPath, edit),
      selectElement: (astPath) => selectByPath.invoke(astPath),
    };
    return () => { editApiRef.current = null; };
  }, [editApiRef, session, selectByPath]);

  // ── Click-to-select format targets (Phase 2) ─────────────────────────────────────────────
  // ONE doc-level listener, classifying the clicked element against the SOURCE AST (never DOM
  // heuristics): plain non-text-host elements select; text hosts clear (focus owns them);
  // component chrome is ignored (interactive embeds must keep working); the ROOT (a top-level
  // path with no '.') is excluded — its gutter/cap is the page-level design contract.
  useEffect(() => {
    if (!editable || readOnly || !onElementSelectChange) return;
    let selected: HTMLElement | null = null;
    let hovered: HTMLElement | null = null;
    const clear = () => {
      if (!selected) return;
      selected.removeAttribute(SELECTED_DOM_ATTR);
      selected = null;
      onElementSelectChange(null);
    };
    const clearHover = () => {
      hovered?.removeAttribute(HOVER_DOM_ATTR);
      hovered = null;
    };
    const select = (path: string, el: HTMLElement) => {
      if (selected === el) return;
      selected?.removeAttribute(SELECTED_DOM_ATTR);
      selected = el;
      el.setAttribute(SELECTED_DOM_ATTR, '');
      onElementSelectChange({ astPath: path, el, ancestors: buildAncestorCrumbs(el, parsedNodes) });
    };
    /** The element a click at `target` would select, or null. */
    const resolveTarget = (target: HTMLElement | null): { path: string; el: HTMLElement } | 'embed' | null => {
      if (!target || typeof target.closest !== 'function') return null;
      if (target.closest('[contenteditable="true"]')) return null;
      const stamped = target.closest(`[${AST_PATH_ATTR}]`) as HTMLElement | null;
      if (!stamped) return null;
      const path = stamped.getAttribute(AST_PATH_ATTR) ?? '';
      const node = resolveJsxNodeAtPath(parsedNodes, path);
      if (node && node.type === 'element' && node.isComponent) return 'embed';
      return isSelectableFormatTarget(path, node) ? { path, el: stamped } : null;
    };
    const onClick = (e: Event) => {
      const hit = resolveTarget(e.target as HTMLElement | null);
      if (hit === 'embed') return; // interacting with an embed — leave any selection alone
      if (!hit) { clear(); return; }
      select(hit.path, hit.el);
    };
    // Hover preview: stamp exactly what a click would select, so nesting is visible BEFORE
    // committing. Cheap (closest + one AST resolve per move) — no throttle needed.
    const onMove = (e: Event) => {
      const hit = resolveTarget(e.target as HTMLElement | null);
      if (hit === 'embed' || !hit) { clearHover(); return; }
      if (hovered === hit.el) return;
      clearHover();
      hovered = hit.el;
      hovered.setAttribute(HOVER_DOM_ATTR, '');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    selectByPath.set((astPath: string) => {
      const el = doc.querySelector(`[${AST_PATH_ATTR}="${astPath}"]`);
      const node = resolveJsxNodeAtPath(parsedNodes, astPath);
      // NO instanceof: `el` belongs to the IFRAME realm, whose HTMLElement is a different
      // constructor — a parent-realm instanceof is always false for it. querySelector already
      // guarantees an Element; the AST predicate guarantees it's a plain HTML tag.
      if (el && isSelectableFormatTarget(astPath, node)) select(astPath, el as HTMLElement);
    });
    doc.addEventListener('click', onClick);
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('keydown', onKeyDown);
      selectByPath.set(() => {});
      clearHover();
      clear();
    };
  }, [editable, readOnly, onElementSelectChange, doc, parsedNodes, selectByPath]);

  // Text hosts get contenteditable + the render-during-edit freeze; everything else is locked
  // by default (only decorated hosts ever carry contentEditable under the interpreter).
  const decorateElement = editable
    ? (element: ReactElement, node: JsxElement, path: string) =>
        isEditableTextHost(node)
          ? <EditableTextHost key={path} path={path} session={session}>{element as ReactElement<Record<string, unknown>>}</EditableTextHost>
          : element
    : undefined;
  const nodes = parsedNodes;
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
    editable: !!editable && !readOnly,
    onEditQuestion,
    onEditNumber,
    onEditParamQuery,
  };

  if (!parsed.ok) {
    // Read path stays graceful on a bad body (save-time validation is the real gate).
    return <div aria-label="Story parse error" style={{ display: 'none' }}>{parsed.error}</div>;
  }

  return (
    <StoryEmbedProviders doc={doc} colorMode={colorMode}>
      <StoryJsxEmbedContext.Provider value={ctx}>
        <TooltipProvider portalled={false}>
          {renderStoryNodes(nodes, { components: STORY_JSX_REGISTRY, decorateElement })}
        </TooltipProvider>
      </StoryJsxEmbedContext.Provider>
    </StoryEmbedProviders>
  );
}
