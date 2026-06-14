'use client';

/**
 * MetricNode — a block-level Lexical DecoratorNode representing a named metric:
 * a `name`, an optional one-line `description`, and an optional `sql` definition.
 *
 * It renders as a compact "ƒ name" badge. Clicking the badge (in edit mode) opens
 * an inline popover editor anchored to it — there is no separate edit mode. A
 * freshly inserted (unnamed) metric auto-opens its editor.
 *
 * Docs are stored as markdown, so a metric round-trips through a fenced directive
 * block (see metric-transformer.ts):
 *
 *     :::metric{name="Monthly Revenue" description="Revenue per month"}
 *     SELECT date_trunc('month', created_at) AS month, sum(amount) AS revenue
 *     FROM orders GROUP BY 1
 *     :::
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
import { LuSquareFunction } from 'react-icons/lu';

export interface MetricData {
  name: string;
  description?: string;
  sql?: string;
}

export type SerializedMetricNode = Spread<{ metricData: MetricData }, SerializedLexicalNode>;

function MetricBadge({ data, onClick }: { data: MetricData; onClick?: () => void }) {
  return (
    <Box
      as="span"
      aria-label={`Metric ${data.name || 'untitled'}`}
      display="inline-flex"
      alignItems="center"
      gap={1.5}
      px={2}
      py={1}
      bg="bg.muted"
      border="1px solid"
      borderColor="border.default"
      borderRadius="md"
      fontSize="0.9em"
      fontWeight="600"
      cursor={onClick ? 'pointer' : 'default'}
      _hover={onClick ? { bg: 'bg.emphasized', borderColor: 'accent.cyan' } : undefined}
      onClick={onClick}
    >
      <Icon as={LuSquareFunction} boxSize="1.1em" color="accent.cyan" />
      {data.name || 'Untitled metric'}
    </Box>
  );
}

function MetricCard({ nodeKey, data, editable }: { nodeKey: NodeKey; data: MetricData; editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(data.name);
  const [description, setDescription] = useState(data.description ?? '');
  const [sql, setSql] = useState(data.sql ?? '');

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

  if (!editable) return <MetricBadge data={data} />;

  return (
    <Popover.Root open={open} onOpenChange={(e: { open: boolean }) => { if (!e.open) cancel(); }} positioning={{ placement: 'bottom-start' }}>
      <Popover.Trigger asChild>
        <Box as="span" display="inline-flex">
          <MetricBadge data={data} onClick={openEditor} />
        </Box>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="400px" bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted" boxShadow="lg">
            <Popover.Body p={3}>
              <VStack gap={3} align="stretch">
                <Field.Root required>
                  <Field.Label>Name</Field.Label>
                  <Input aria-label="Metric name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Monthly Revenue" autoFocus size="sm" />
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
                  <Button size="xs" bg="accent.cyan" color="white" onClick={save} disabled={!name.trim()}>Save</Button>
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

  getMetricData(): MetricData {
    return this.__metricData;
  }

  setMetricData(data: MetricData): void {
    const writable = this.getWritable();
    writable.__metricData = data;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement('div');
    const className = config.theme.metric;
    if (className) div.className = className;
    return div;
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
