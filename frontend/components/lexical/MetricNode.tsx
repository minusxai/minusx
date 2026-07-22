'use client';

/**
 * MetricNode — a block-level Lexical DecoratorNode representing a named metric:
 * a `name`, an optional one-line `description`, and an optional `sql` definition.
 *
 * It renders as a compact definition block with the description and SQL visible.
 * Clicking the block (in edit mode) opens an inline popover editor anchored to it. A
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
import { Box, HStack, VStack, Icon, Button, Input, Text, Textarea, Field, Popover, Portal } from '@chakra-ui/react';
import { LuCode, LuPencil, LuSquareFunction } from 'react-icons/lu';

export interface MetricData {
  name: string;
  description?: string;
  sql?: string;
}

export type SerializedMetricNode = Spread<{ metricData: MetricData }, SerializedLexicalNode>;

function MetricSummary({ data, editable = false, active = false }: { data: MetricData; editable?: boolean; active?: boolean }) {
  const hasDetails = Boolean(data.description || data.sql);

  return (
    <Box
      as="section"
      aria-label={`Metric ${data.name || 'untitled'}`}
      width="100%"
      maxW="720px"
      px={3}
      py={2.5}
      bg={active ? 'accent.teal/15' : 'accent.teal/10'}
      border="1px solid"
      borderColor={active ? 'accent.teal' : 'accent.teal/40'}
      borderLeftWidth="3px"
      borderLeftColor="accent.teal"
      borderRadius="lg"
      color="fg.default"
      textAlign="left"
      cursor={editable ? 'pointer' : 'default'}
      boxShadow={active ? 'sm' : 'none'}
      transition="background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease"
      _hover={editable ? { bg: 'accent.teal/15', borderColor: 'accent.teal', boxShadow: 'sm', transform: 'translateY(-1px)' } : undefined}
    >
      <HStack justify="space-between" align="center" gap={3}>
        <HStack gap={2.5} minW={0}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxSize="30px"
            flexShrink={0}
            bg="accent.teal"
            borderRadius="md"
            color="white"
          >
            <Icon as={LuSquareFunction} boxSize={4} />
          </Box>
          <Box minW={0}>
            <Text
              fontSize="2xs"
              fontWeight="700"
              lineHeight="1.2"
              letterSpacing="0.1em"
              textTransform="uppercase"
              color="accent.teal"
            >
              Metric
            </Text>
            <Text fontSize="sm" fontWeight="700" lineHeight="1.4" truncate>
              {data.name || 'Untitled metric'}
            </Text>
          </Box>
        </HStack>

        {editable && (
          <HStack gap={1} flexShrink={0} color="fg.subtle" fontSize="xs" fontWeight="600">
            <Icon as={LuPencil} boxSize={3} />
            <Text>Edit</Text>
          </HStack>
        )}
      </HStack>

      {data.description && (
        <Box mt={2}>
          <Text fontSize="2xs" fontWeight="700" lineHeight="1.3" letterSpacing="0.08em" textTransform="uppercase" color="accent.teal">
            Definition
          </Text>
          <Text mt={0.5} fontSize="sm" lineHeight="1.55" color="fg.muted">
            {data.description}
          </Text>
        </Box>
      )}

      {!hasDetails && editable && (
        <Text mt={2} fontSize="xs" lineHeight="1.5" color="fg.subtle">
          Add a definition or SQL so this metric is unambiguous.
        </Text>
      )}

      {data.sql && (
        <Box mt={2.5} bg="bg.surface" border="1px solid" borderColor="accent.teal/25" borderRadius="md" overflow="hidden">
          <HStack gap={1.5} px={2.5} py={1.5} bg="accent.teal/10" borderBottom="1px solid" borderColor="accent.teal/20">
            <Icon as={LuCode} boxSize={3} color="accent.teal" />
            <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="accent.teal">
              SQL definition
            </Text>
          </HStack>
          <Box
            as="pre"
            m={0}
            px={2.5}
            py={2}
            maxH="120px"
            overflow="auto"
            whiteSpace="pre-wrap"
            overflowWrap="anywhere"
            fontFamily="mono"
            fontSize="xs"
            lineHeight="1.55"
            color="fg.default"
          >
            {data.sql}
          </Box>
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

  if (!editable) return <MetricSummary data={data} />;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e: { open: boolean }) => { if (e.open) openEditor(); else cancel(); }}
      positioning={{ placement: 'bottom-start' }}
    >
      <Popover.Trigger asChild>
        <Box
          width="100%"
          maxW="720px"
          _focusVisible={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '2px', borderRadius: 'lg' }}
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
