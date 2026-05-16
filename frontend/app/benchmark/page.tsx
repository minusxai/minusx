'use client';

import { useState, useCallback, useMemo } from 'react';
import { Box, Text, VStack, HStack, Flex, Icon, Spinner } from '@chakra-ui/react';
import { LuClock, LuCoins, LuCpu, LuHash, LuWrench, LuUpload, LuFileText, LuMessageSquare, LuActivity, LuSearch, LuMessageCircle, LuArrowLeft, LuCheck, LuX, LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import { TableV2 } from '@/components/plotx';
import { Button } from '@chakra-ui/react';
import { parseLogToMessages } from '@/lib/conversations-utils';
import { piLogToLegacy } from '@/lib/chat-translator';
import { importBenchmarkConversation } from '@/lib/benchmark/import-conversation';
import type { ConversationLog } from '@/orchestrator/types';
import type { BenchmarkConnectionEntry } from '@/agents/benchmark-analyst/connection-source';
import { groupIntoTurns } from '@/components/explore/message/groupIntoTurns';
import AgentTurnContainer from '@/components/explore/AgentTurnContainer';
import ToolDebugBar from '@/components/explore/ToolDebugBar';
import { immutableSet } from '@/lib/utils/immutable-collections';
import Markdown from '@/components/Markdown';
import ExecutionTree from '@/components/explore/ExecutionTree';
import type { ConversationLogEntry } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────

interface EvalResult {
  pass: boolean;
  reason: string;
  /** % of runs that did NOT pass (0..100). For single-run rows this is
   *  redundant with `pass` (0 or 100); for DAB_TIMES_RUN>1 rows it
   *  surfaces flakiness directly. Populated by mxscripts/eval_output.py. */
  failure_rate?: number;
  /** Index of the run within a multi-run batch (0-based). */
  run_idx?: number;
}

interface BenchmarkRow {
  input_index?: number;
  input: { user_message: string; allowed_connections: string[] };
  log: unknown[];
  duration_ms: number;
  error?: string;
  eval?: EvalResult;
  connections?: BenchmarkConnectionEntry[];
  benchmark?: string;
  git_commit?: string;
}

type ParsedFile =
  | { kind: 'conversation'; log: ConversationLogEntry[] }
  | { kind: 'benchmark'; rows: BenchmarkRow[]; embeddedConnections?: BenchmarkConnectionEntry[] };

interface RunStats {
  duration_ms: number;
  totalCost: number;
  totalTokens: number;
  llmCalls: number;
  toolCalls: number;
  maxToolMs: number;
  maxToolName: string | null;
  error?: string;
}

// ── Parsing ───────────────────────────────────────────────────────────────

function isProductionLog(log: unknown[]): log is ConversationLogEntry[] {
  return log.length > 0 && typeof (log[0] as any)?._type === 'string';
}

function tryParseConnections(text: string): BenchmarkConnectionEntry[] | null {
  try {
    const obj = JSON.parse(text);
    if (!Array.isArray(obj) || obj.length === 0) return null;
    const looksLikeEntry = obj.every((e: unknown) => {
      const r = e as { name?: unknown; dialect?: unknown; config?: unknown };
      return typeof r.name === 'string'
        && typeof r.dialect === 'string'
        && typeof r.config === 'object'
        && r.config !== null;
    });
    return looksLikeEntry ? (obj as BenchmarkConnectionEntry[]) : null;
  } catch {
    return null;
  }
}

function parseUploadedFile(text: string): ParsedFile {
  try {
    const obj = JSON.parse(text);
    if (obj.log && Array.isArray(obj.log)) {
      if (isProductionLog(obj.log)) {
        return { kind: 'conversation', log: obj.log };
      }
      return { kind: 'conversation', log: piLogToLegacy(obj.log as ConversationLog) };
    }
  } catch {
    // Not a single JSON object — try JSONL
  }
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const rows: BenchmarkRow[] = lines.map(line => JSON.parse(line) as BenchmarkRow);
  const embeddedConnections = rows.find(r => r.connections?.length)?.connections;
  return { kind: 'benchmark', rows, embeddedConnections };
}

function extractAnswer(row: BenchmarkRow): string {
  let lastText = '';
  for (const entry of row.log as any[]) {
    if (entry.role === 'assistant') {
      for (const c of entry.content ?? []) {
        if (c?.type === 'text' && c.text) lastText = c.text;
      }
    }
  }
  return lastText;
}

// ── Stats ─────────────────────────────────────────────────────────────────

function extractStats(row: BenchmarkRow): RunStats {
  let totalCost = 0, totalTokens = 0, llmCalls = 0, toolCalls = 0;
  let maxToolMs = 0;
  let maxToolName: string | null = null;
  // toolCallId -> timestamp of the assistant message that emitted it
  const assistantTsByToolCallId = new Map<string, number>();
  // Track min/max timestamps to compute execution span
  let minTs = Infinity, maxTs = -Infinity;

  for (const entry of row.log as any[]) {
    // Track timestamps for execution span
    if (entry.timestamp && typeof entry.timestamp === 'number') {
      if (entry.timestamp < minTs) minTs = entry.timestamp;
      if (entry.timestamp > maxTs) maxTs = entry.timestamp;
    }

    if (entry.role === 'assistant') {
      if (entry.usage) {
        llmCalls++;
        totalTokens += entry.usage.totalTokens ?? 0;
        totalCost += entry.usage.cost?.total ?? 0;
      }
      for (const c of entry.content ?? []) {
        if (c?.type === 'toolCall' && c.id) {
          assistantTsByToolCallId.set(c.id, entry.timestamp ?? 0);
        }
      }
    }
    if (entry.role === 'toolResult') {
      // Count actual tool calls (exclude agent completions and meta-tools)
      const tn = entry.toolName ?? '';
      if (!tn.includes('Agent') && tn !== 'TalkToUser' && tn !== 'CheckEquivalence') {
        toolCalls++;
      }
      const start = assistantTsByToolCallId.get(entry.toolCallId);
      if (start && entry.timestamp) {
        const dur = entry.timestamp - start;
        if (dur > maxToolMs) {
          maxToolMs = dur;
          maxToolName = entry.toolName ?? null;
        }
      }
    }
    if (entry._type === 'task_debug' && entry.llmDebug) {
      for (const call of entry.llmDebug) {
        llmCalls++;
        totalTokens += (call.total_tokens ?? call.totalTokens ?? 0);
        totalCost += (call.cost?.total ?? 0);
      }
    }
    if (entry._type === 'task_result') toolCalls++;
  }
  // Use execution span from timestamps if available, fall back to runner's duration_ms
  const executionMs = (minTs < Infinity && maxTs > -Infinity) ? (maxTs - minTs) : row.duration_ms;
  return { duration_ms: executionMs, totalCost, totalTokens, llmCalls, toolCalls, maxToolMs, maxToolName, error: row.error };
}

function aggregateStats(rows: BenchmarkRow[]): { total: RunStats; perRow: RunStats[] } {
  const perRow = rows.map(extractStats);
  // For the "total" summary, surface the worst single tool call across the
  // whole run — not a sum, since durations of parallel tool calls overlap
  // and summing distorts the picture.
  let maxToolMs = 0;
  let maxToolName: string | null = null;
  for (const r of perRow) {
    if (r.maxToolMs > maxToolMs) {
      maxToolMs = r.maxToolMs;
      maxToolName = r.maxToolName;
    }
  }
  const total: RunStats = {
    duration_ms: perRow.reduce((s, r) => s + r.duration_ms, 0),
    totalCost: perRow.reduce((s, r) => s + r.totalCost, 0),
    totalTokens: perRow.reduce((s, r) => s + r.totalTokens, 0),
    llmCalls: perRow.reduce((s, r) => s + r.llmCalls, 0),
    toolCalls: perRow.reduce((s, r) => s + r.toolCalls, 0),
    maxToolMs,
    maxToolName,
  };
  return { total, perRow };
}

function formatCost(cost: number): string {
  return cost > 0 ? `$${cost.toFixed(4)}` : '-';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Stat display components ───────────────────────────────────────────────

// ── Conversation viewer ───────────────────────────────────────────────────

function LogViewer({ log, piLog }: { log: ConversationLogEntry[]; piLog?: unknown[] }) {
  const [showThinking, setShowThinking] = useState(false);
  const messages = parseLogToMessages(log);
  const turns = groupIntoTurns(messages);

  if (turns.length === 0) {
    return (
      <Flex align="center" justify="center" py={16} color="fg.muted">
        <Text>No messages in this log.</Text>
      </Flex>
    );
  }

  const hasExecutionTree = !!piLog;

  return (
    <VStack gap={0} align="stretch" width="100%">
      {piLog && <ExecutionTree piLog={piLog} messages={messages} />}
      {!hasExecutionTree && <ToolDebugBar messages={messages} />}
      {turns.map((turn, i) => (
        <AgentTurnContainer
          key={i}
          turn={turn}
          isCompact={false}
          databaseName=""
          showThinking={showThinking}
          toggleShowThinking={() => setShowThinking(v => !v)}
          markdownContext="mainpage"
          readOnly={true}
        />
      ))}
    </VStack>
  );
}

// ── Upload screen ─────────────────────────────────────────────────────────

function FeatureChip({ icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <HStack
      gap={1.5}
      px={3}
      py={1.5}
      borderRadius="full"
      bg="bg.surface"
      border="1px solid"
      borderColor="border.muted"
      transition="all 0.2s"
      _hover={{ borderColor: 'accent.teal', bg: 'accent.teal/5' }}
    >
      <Icon as={icon} boxSize="3" color="accent.cyan" />
      <Text fontSize="2xs" fontWeight="medium" color="fg.muted" fontFamily="mono">{label}</Text>
    </HStack>
  );
}

function UploadScreen({ onDrop, onInputChange }: {
  onDrop: (e: React.DragEvent) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <Flex
      align="center"
      justify="center"
      minH="calc(100vh - 120px)"
      className="bm-upload-grid-bg"
      position="relative"
    >
      {/* Ambient glow */}
      <Box
        position="absolute"
        top="20%"
        left="50%"
        transform="translateX(-50%)"
        w="500px"
        h="300px"
        bg="radial-gradient(ellipse, rgba(22, 160, 133, 0.06) 0%, transparent 70%)"
        pointerEvents="none"
        animation="bm-pulse-glow 6s ease-in-out infinite"
      />

      <VStack gap={8} maxW="520px" textAlign="center" position="relative">
        {/* Title block */}
        <VStack gap={3} className="bm-stagger-1">
          <HStack gap={2} align="center">
            <Box w="8px" h="1.5px" bg="accent.teal" borderRadius="full" />
            <Text
              fontSize="2xs"
              fontWeight="semibold"
              fontFamily="mono"
              color="accent.teal"
              textTransform="uppercase"
              letterSpacing="0.15em"
            >
              benchmark inspector
            </Text>
            <Box w="8px" h="1.5px" bg="accent.teal" borderRadius="full" />
          </HStack>
          <Text
            fontSize="2xl"
            fontWeight="bold"
            letterSpacing="-0.03em"
            lineHeight="1.2"
          >
            Log Viewer
          </Text>
          <Text fontSize="sm" color="fg.muted" maxW="380px" lineHeight="1.6">
            Inspect agent runs, trace tool calls, and analyze benchmark results
          </Text>
        </VStack>

        {/* Drop zone with animated border */}
        <Box
          className={`bm-drop-zone bm-stagger-2`}
          w="100%"
          cursor="pointer"
          transition="all 0.25s ease"
          onDrop={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); onDrop(e); }}
          onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => document.getElementById('benchmark-file-input')?.click()}
          transform={isDragging ? 'scale(1.02)' : 'scale(1)'}
        >
          <Box
            position="relative"
            zIndex={1}
            bg={isDragging ? 'accent.teal/5' : 'bg.surface'}
            borderRadius="16px"
            px={8}
            py={10}
            transition="all 0.25s ease"
          >
            <input
              id="benchmark-file-input"
              type="file"
              accept=".json,.jsonl"
              onChange={onInputChange}
              style={{ display: 'none' }}
            />
            <VStack gap={4}>
              <Box
                p={3}
                borderRadius="xl"
                bg="accent.teal/8"
                transition="all 0.25s"
              >
                <Icon
                  as={LuUpload}
                  boxSize="6"
                  color="accent.teal"
                  transition="transform 0.25s"
                  transform={isDragging ? 'translateY(-2px)' : 'translateY(0)'}
                />
              </Box>
              <VStack gap={1}>
                <Text fontSize="sm" fontWeight="semibold" color="fg.default">
                  {isDragging ? 'Drop to inspect' : 'Drop file or click to browse'}
                </Text>
                <HStack gap={1.5} justify="center">
                  <Box px={2} py={0.5} borderRadius="md" bg="bg.muted">
                    <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">.json</Text>
                  </Box>
                  <Box px={2} py={0.5} borderRadius="md" bg="bg.muted">
                    <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">.jsonl</Text>
                  </Box>
                </HStack>
              </VStack>
            </VStack>
          </Box>
        </Box>

        {/* Feature chips */}
        <HStack gap={2} flexWrap="wrap" justify="center" className="bm-stagger-3">
          <FeatureChip icon={LuMessageSquare} label="conversations" />
          <FeatureChip icon={LuWrench} label="tool traces" />
          <FeatureChip icon={LuActivity} label="cost & tokens" />
          <FeatureChip icon={LuSearch} label="eval results" />
        </HStack>

        {/* Keyboard hint */}
        <HStack gap={1.5} className="bm-stagger-4" opacity={0.5}>
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
            benchmark output from
          </Text>
          <Box px={1.5} py={0.5} borderRadius="sm" bg="bg.muted" border="1px solid" borderColor="border.muted">
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">npm run benchmark:analyst</Text>
          </Box>
        </HStack>
      </VStack>
    </Flex>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

const WRAP_COLUMNS = immutableSet(['Question', 'Answer', 'Eval Reason']);

export default function BenchmarkPage() {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  // null = table view, number = detail view for that row index
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isContinuing, setIsContinuing] = useState(false);
  const [connectionsConfig, setConnectionsConfig] = useState<BenchmarkConnectionEntry[] | null>(null);
  const [connectionsFileName, setConnectionsFileName] = useState<string>('');

  const handleFile = useCallback((file: File) => {
    file.text().then(text => {
      const conns = tryParseConnections(text);
      if (conns) {
        setConnectionsConfig(conns);
        setConnectionsFileName(file.name);
        return;
      }
      setFileName(file.name);
      try {
        const result = parseUploadedFile(text);
        setParsed(result);
        setSelectedRow(result.kind === 'conversation' ? 0 : null);
        if (result.kind === 'benchmark' && result.embeddedConnections && !connectionsConfig) {
          setConnectionsConfig(result.embeddedConnections);
          setConnectionsFileName('(embedded in output)');
        }
      } catch (e) {
        console.error('Failed to parse file:', e);
      }
    });
  }, [connectionsConfig]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((f) => handleFile(f));
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
  }, [handleFiles]);

  const isBenchmark = parsed?.kind === 'benchmark';

  const stats = useMemo(() => {
    if (!isBenchmark) return null;
    return aggregateStats(parsed.rows);
  }, [parsed, isBenchmark]);

  // Flatten benchmark rows into TableV2-compatible data
  const tableData = useMemo(() => {
    if (!isBenchmark || !stats) return null;
    const hasEvals = parsed.rows.some(r => r.eval);
    const hasFailureRate = parsed.rows.some(r => r.eval?.failure_rate != null);
    const hasBenchmark = parsed.rows.some(r => r.benchmark);
    const hasCommit = parsed.rows.some(r => r.git_commit);
    const hasQueryId = parsed.rows.some(r => r.input_index != null);
    const hasRunIdx = parsed.rows.some(r => r.eval?.run_idx != null);
    const columns = [
      ...(hasBenchmark ? ['Dataset'] : []),
      ...(hasCommit ? ['Commit'] : []),
      ...(hasQueryId ? ['Query ID'] : []),
      ...(hasRunIdx ? ['Run ID'] : []),
      'Question',
      'Answer',
      ...(hasEvals ? ['Eval', 'Eval Reason'] : []),
      ...(hasFailureRate ? ['Failure Rate (%)'] : []),
      'Time (s)', 'Cost ($)', 'Tool Calls', 'LLM Calls', 'Max Tool (s)', 'Slow Tool', 'Error',
    ];
    const types = [
      ...(hasBenchmark ? ['VARCHAR'] : []),
      ...(hasCommit ? ['VARCHAR'] : []),
      ...(hasQueryId ? ['INTEGER'] : []),
      ...(hasRunIdx ? ['INTEGER'] : []),
      'VARCHAR',
      'VARCHAR',
      ...(hasEvals ? ['VARCHAR', 'VARCHAR'] : []),
      ...(hasFailureRate ? ['DOUBLE'] : []),
      'DOUBLE', 'DOUBLE', 'INTEGER', 'INTEGER', 'DOUBLE', 'VARCHAR', 'VARCHAR',
    ];
    const rows = parsed.rows.map((row, i) => {
      const st = stats.perRow[i];
      return {
        ...(hasBenchmark ? { 'Dataset': row.benchmark ?? '' } : {}),
        ...(hasCommit ? { 'Commit': row.git_commit ?? '' } : {}),
        ...(hasQueryId ? { 'Query ID': row.input_index ?? i } : {}),
        ...(hasRunIdx ? { 'Run ID': row.eval?.run_idx ?? 0 } : {}),
        'Question': row.input.user_message,
        'Answer': extractAnswer(row),
        ...(hasEvals ? {
          'Eval': row.eval ? (row.eval.pass ? '\u2705' : '\u274C') : '-',
          'Eval Reason': row.eval?.reason ?? '',
        } : {}),
        ...(hasFailureRate ? {
          'Failure Rate (%)': row.eval?.failure_rate != null
            ? Math.round(row.eval.failure_rate * 10) / 10
            : null,
        } : {}),
        'Time (s)': Math.round(row.duration_ms / 100) / 10,
        'Cost ($)': Math.round(st.totalCost * 10000) / 10000,
        'Tool Calls': st.toolCalls,
        'LLM Calls': st.llmCalls,
        'Max Tool (s)': Math.round(st.maxToolMs / 100) / 10,
        'Slow Tool': st.maxToolName ?? '',
        'Error': row.error ?? '',
        _rowIndex: i,
      };
    });
    return { columns, types, rows };
  }, [parsed, stats, isBenchmark]);

  // Not loaded — show upload screen
  if (!parsed) {
    return <UploadScreen onDrop={handleDrop} onInputChange={handleInputChange} />;
  }

  const resetFile = () => { setParsed(null); setFileName(''); setSelectedRow(null); };

  // ── Benchmark: table view (no row selected) ──
  if (isBenchmark && selectedRow === null && stats && tableData) {
    const hasEvals = parsed.rows.some(r => r.eval);
    const evaled = hasEvals ? parsed.rows.filter(r => r.eval) : [];
    const passed = evaled.filter(r => r.eval!.pass).length;
    const evalTotal = evaled.length;
    const pct = evalTotal > 0 ? Math.round((passed / evalTotal) * 100) : 0;

    return (
      <Box h="calc(100vh - 48px)" display="flex" flexDirection="column">
        {/* Header + stats */}
        <Box px={8} py={6} borderBottom="1px solid" borderColor="border.muted" bg="bg.subtle" flexShrink={0}>
          {/* Top row: file name + actions */}
          <HStack justify="space-between" mb={5}>
            <HStack gap={2}>
              <Icon as={LuFileText} boxSize="4" color="fg.muted" />
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">{fileName}</Text>
              <Text fontSize="xs" color="fg.subtle" fontFamily="mono">{parsed.rows.length} rows</Text>
            </HStack>
            <HStack gap={3}>
              {connectionsConfig && (
                <Text fontSize="2xs" color="fg.subtle">
                  Connections: {connectionsFileName}
                </Text>
              )}
              <Text
                fontSize="xs"
                color="accent.primary"
                cursor="pointer"
                fontWeight="medium"
                _hover={{ textDecoration: 'underline' }}
                onClick={resetFile}
              >
                New file
              </Text>
            </HStack>
          </HStack>

          {/* Big metrics row */}
          <HStack gap={8} flexWrap="wrap" align="baseline">
            {hasEvals && (
              <VStack gap={0} align="start">
                <Text fontSize="3xl" fontWeight="bold" fontFamily="mono" lineHeight="1"
                  color={pct >= 70 ? 'accent.success' : pct >= 40 ? 'accent.warning' : 'accent.danger'}
                >
                  {pct}%
                </Text>
                <Text fontSize="xs" color="fg.muted">{passed}/{evalTotal} passed</Text>
              </VStack>
            )}
            <VStack gap={0} align="start">
              <HStack gap={1.5} align="baseline">
                <Icon as={LuClock} boxSize="4" color="accent.cyan" />
                <Text fontSize="xl" fontWeight="bold" fontFamily="mono" lineHeight="1">{formatDuration(stats.total.duration_ms)}</Text>
              </HStack>
              <Text fontSize="xs" color="fg.muted">total time</Text>
            </VStack>
            <VStack gap={0} align="start">
              <HStack gap={1.5} align="baseline">
                <Icon as={LuCoins} boxSize="4" color="accent.success" />
                <Text fontSize="xl" fontWeight="bold" fontFamily="mono" lineHeight="1">{formatCost(stats.total.totalCost)}</Text>
              </HStack>
              <Text fontSize="xs" color="fg.muted">cost</Text>
            </VStack>
            <VStack gap={0} align="start">
              <HStack gap={1.5} align="baseline">
                <Icon as={LuHash} boxSize="4" color="accent.primary" />
                <Text fontSize="xl" fontWeight="bold" fontFamily="mono" lineHeight="1">{stats.total.totalTokens.toLocaleString()}</Text>
              </HStack>
              <Text fontSize="xs" color="fg.muted">tokens</Text>
            </VStack>
            <VStack gap={0} align="start">
              <HStack gap={1.5} align="baseline">
                <Icon as={LuWrench} boxSize="4" color="accent.teal" />
                <Text fontSize="xl" fontWeight="bold" fontFamily="mono" lineHeight="1">{stats.total.toolCalls}</Text>
              </HStack>
              <Text fontSize="xs" color="fg.muted">tool calls</Text>
            </VStack>
            <VStack gap={0} align="start">
              <HStack gap={1.5} align="baseline">
                <Icon as={LuCpu} boxSize="4" color="accent.secondary" />
                <Text fontSize="xl" fontWeight="bold" fontFamily="mono" lineHeight="1">{stats.total.llmCalls}</Text>
              </HStack>
              <Text fontSize="xs" color="fg.muted">LLM calls</Text>
            </VStack>
            {stats.total.maxToolMs > 0 && (
              <VStack gap={0} align="start">
                <HStack gap={1.5} align="baseline">
                  <Icon as={LuClock} boxSize="4" color="accent.warning" />
                  <Text fontSize="xl" fontWeight="bold" fontFamily="mono" lineHeight="1">
                    {formatDuration(stats.total.maxToolMs)}
                  </Text>
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                  slowest tool{stats.total.maxToolName ? ` (${stats.total.maxToolName})` : ''}
                </Text>
              </VStack>
            )}
          </HStack>
        </Box>

        {/* Results table */}
        <Box flex={1} overflow="hidden">
          <TableV2
            columns={tableData.columns}
            types={tableData.types}
            rows={tableData.rows}
            onRowClick={(row) => setSelectedRow(row._rowIndex as number)}
            initialColumnSizing={{ 'Question': 250, 'Answer': 500, 'Eval Reason': 250, 'Query ID': 80, 'Run ID': 60, 'Eval': 80, 'Commit': 90 }}
            initialSorting={[{ id: 'Dataset', desc: false }, { id: 'Query ID', desc: false }, { id: 'Run ID', desc: false }]}
            wrapColumns={WRAP_COLUMNS}
            renderCell={(colId, value) => {
              if (colId === 'Answer' && typeof value === 'string' && value) {
                return <Markdown context="sidebar" fontSize="2xs">{value}</Markdown>;
              }
              return undefined;
            }}
          />
        </Box>
      </Box>
    );
  }

  // ── Detail view (single conversation) ──
  // For benchmark rows or single-conversation files.
  const activeRowIndex = selectedRow ?? 0;
  let currentLog: ConversationLogEntry[] | null = null;
  let currentPiLog: unknown[] | undefined;
  if (parsed.kind === 'conversation') {
    currentLog = parsed.log;
  } else {
    const row = parsed.rows[activeRowIndex];
    if (row) {
      const rawLog = row.log as unknown[];
      currentLog = isProductionLog(rawLog)
        ? (rawLog as unknown as ConversationLogEntry[])
        : piLogToLegacy(rawLog as ConversationLog);
      // Pass raw PI log for ExecutionTree (only if it's PI format)
      if (!isProductionLog(rawLog)) {
        currentPiLog = rawLog;
      }
    }
  }

  const continuablePiLog: ConversationLog | null = (() => {
    if (parsed.kind === 'conversation') return null;
    const row = parsed.rows[activeRowIndex];
    if (!row) return null;
    const log = row.log as unknown[];
    if (!Array.isArray(log) || isProductionLog(log)) return null;
    return log as unknown as ConversationLog;
  })();

  const continueLabel: string | undefined = (() => {
    if (parsed.kind !== 'benchmark') return undefined;
    return parsed.rows[activeRowIndex]?.input?.user_message;
  })();

  const handleContinueConversation = async () => {
    if (!continuablePiLog || isContinuing || !connectionsConfig) return;
    setIsContinuing(true);
    try {
      const fileId = await importBenchmarkConversation(continuablePiLog, {
        label: continueLabel,
        connections: connectionsConfig,
      });
      window.location.href = `/explore/${fileId}?v=2`;
    } catch (err) {
      console.error('Failed to import benchmark conversation:', err);
      setIsContinuing(false);
    }
  };

  const activeRow = isBenchmark ? parsed.rows[activeRowIndex] : null;
  const activeRowStats = stats?.perRow[activeRowIndex];

  return (
    <Flex h="calc(100vh - 48px)" direction="column">
      {/* Detail header */}
      <HStack
        px={5}
        py={3}
        borderBottom="1px solid"
        borderColor="border.muted"
        justify="space-between"
        bg="bg.subtle"
        flexShrink={0}
      >
        <HStack gap={3}>
          {isBenchmark && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setSelectedRow(null)}
              aria-label="Back to results table"
            >
              <LuArrowLeft />
              Back
            </Button>
          )}
          {isBenchmark && (
            <Text fontSize="xs" fontFamily="mono" color="fg.muted">
              Row {activeRowIndex + 1} / {parsed.rows.length}
            </Text>
          )}
          {!isBenchmark && (
            <HStack gap={2}>
              <Icon as={LuFileText} boxSize="4" color="fg.muted" />
              <Text fontSize="sm" fontWeight="medium">{fileName}</Text>
            </HStack>
          )}
        </HStack>
        <HStack gap={3}>
          {activeRowStats && (
            <HStack gap={3}>
              <HStack gap={1}>
                <Icon as={LuClock} boxSize="3" color="accent.cyan" />
                <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{formatDuration(activeRowStats.duration_ms)}</Text>
              </HStack>
              <HStack gap={1}>
                <Icon as={LuCoins} boxSize="3" color="accent.success" />
                <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{formatCost(activeRowStats.totalCost)}</Text>
              </HStack>
              <HStack gap={1}>
                <Icon as={LuWrench} boxSize="3" color="accent.teal" />
                <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{activeRowStats.toolCalls}</Text>
              </HStack>
              {activeRowStats.maxToolMs > 0 && (
                <HStack gap={1}>
                  <Icon as={LuClock} boxSize="3" color="accent.warning" />
                  <Text fontSize="2xs" fontFamily="mono" color="fg.muted">
                    max: {activeRowStats.maxToolName ?? 'tool'} {formatDuration(activeRowStats.maxToolMs)}
                  </Text>
                </HStack>
              )}
            </HStack>
          )}
          {activeRow?.eval && (
            <HStack gap={2} align="center" maxW="50vw">
              <Box
                px={2}
                py={0.5}
                borderRadius="full"
                bg={activeRow.eval.pass ? 'accent.success/15' : 'accent.danger/15'}
                flexShrink={0}
              >
                <HStack gap={1}>
                  <Icon
                    as={activeRow.eval.pass ? LuCheck : LuX}
                    boxSize="3"
                    color={activeRow.eval.pass ? 'accent.success' : 'accent.danger'}
                  />
                  <Text
                    fontSize="2xs"
                    fontWeight="bold"
                    fontFamily="mono"
                    color={activeRow.eval.pass ? 'accent.success' : 'accent.danger'}
                  >
                    {activeRow.eval.pass ? 'PASS' : 'FAIL'}
                  </Text>
                </HStack>
              </Box>
              {activeRow.eval.failure_rate != null && (
                <Text
                  fontSize="2xs"
                  fontWeight="bold"
                  fontFamily="mono"
                  color={
                    activeRow.eval.failure_rate === 0
                      ? 'accent.success'
                      : activeRow.eval.failure_rate >= 50
                        ? 'accent.danger'
                        : 'accent.warning'
                  }
                  flexShrink={0}
                  title="Failure rate across all runs (DAB_TIMES_RUN)"
                >
                  {Math.round(activeRow.eval.failure_rate * 10) / 10}% fail
                </Text>
              )}
              {activeRow.eval.reason && (
                <Text
                  fontSize="2xs"
                  color="fg.muted"
                  fontFamily="mono"
                  truncate
                  title={activeRow.eval.reason}
                >
                  {activeRow.eval.reason}
                </Text>
              )}
            </HStack>
          )}
          {isBenchmark && (
            <HStack gap={0.5}>
              <Button
                size="xs"
                variant="ghost"
                disabled={activeRowIndex <= 0}
                onClick={() => setSelectedRow(activeRowIndex - 1)}
                aria-label="Previous row"
              >
                <LuChevronLeft />
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={activeRowIndex >= parsed.rows.length - 1}
                onClick={() => setSelectedRow(activeRowIndex + 1)}
                aria-label="Next row"
              >
                <LuChevronRight />
              </Button>
            </HStack>
          )}
          {!isBenchmark && (
            <Text
              fontSize="xs"
              color="accent.primary"
              cursor="pointer"
              _hover={{ textDecoration: 'underline' }}
              onClick={resetFile}
            >
              Upload new file
            </Text>
          )}
        </HStack>
      </HStack>

      {/* Conversation content */}
      <Box flex={1} overflowY="auto">
        <Box maxW="960px" mx="auto" px={4} py={4}>
          {currentLog && <LogViewer log={currentLog} piLog={currentPiLog} />}

          {continuablePiLog && (
            <VStack gap={2} pt={6} pb={2}>
              <Button
                size="md"
                bg={connectionsConfig ? 'accent.success' : 'bg.muted'}
                color={connectionsConfig ? 'white' : 'fg.subtle'}
                _hover={connectionsConfig ? { bg: 'accent.success', opacity: 0.9 } : {}}
                disabled={isContinuing || !connectionsConfig}
                onClick={handleContinueConversation}
                aria-label="Continue conversation in chat"
              >
                {isContinuing ? <Spinner size="sm" /> : <LuMessageCircle />}
                {isContinuing ? 'Importing...' : 'Continue conversation'}
              </Button>
              {connectionsConfig ? (
                <Text fontSize="2xs" color="fg.subtle">
                  Connections loaded: {connectionsFileName} ({connectionsConfig.length} entries)
                </Text>
              ) : (
                <Box
                  px={4}
                  py={2}
                  border="1px dashed"
                  borderColor="accent.warning"
                  borderRadius="md"
                  cursor="pointer"
                  onClick={() => document.getElementById('benchmark-connections-input')?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <Text fontSize="2xs" color="accent.warning" textAlign="center">
                    Drop or click to attach the dataset&apos;s connections.json
                  </Text>
                  <input
                    id="benchmark-connections-input"
                    type="file"
                    accept=".json"
                    onChange={handleInputChange}
                    style={{ display: 'none' }}
                  />
                </Box>
              )}
            </VStack>
          )}
        </Box>
      </Box>
    </Flex>
  );
}
