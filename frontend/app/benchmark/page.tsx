'use client';

import { useState, useCallback, useMemo } from 'react';
import { Box, Text, VStack, HStack, Flex, Grid, Icon, Spinner } from '@chakra-ui/react';
import { createListCollection } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { LuClock, LuCoins, LuCpu, LuHash, LuWrench, LuUpload, LuTriangleAlert, LuFileText, LuChevronLeft, LuChevronRight, LuCheck, LuX, LuBraces, LuMessageSquare, LuActivity, LuSearch, LuMessageCircle } from 'react-icons/lu';
import { Button } from '@chakra-ui/react';
import { parseLogToMessages } from '@/lib/conversations-utils';
import { piLogToLegacy } from '@/lib/chat-translator';
import { importBenchmarkConversation } from '@/lib/benchmark/import-conversation';
import type { ConversationLog } from '@/orchestrator/types';
import type { BenchmarkConnectionEntry } from '@/agents/benchmark-analyst/connection-source';
import { groupIntoTurns } from '@/components/explore/message/groupIntoTurns';
import AgentTurnContainer from '@/components/explore/AgentTurnContainer';
import ToolDebugBar from '@/components/explore/ToolDebugBar';
import type { ConversationLogEntry } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────

interface EvalResult {
  pass: boolean;
  reason: string;
}

interface BenchmarkRow {
  input: { user_message: string; allowed_connections: string[] };
  log: unknown[];
  duration_ms: number;
  error?: string;
  eval?: EvalResult;
}

type ParsedFile =
  | { kind: 'conversation'; log: ConversationLogEntry[] }
  | { kind: 'benchmark'; rows: BenchmarkRow[] };

interface RunStats {
  duration_ms: number;
  totalCost: number;
  totalTokens: number;
  llmCalls: number;
  toolCalls: number;
  error?: string;
}

// ── Parsing ───────────────────────────────────────────────────────────────

function isProductionLog(log: unknown[]): log is ConversationLogEntry[] {
  return log.length > 0 && typeof (log[0] as any)?._type === 'string';
}

/**
 * Detect a benchmark `<dataset>_connections.json` file: a JSON array whose
 * entries match the BenchmarkConnectionEntry shape ({name, dialect, config}).
 * Returned separately so the user can drop it alongside the JSONL without
 * clobbering their parsed conversation/benchmark view.
 */
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
  return { kind: 'benchmark', rows };
}

// ── Stats ─────────────────────────────────────────────────────────────────

function extractStats(row: BenchmarkRow): RunStats {
  let totalCost = 0, totalTokens = 0, llmCalls = 0, toolCalls = 0;
  for (const entry of row.log as any[]) {
    if (entry.role === 'assistant' && entry.usage) {
      llmCalls++;
      totalTokens += entry.usage.totalTokens ?? 0;
      totalCost += entry.usage.cost?.total ?? 0;
    }
    if (entry.role === 'toolResult') toolCalls++;
    if (entry._type === 'task_debug' && entry.llmDebug) {
      for (const call of entry.llmDebug) {
        llmCalls++;
        totalTokens += (call.total_tokens ?? call.totalTokens ?? 0);
        totalCost += (call.cost?.total ?? 0);
      }
    }
    if (entry._type === 'task_result') toolCalls++;
  }
  return { duration_ms: row.duration_ms, totalCost, totalTokens, llmCalls, toolCalls, error: row.error };
}

function aggregateStats(rows: BenchmarkRow[]): { total: RunStats; perRow: RunStats[] } {
  const perRow = rows.map(extractStats);
  const total: RunStats = {
    duration_ms: perRow.reduce((s, r) => s + r.duration_ms, 0),
    totalCost: perRow.reduce((s, r) => s + r.totalCost, 0),
    totalTokens: perRow.reduce((s, r) => s + r.totalTokens, 0),
    llmCalls: perRow.reduce((s, r) => s + r.llmCalls, 0),
    toolCalls: perRow.reduce((s, r) => s + r.toolCalls, 0),
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

function StatCard({ icon, label, value, accent }: { icon: React.ElementType; label: string; value: string; accent?: string }) {
  return (
    <Box
      px={2}
      py={1.5}
      borderRadius="md"
      bg="bg.canvas"
      border="1px solid"
      borderColor="border.muted"
    >
      <HStack gap={1.5} mb={0.5}>
        <Icon as={icon} boxSize="3" color={accent ?? 'fg.subtle'} />
        <Text fontSize="2xs" color="fg.subtle" textTransform="uppercase" letterSpacing="wider" fontWeight="medium">{label}</Text>
      </HStack>
      <Text fontSize="sm" fontWeight="bold" fontFamily="mono" letterSpacing="-0.02em">{value}</Text>
    </Box>
  );
}

function StatsPanel({ stats, label }: { stats: RunStats; label?: string }) {
  return (
    <VStack gap={2} align="stretch">
      {label && (
        <Text fontSize="2xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">{label}</Text>
      )}
      <Grid templateColumns="repeat(2, 1fr)" gap={2}>
        <StatCard icon={LuClock} label="Time" value={formatDuration(stats.duration_ms)} accent="accent.cyan" />
        <StatCard icon={LuCoins} label="Cost" value={formatCost(stats.totalCost)} accent="accent.success" />
        <StatCard icon={LuHash} label="Tokens" value={stats.totalTokens.toLocaleString()} accent="accent.primary" />
        <StatCard icon={LuCpu} label="LLM calls" value={String(stats.llmCalls)} accent="accent.secondary" />
      </Grid>
      <StatCard icon={LuWrench} label="Tool calls" value={String(stats.toolCalls)} accent="accent.teal" />
      {stats.error && (
        <Box px={3} py={2} borderRadius="lg" bg="red.subtle" border="1px solid" borderColor="border.error">
          <HStack gap={1.5}>
            <Icon as={LuTriangleAlert} boxSize="3.5" color="fg.error" />
            <Text fontSize="xs" color="fg.error" fontWeight="medium">{stats.error}</Text>
          </HStack>
        </Box>
      )}
    </VStack>
  );
}

// ── Conversation viewer ───────────────────────────────────────────────────

function LogViewer({ log }: { log: ConversationLogEntry[] }) {
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

  return (
    <VStack gap={0} align="stretch" width="100%">
      <ToolDebugBar messages={messages} />
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

export default function BenchmarkPage() {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [selectedRow, setSelectedRow] = useState(0);
  const [fileName, setFileName] = useState<string>('');
  const [isContinuing, setIsContinuing] = useState(false);
  const [connectionsConfig, setConnectionsConfig] = useState<BenchmarkConnectionEntry[] | null>(null);
  const [connectionsFileName, setConnectionsFileName] = useState<string>('');

  const handleFile = useCallback((file: File) => {
    file.text().then(text => {
      // Connection configs (the dataset's connections.json) are detected
      // by shape and stored separately so the user can drop them after
      // the JSONL without resetting the conversation view.
      const conns = tryParseConnections(text);
      if (conns) {
        setConnectionsConfig(conns);
        setConnectionsFileName(file.name);
        return;
      }
      setFileName(file.name);
      try {
        setParsed(parseUploadedFile(text));
        setSelectedRow(0);
      } catch (e) {
        console.error('Failed to parse file:', e);
      }
    });
  }, []);

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

  const stats = useMemo(() => {
    if (parsed?.kind !== 'benchmark') return null;
    return aggregateStats(parsed.rows);
  }, [parsed]);

  const rowCollection = useMemo(() => {
    if (parsed?.kind !== 'benchmark') return null;
    return createListCollection({
      items: parsed.rows.map((row, i) => ({
        label: `${i}: ${row.input.user_message.slice(0, 80)}${row.input.user_message.length > 80 ? '...' : ''}`,
        value: String(i),
      })),
    });
  }, [parsed]);

  // Not loaded — show upload screen
  if (!parsed) {
    return <UploadScreen onDrop={handleDrop} onInputChange={handleInputChange} />;
  }

  // Get the log to render
  let currentLog: ConversationLogEntry[] | null = null;
  if (parsed.kind === 'conversation') {
    currentLog = parsed.log;
  } else {
    const row = parsed.rows[selectedRow];
    if (row) {
      currentLog = isProductionLog(row.log as unknown[])
        ? (row.log as unknown as ConversationLogEntry[])
        : piLogToLegacy(row.log as ConversationLog);
    }
  }

  const isBenchmark = parsed.kind === 'benchmark';

  const resetFile = () => { setParsed(null); setFileName(''); setSelectedRow(0); };

  // Pi-ai log for whatever the user is currently viewing — a single
  // dropped conversation file or the selected row of a benchmark JSONL.
  // null when the log is in legacy task-log shape (older outputs that
  // pre-date the runner's pi-ai change), since the orchestrator needs
  // pi-ai shape to resume the conversation.
  const continuablePiLog: ConversationLog | null = (() => {
    if (parsed.kind === 'conversation') {
      // The /benchmark uploader only routes through `convertOrchestratorLog`
      // when the file is non-production (pi-ai) shape — but it converts
      // for display. We don't have the raw pi-ai log on the parsed object,
      // so single-conversation continuation is currently unsupported.
      // (Benchmark JSONL → row-by-row continuation works.)
      return null;
    }
    const row = parsed.rows[selectedRow];
    if (!row) return null;
    const log = row.log as unknown[];
    if (!Array.isArray(log) || isProductionLog(log)) return null;
    return log as unknown as ConversationLog;
  })();

  const continueLabel: string | undefined = (() => {
    if (parsed.kind !== 'benchmark') return undefined;
    return parsed.rows[selectedRow]?.input?.user_message;
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

  return (
    <Flex h="calc(100vh - 48px)">
      {/* ── Main content: conversation ── */}
      <Box flex={1} overflowY="auto">
        {/* Header bar for conversation-only files */}
        {!isBenchmark && (
          <HStack
            px={5}
            py={3}
            borderBottom="1px solid"
            borderColor="border.muted"
            justify="space-between"
            bg="bg.subtle"
          >
            <HStack gap={2}>
              <Icon as={LuFileText} boxSize="4" color="fg.muted" />
              <Text fontSize="sm" fontWeight="medium">{fileName}</Text>
            </HStack>
            <Text
              fontSize="xs"
              color="accent.primary"
              cursor="pointer"
              _hover={{ textDecoration: 'underline' }}
              onClick={resetFile}
            >
              Upload new file
            </Text>
          </HStack>
        )}

        {/* Conversation */}
        <Box maxW="960px" mx="auto" px={4} py={4}>
          {currentLog && <LogViewer log={currentLog} />}

          {/* Continue this benchmark conversation in the v=2 chat UI.
              Imports the row's pi-ai log + the dataset's connections.json
              as a v=2 conversation file then navigates to
              /explore/<fileId>?v=2. Connections are required because the
              orchestrator needs NodeConnector configs to actually run SQL
              against the benchmark's databases. */}
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
                {isContinuing ? 'Importing…' : 'Continue conversation'}
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
                    Drop or click to attach the dataset&apos;s connections.json (e.g. stockindex_connections.json)
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

      {/* ── Right sidebar: stats + controls ── */}
      {isBenchmark && stats && (
        <Box
          w="320px"
          minW="320px"
          borderLeft="1px solid"
          borderColor="border.muted"
          bg="bg.subtle"
          overflowY="auto"
        >
          {/* Sidebar header */}
          <Box px={4} py={3} borderBottom="1px solid" borderColor="border.muted">
            <HStack justify="space-between" align="center">
              <HStack gap={2}>
                <Box w="2px" h="14px" bg="accent.primary" borderRadius="full" />
                <Text fontSize="sm" fontWeight="semibold">Benchmark</Text>
              </HStack>
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
            <HStack gap={1.5} mt={1.5} ml={3}>
              <Icon as={LuFileText} boxSize="3" color="fg.subtle" />
              <Text fontSize="2xs" color="fg.subtle" truncate>{fileName}</Text>
            </HStack>
          </Box>

          <VStack gap={0} align="stretch">
            {/* Aggregate eval score */}
            {parsed.rows.some(r => r.eval) && (() => {
              const evaled = parsed.rows.filter(r => r.eval);
              const passed = evaled.filter(r => r.eval!.pass).length;
              const total = evaled.length;
              const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
              return (
                <Box px={4} py={3} borderBottom="1px solid" borderColor="border.muted">
                  <Text fontSize="2xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider" mb={2}>
                    Eval Score
                  </Text>
                  <HStack gap={3} align="baseline">
                    <Text fontSize="2xl" fontWeight="bold" fontFamily="mono" color={pct >= 70 ? 'accent.success' : pct >= 40 ? 'accent.warning' : 'accent.danger'}>
                      {pct}%
                    </Text>
                    <Text fontSize="sm" color="fg.muted" fontFamily="mono">
                      {passed}/{total} passed
                    </Text>
                  </HStack>
                </Box>
              );
            })()}

            {/* Aggregate stats */}
            <Box px={4} py={4}>
              <StatsPanel stats={stats.total} label={`Run total — ${parsed.rows.length} rows`} />
            </Box>

            {/* Row selector */}
            <Box px={4} py={3} borderTop="1px solid" borderColor="border.muted">
              <VStack gap={2.5} align="stretch">
                <HStack justify="space-between" align="center">
                  <Text fontSize="2xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
                    Select row
                  </Text>
                  <HStack gap={0.5}>
                    <Button
                      size="2xs"
                      variant="ghost"
                      disabled={selectedRow <= 0}
                      onClick={() => setSelectedRow(r => r - 1)}
                      px={1}
                    >
                      <LuChevronLeft />
                    </Button>
                    <Text fontSize="2xs" color="fg.muted" fontFamily="mono" minW="40px" textAlign="center">
                      {selectedRow + 1}/{parsed.rows.length}
                    </Text>
                    <Button
                      size="2xs"
                      variant="ghost"
                      disabled={selectedRow >= parsed.rows.length - 1}
                      onClick={() => setSelectedRow(r => r + 1)}
                      px={1}
                    >
                      <LuChevronRight />
                    </Button>
                  </HStack>
                </HStack>
                {rowCollection && (
                  <SelectRoot
                    collection={rowCollection}
                    value={[String(selectedRow)]}
                    onValueChange={(e) => setSelectedRow(Number(e.value[0]))}
                    size="sm"
                    positioning={{ sameWidth: true, placement: 'bottom' }}
                  >
                    <SelectTrigger>
                      <SelectValueText placeholder="Select row" />
                    </SelectTrigger>
                    <SelectContent maxH="300px" overflowY="auto" zIndex="popover">
                      {rowCollection.items.map((item) => (
                        <SelectItem key={item.value} item={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                )}
              </VStack>
            </Box>

            {/* Per-row stats */}
            {stats.perRow[selectedRow] && (
              <Box px={4} py={4} borderTop="1px solid" borderColor="border.muted">
                <StatsPanel stats={stats.perRow[selectedRow]} label="Selected row" />
              </Box>
            )}

            {/* Per-row eval */}
            {parsed.rows[selectedRow]?.eval && (
              <Box px={4} py={3} borderTop="1px solid" borderColor="border.muted">
                <Text fontSize="2xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider" mb={2}>
                  Eval
                </Text>
                <HStack gap={2} mb={2}>
                  <Box
                    px={2} py={0.5} borderRadius="full"
                    bg={parsed.rows[selectedRow].eval!.pass ? 'accent.success/15' : 'accent.danger/15'}
                  >
                    <HStack gap={1}>
                      <Icon
                        as={parsed.rows[selectedRow].eval!.pass ? LuCheck : LuX}
                        boxSize="3"
                        color={parsed.rows[selectedRow].eval!.pass ? 'accent.success' : 'accent.danger'}
                      />
                      <Text
                        fontSize="xs" fontWeight="bold" fontFamily="mono"
                        color={parsed.rows[selectedRow].eval!.pass ? 'accent.success' : 'accent.danger'}
                      >
                        {parsed.rows[selectedRow].eval!.pass ? 'PASS' : 'FAIL'}
                      </Text>
                    </HStack>
                  </Box>
                </HStack>
                <Text fontSize="xs" color="fg.muted" lineClamp={4}>
                  {parsed.rows[selectedRow].eval!.reason}
                </Text>
              </Box>
            )}
          </VStack>
        </Box>
      )}
    </Flex>
  );
}
