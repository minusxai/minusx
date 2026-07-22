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
 * Docs are stored as markdown, so a metric round-trips through a single-line
 * inline directive (see metric-transformer.ts; newlines in SQL escaped as \n):
 *
 *     :metric{name="Monthly Revenue" description="Revenue per month" sql="SELECT ..."}
 */

import React, { useState, useEffect, useRef } from 'react';
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
import { Box, HStack, VStack, Icon, Button, Input, Textarea, Field, Popover, Portal } from '@chakra-ui/react';
import { LuCode, LuPencil, LuSquareFunction } from 'react-icons/lu';

export interface MetricData {
  name: string;
  description?: string;
  sql?: string;
}

export type SerializedMetricNode = Spread<{ metricData: MetricData }, SerializedLexicalNode>;

/**
 * Inline chip, styled exactly like the @ mention chips (bg.muted pill, mono,
 * colored icon) so a metric reads as a peer of a table/column mention and
 * flows inside the sentence. Description and SQL stay visible but truncated;
 * full values are one hover (title) or click (editor) away.
 */
function MetricSummary({ data, editable = false, active = false }: { data: MetricData; editable?: boolean; active?: boolean }) {
  const hasDetails = Boolean(data.description || data.sql);
  const compactSql = data.sql?.replace(/\s+/g, ' ').trim();

  const truncateCss = {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    display: 'inline-block',
    verticalAlign: 'bottom',
  } as const;

  return (
    <Box
      as="span"
      aria-label={`Metric ${data.name || 'untitled'}`}
      display="inline"
      px="4px"
      py="2px"
      mx="1px"
      bg={active ? 'accent.teal/15' : 'bg.muted'}
      borderRadius="sm"
      fontSize="0.85em"
      fontFamily="mono"
      lineHeight="inherit"
      color="fg.default"
      fontWeight="600"
      cursor={editable ? 'pointer' : 'default'}
      transition="background-color 120ms ease"
      _hover={editable ? { bg: 'accent.teal/15' } : undefined}
    >
      <Box as="span" color="accent.teal">
        <Icon as={LuSquareFunction} boxSize="0.85em" verticalAlign="-0.1em" />
      </Box>
      {' '}
      <Box as="span" fontWeight="700">
        {data.name || 'Untitled metric'}
      </Box>
      {/* Full description — it's the human meaning of the metric; only the SQL truncates. */}
      {data.description && (
        <Box as="span" color="fg.muted" fontWeight="500">
          {' '}· {data.description}
        </Box>
      )}
      {!hasDetails && editable && (
        <Box as="span" color="fg.subtle" fontWeight="500">
          {' '}· add a definition or SQL
        </Box>
      )}
      {/* SQL bracketed off from the prose, truncated with the full query on hover. */}
      {compactSql && (
        <>
          {' '}
          <Box as="span" color="fg.subtle" fontWeight="600">(</Box>
          <Box as="span" color="accent.teal" fontWeight="700" fontSize="0.85em" letterSpacing="0.05em">
            <Icon as={LuCode} boxSize="0.9em" verticalAlign="-0.1em" /> SQL
          </Box>
          {' '}
          <Box as="span" color="fg.muted" fontWeight="500" maxW="18em" title={data.sql} css={truncateCss}>
            {compactSql}
          </Box>
          <Box as="span" color="fg.subtle" fontWeight="600">)</Box>
        </>
      )}
      {editable && (
        <Box as="span" color="fg.subtle">
          {' '}<Icon aria-label="Edit metric" as={LuPencil} boxSize="0.75em" verticalAlign="-0.05em" />
        </Box>
      )}
    </Box>
  );
}

function MetricCard({ nodeKey, data, editable }: { nodeKey: NodeKey; data: MetricData; editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(data.name);
  const [description, setDescription] = useState(data.description ?? '');
  const [sql, setSql] = useState(data.sql ?? '');
  const nameInputRef = useRef<HTMLInputElement>(null);

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
    <Popover.Root
      open={open}
      onOpenChange={(e: { open: boolean }) => { if (e.open) openEditor(); else cancel(); }}
      positioning={{ placement: 'bottom-start' }}
      initialFocusEl={() => nameInputRef.current}
    >
      <Popover.Trigger asChild>
        <Box
          as="span"
          display="inline"
          _focusVisible={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '2px', borderRadius: 'sm' }}
        >
          <MetricSummary data={data} editable active={open} />
        </Box>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="440px" maxW="calc(100vw - 24px)" bg="bg.surface" borderRadius="lg" border="1px solid" borderColor="accent.teal/35" boxShadow="lg">
            <Popover.Body p={3}>
              <VStack gap={3} align="stretch">
                <Field.Root required>
                  <Field.Label>Name</Field.Label>
                  <Input ref={nameInputRef} aria-label="Metric name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Monthly Revenue" autoFocus size="sm" />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input aria-label="Metric description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line summary (optional)" size="sm" />
                </Field.Root>
                <Field.Root>
                  <Field.Label>SQL (optional)</Field.Label>
                  <Textarea
                    aria-label="Metric SQL"
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    placeholder="SELECT ..."
                    rows={5}
                    fontFamily="var(--font-jetbrains-mono), monospace"
                    fontSize="xs"
                  />
                </Field.Root>
                <HStack justify="flex-end" gap={2}>
                  <Button size="xs" variant="outline" onClick={cancel}>Cancel</Button>
                  <Button size="xs" bg="accent.teal" color="white" _hover={{ opacity: 0.9 }} onClick={save} disabled={!name.trim()}>Save metric</Button>
                </HStack>
              </VStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
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
