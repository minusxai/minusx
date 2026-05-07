'use client';

import { useState, useCallback, useMemo } from 'react';
import { Box, Text, VStack, HStack, Flex, Grid, Icon } from '@chakra-ui/react';
import { createListCollection } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { LuClock, LuCoins, LuCpu, LuHash, LuWrench, LuUpload, LuTriangleAlert, LuFileText, LuChevronLeft, LuChevronRight, LuCheck, LuX } from 'react-icons/lu';
import { Button } from '@chakra-ui/react';
import { parseLogToMessages } from '@/lib/conversations-utils';
import { convertOrchestratorLog } from '@/lib/benchmark/log-converter';
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

function parseUploadedFile(text: string): ParsedFile {
  try {
    const obj = JSON.parse(text);
    if (obj.log && Array.isArray(obj.log)) {
      if (isProductionLog(obj.log)) {
        return { kind: 'conversation', log: obj.log };
      }
      return { kind: 'conversation', log: convertOrchestratorLog(obj.log) };
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
        totalCost += (call.cost ?? 0);
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

function UploadScreen({ onDrop, onInputChange }: {
  onDrop: (e: React.DragEvent) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <Flex
      align="center"
      justify="center"
      minH="calc(100vh - 120px)"
    >
      <VStack gap={6} maxW="480px" textAlign="center">
        <Box
          p={4}
          borderRadius="full"
          bg="bg.subtle"
        >
          <Icon as={LuUpload} boxSize="8" color="fg.muted" />
        </Box>
        <VStack gap={1}>
          <Text fontSize="lg" fontWeight="semibold">Benchmark Log Viewer</Text>
          <Text fontSize="sm" color="fg.muted">
            Upload a conversation JSON or benchmark output.jsonl to inspect agent runs
          </Text>
        </VStack>
        <Box
          border="2px dashed"
          borderColor="border.muted"
          borderRadius="lg"
          p={10}
          w="100%"
          cursor="pointer"
          transition="all 0.15s"
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => document.getElementById('benchmark-file-input')?.click()}
          _hover={{ borderColor: 'fg.subtle', bg: 'bg.subtle' }}
        >
          <input
            id="benchmark-file-input"
            type="file"
            accept=".json,.jsonl"
            onChange={onInputChange}
            style={{ display: 'none' }}
          />
          <VStack gap={2}>
            <Icon as={LuFileText} boxSize="6" color="fg.subtle" />
            <Text fontSize="sm" color="fg.muted">
              Drop file here or click to browse
            </Text>
            <Text fontSize="2xs" color="fg.subtle">.json or .jsonl</Text>
          </VStack>
        </Box>
      </VStack>
    </Flex>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [selectedRow, setSelectedRow] = useState(0);
  const [fileName, setFileName] = useState<string>('');

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    file.text().then(text => {
      try {
        setParsed(parseUploadedFile(text));
        setSelectedRow(0);
      } catch (e) {
        console.error('Failed to parse file:', e);
      }
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

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
        : convertOrchestratorLog(row.log as any[]);
    }
  }

  const isBenchmark = parsed.kind === 'benchmark';

  const resetFile = () => { setParsed(null); setFileName(''); setSelectedRow(0); };

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
