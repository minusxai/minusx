'use client';

/**
 * MetricNode — an INLINE Lexical DecoratorNode representing a named metric:
 * a `name`, an optional one-line `description`, and an optional `sql` definition.
 *
 * It renders as a compact chip in the same visual language as the @ mention
 * chips, flowing inside the sentence, with the description and truncated SQL
 * visible. Clicking the chip (in edit mode) opens an inline popover editor
 * anchored to it. A freshly inserted (unnamed) metric auto-opens its editor.
 *
 * Docs are stored as markdown, so a metric round-trips as `:metric` + flat
 * JSON — the same chip grammar as mentions (see metric-transformer.ts):
 *
 *     :metric{"name":"Monthly Revenue","description":"Revenue per month","sql":"SELECT ..."}
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DecoratorNode,
  $getNodeByKey,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LuCode, LuPencil, LuSquareFunction } from 'react-icons/lu';
import { Button } from '@/components/kit/button';
import { Input } from '@/components/kit/input';

export interface MetricData {
  name: string;
  description?: string;
  sql?: string;
}

export type SerializedMetricNode = Spread<{ metricData: MetricData }, SerializedLexicalNode>;

// The metric accent (Green Sea teal — same value as ACCENT_HEX.teal).
const TEAL = '#16a085';
const MONO = 'var(--font-jetbrains-mono), monospace';

/** Inline icon sizing that matches the old Chakra `boxSize="0.85em"` chips. */
const inlineIconStyle = (size: string, valign: string): React.CSSProperties => ({
  display: 'inline',
  width: size,
  height: size,
  verticalAlign: valign,
});

/**
 * Inline chip, styled exactly like the @ mention chips (muted pill, mono,
 * colored icon) so a metric reads as a peer of a table/column mention and
 * flows inside the sentence. Description and SQL stay visible but truncated;
 * full values are one hover (title) or click (editor) away.
 */
function MetricSummary({ data, editable = false, active = false }: { data: MetricData; editable?: boolean; active?: boolean }) {
  const hasDetails = Boolean(data.description || data.sql);
  const compactSql = data.sql?.replace(/\s+/g, ' ').trim();

  const truncateStyle: React.CSSProperties = {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    display: 'inline-block',
    verticalAlign: 'bottom',
    maxWidth: '18em',
  };

  return (
    <span
      aria-label={`Metric ${data.name || 'untitled'}`}
      className={`mx-[1px] inline rounded-sm px-[4px] py-[2px] text-[0.85em] font-semibold text-foreground transition-colors duration-100 ${
        active ? 'bg-[color-mix(in_srgb,#16a085_15%,transparent)]' : 'bg-muted'
      } ${editable ? 'cursor-pointer hover:bg-[color-mix(in_srgb,#16a085_15%,transparent)]' : 'cursor-default'}`}
      style={{ fontFamily: MONO, lineHeight: 'inherit' }}
    >
      <span style={{ color: TEAL }}>
        <LuSquareFunction style={inlineIconStyle('0.85em', '-0.1em')} />
      </span>
      {' '}
      <span className="font-bold">
        {data.name || 'Untitled metric'}
      </span>
      {/* Full description — it's the human meaning of the metric; only the SQL truncates. */}
      {data.description && (
        <span className="font-medium text-muted-foreground">
          {' '}· {data.description}
        </span>
      )}
      {!hasDetails && editable && (
        <span className="font-medium text-muted-foreground">
          {' '}· add a definition or SQL
        </span>
      )}
      {/* SQL bracketed off from the prose, truncated with the full query on hover. */}
      {compactSql && (
        <>
          {' '}
          <span className="font-semibold text-muted-foreground">(</span>
          <span className="text-[0.85em] font-bold tracking-[0.05em]" style={{ color: TEAL }}>
            <LuCode style={inlineIconStyle('0.9em', '-0.1em')} /> SQL
          </span>
          {' '}
          <span className="font-medium text-muted-foreground" title={data.sql} style={truncateStyle}>
            {compactSql}
          </span>
          <span className="font-semibold text-muted-foreground">)</span>
        </>
      )}
      {editable && (
        <span className="text-muted-foreground">
          {' '}<LuPencil aria-label="Edit metric" style={inlineIconStyle('0.75em', '-0.05em')} />
        </span>
      )}
    </span>
  );
}

function MetricCard({ nodeKey, data, editable }: { nodeKey: NodeKey; data: MetricData; editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(data.name);
  const [description, setDescription] = useState(data.description ?? '');
  const [sql, setSql] = useState(data.sql ?? '');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // A freshly inserted (unnamed) metric opens its editor immediately.
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    if (editable && !data.name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [editable, data.name]);

  // Hand focus to the Name input whenever the editor opens. Both Lexical
  // (after $insertNodes) and the popover's own focus management can grab focus
  // late — without this, typing silently lands in the document behind the
  // popover. Retry briefly until the input actually holds focus.
  useEffect(() => {
    if (!open) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const claim = () => {
      const el = nameInputRef.current;
      if (el && document.activeElement !== el) el.focus();
      if (nameInputRef.current && document.activeElement !== nameInputRef.current && ++tries < 8) {
        timer = setTimeout(claim, 40);
      }
    };
    timer = setTimeout(claim, 0);
    return () => clearTimeout(timer);
  }, [open]);

  const openEditor = () => {
    setName(data.name);
    setDescription(data.description ?? '');
    setSql(data.sql ?? '');
    setOpen(true);
  };

  const save = () => {
    if (!name.trim()) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMetricNode(node)) {
        node.setMetricData({
          name: name.trim(),
          description: description.trim() || undefined,
          sql: sql.trim() || undefined,
        });
      }
    });
    setOpen(false);
  };

  const cancel = () => {
    // Discard a metric that was never given a name (a bare insert).
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMetricNode(node) && !node.getMetricData().name) node.remove();
    });
    setOpen(false);
  };

  if (!editable) return <MetricSummary data={data} />;

  return (
    <>
      <span
        ref={triggerRef}
        className="inline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16a085]"
        onClick={() => { if (!open) openEditor(); }}
      >
        <MetricSummary data={data} editable active={open} />
      </span>
      {/* Inline popover editor — portaled to <body> (fixed-position; carries its
          own theme host so the Tailwind tokens resolve outside the app shell),
          anchored bottom-start to the chip. Outside click / Escape cancels. */}
      {open && createPortal(
        <div data-mx-theme-host="">
          <div className="fixed inset-0 z-[1400]" onClick={cancel} />
          <div
            className="z-[1401] w-[440px] max-w-[calc(100vw-24px)] rounded-lg bg-popover shadow-lg"
            style={{ border: `1px solid color-mix(in srgb, ${TEAL} 35%, transparent)` }}
            ref={(el: HTMLDivElement | null) => {
              if (!el) return;
              const anchor = triggerRef.current;
              if (!anchor) return;
              const rect = anchor.getBoundingClientRect();
              el.style.position = 'fixed';
              el.style.top = `${rect.bottom + 4}px`;
              el.style.left = `${Math.max(8, rect.left)}px`;
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }}
          >
            <div className="p-3">
              <div className="flex flex-col items-stretch gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-foreground">Name <span className="text-destructive">*</span></label>
                  <Input ref={nameInputRef} aria-label="Metric name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Monthly Revenue" autoFocus className="h-8" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-foreground">Description</label>
                  <Input aria-label="Metric description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line summary (optional)" className="h-8" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-foreground">SQL (optional)</label>
                  <textarea
                    aria-label="Metric SQL"
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    placeholder="SELECT ..."
                    rows={5}
                    className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    style={{ fontFamily: MONO }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="outline" onClick={cancel}>Cancel</Button>
                  <Button size="xs" className="text-white hover:opacity-90" style={{ background: TEAL }} onClick={save} disabled={!name.trim()}>Save metric</Button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export class MetricNode extends DecoratorNode<React.ReactElement> {
  __metricData: MetricData;

  static getType(): string {
    return 'metric';
  }

  static clone(node: MetricNode): MetricNode {
    return new MetricNode(node.__metricData, node.__key);
  }

  constructor(metricData: MetricData, key?: NodeKey) {
    super(key);
    this.__metricData = metricData;
  }

  static importJSON(serializedNode: SerializedMetricNode): MetricNode {
    return new MetricNode(serializedNode.metricData);
  }

  exportJSON(): SerializedMetricNode {
    return {
      ...super.exportJSON(),
      type: 'metric',
      version: 1,
      metricData: this.__metricData,
    };
  }

  /**
   * INLINE, like a mention chip — the metric flows inside a sentence and text
   * can be written around it. Safe for persistence because the text-match
   * METRIC_INLINE transformer serializes inline nodes (a block-form-only
   * transformer would drop an inline node on export — the historical
   * vanishing-metric bug).
   */
  isInline(): true {
    return true;
  }

  getMetricData(): MetricData {
    return this.__metricData;
  }

  setMetricData(data: MetricData): void {
    const writable = this.getWritable();
    writable.__metricData = data;
  }

  createDOM(config: EditorConfig): HTMLElement {
    // Span, not div — the node is inline and lives inside <p> paragraphs.
    const span = document.createElement('span');
    const className = config.theme.metric;
    if (className) span.className = className;
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(_editor: LexicalEditor, config: EditorConfig): React.ReactElement {
    return <MetricCard nodeKey={this.getKey()} data={this.__metricData} editable={config.namespace !== 'TextBlockViewer'} />;
  }
}

export function $createMetricNode(metricData: MetricData): MetricNode {
  return new MetricNode(metricData);
}

export function $isMetricNode(node: LexicalNode | null | undefined): node is MetricNode {
  return node instanceof MetricNode;
}
