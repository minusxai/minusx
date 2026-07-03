'use client';

/**
 * Lighthouse-style file health badge + panel. Computes the deterministic rubric client-side
 * from the file's (merged, live-edited) content — instant, no fetch — and can run the LLM
 * visual judge on demand (POST /api/files/[id]/rubric with a captured screenshot).
 *
 * See `frontend/docs/rubrik.md`. Rendered in the shared FileHeader badge row for
 * question/dashboard/story files; renders nothing for other types.
 */
import { useEffect, useMemo, useState } from 'react';
import { Box, HStack, VStack, Text, Icon, Image, Popover, Portal, Button, Spinner, Table } from '@chakra-ui/react';
import { LuHeartPulse, LuScanEye, LuRefreshCw } from 'react-icons/lu';
import { useAppSelector, useAppStore } from '@/store/hooks';
import { selectFile, selectMergedContent } from '@/store/filesSlice';
import type { RootState } from '@/store/store';
import { useScreenshot } from '@/lib/hooks/useScreenshot';
import { isRubricFileType, scoreFileDeterministic } from '@/lib/rubric/registry';
import { passedChecks } from '@/lib/rubric/checks';
import { shapeContextForAgent } from '@/lib/context/context-agent-view';
import { buildVizTypeCtx } from '@/lib/rubric/refs';
import type { DeterministicContext, FindingSource, RubricCategory, RubricFileType, RubricReport, RubricSeverity } from '@/lib/rubric/types';
import type { QuestionContent } from '@/lib/types';

type Level = RubricSeverity | 'pass';

/**
 * Door for piece 3: when true, opening the panel auto-runs the combined visual review (a
 * screenshot capture + judge LLM call) instead of waiting for the "Run visual review" click.
 * Off by default — each open would otherwise cost an LLM call. Flip to true to always show the
 * combined total on open.
 */
const AUTO_RUN_VISUAL_REVIEW = false;

const GRADE_COLOR: Record<string, string> = { good: 'accent.success', fair: 'accent.warning', poor: 'accent.danger' };
const LEVEL: Record<Level, { color: string; label: string }> = {
  error: { color: 'accent.danger', label: 'ERROR' },
  warn: { color: 'accent.warning', label: 'WARN' },
  info: { color: 'fg.muted', label: 'INFO' },
  pass: { color: 'accent.success', label: 'PASS' },
};
const CATEGORY_LABEL: Record<RubricCategory, string> = {
  correctness: 'Correctness', clarity: 'Clarity', aesthetics: 'Aesthetics',
};
const LEVEL_ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, pass: 3 };

function LevelTag({ level }: { level: Level }) {
  const t = LEVEL[level];
  return (
    <Text as="span" px={1} borderRadius="sm" bg={`${t.color}/15`} color={t.color}
      fontSize="2xs" fontWeight="700" fontFamily="mono" letterSpacing="0.05em" whiteSpace="nowrap">
      {t.label}
    </Text>
  );
}

function scoreColor(score: number): string {
  if (score >= 4) return 'accent.success';
  if (score >= 2.5) return 'accent.warning';
  return 'accent.danger';
}

// Which scorer produced a row — deterministic rule vs the LLM checklist (llm.*).
const SOURCE: Record<FindingSource, { label: string; color: string }> = {
  rule: { label: 'Rules', color: 'fg.muted' },
  llm: { label: 'LLM', color: 'accent.secondary' },
};
const sourceOf = (ruleId: string): FindingSource => (ruleId.startsWith('llm.') ? 'llm' : 'rule');

const HAS_LLM = (fileType: string) => fileType !== 'context'; // context is deterministic-only

// The content the deterministic scorer expects. Context is scored on its agent-flattened shape.
function scorableContent(fileType: string, content: unknown): unknown {
  return fileType === 'context' ? shapeContextForAgent(content ?? {}) : content;
}

// Deterministic context — each referenced question's chart type, needed for tile/embed rules
// (dashboard cartesian-plots-need-3x3, story embed-too-narrow). A saved embed's viz type lives on
// the question file, not in the dashboard/story content, so resolve it from Redux. Dashboards list
// their questions in `assets`; a story's saved embeds are `data-question-id` refs in its body.
function vizTypeCtx(fileType: string, content: unknown, state: RootState): DeterministicContext | undefined {
  return buildVizTypeCtx(fileType, content, (id) => (selectFile(state, id)?.content as QuestionContent | undefined)?.vizSettings?.type);
}

export function FileHealthBadge({ fileId, fileType }: { fileId: number; fileType: string }) {
  // Score the SAVED content, not live edits — so this recomputes on save/load, NOT on every
  // keypress (which re-parsed stories on each stroke and froze the header). The refresh button
  // re-runs against the current unsaved edits on demand.
  const savedContent = useAppSelector((s) => selectFile(s, fileId)?.content);
  const store = useAppStore();
  const [override, setOverride] = useState<RubricReport | null>(null); // manual refresh or judge result
  const [llmRan, setLlmRan] = useState(false); // did the LLM visual review run for the shown report?
  const [judging, setJudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null); // the screenshot sent to the judge
  const { captureFileView, blobToDataURL } = useScreenshot({ maxWidth: 640 });

  const deterministic = useMemo<RubricReport | null>(() => {
    if (!isRubricFileType(fileType) || !savedContent) return null;
    try {
      const c = scorableContent(fileType, savedContent);
      return scoreFileDeterministic(fileType, c, vizTypeCtx(fileType, c, store.getState()));
    } catch {
      return null;
    }
  }, [fileType, savedContent, store]);

  // A new save (or file load) invalidates any manual-refresh / judge override.
  useEffect(() => { setOverride(null); setJudgeError(null); setShot(null); setLlmRan(false); }, [savedContent]);

  const report = override ?? deterministic;
  if (!report) return null;

  // Re-run the deterministic scorer against the CURRENT (unsaved) merged content, on demand.
  const refresh = () => {
    if (!isRubricFileType(fileType)) return;
    const merged = selectMergedContent(store.getState(), fileId);
    if (!merged) return;
    try {
      const c = scorableContent(fileType, merged);
      setOverride(scoreFileDeterministic(fileType, c, vizTypeCtx(fileType, c, store.getState())));
      setLlmRan(false); // a plain refresh is rules-only
    } catch {
      // ignore — keep the current report
    }
  };

  const runJudge = async () => {
    setJudging(true);
    setJudgeError(null);
    try {
      const blob = await captureFileView(fileId, { fullHeight: true });
      const screenshot = await blobToDataURL(blob);
      setShot(screenshot); // show what we're actually sending to the judge
      const res = await fetch(`/api/files/${fileId}/rubric`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenshot }),
      });
      const json = await res.json().catch(() => null);
      const nextReport = json?.data?.report as RubricReport | undefined;
      if (!res.ok || !nextReport) {
        const msg = json?.error?.message ?? json?.message ?? `Visual review failed (HTTP ${res.status}).`;
        console.error('[rubric] visual review failed', res.status, json);
        setJudgeError(String(msg));
        return;
      }
      setOverride(nextReport);
      setLlmRan(true); // the combined report now includes the LLM checklist
    } catch (e) {
      console.error('[rubric] visual review error', e);
      setJudgeError(e instanceof Error ? e.message : 'Visual review failed.');
    } finally {
      setJudging(false);
    }
  };

  const rows: { key: string; level: Level; source: FindingSource; category: RubricCategory; title: string; detail?: string; fix?: string }[] = [
    ...report.categories.flatMap((c) => c.findings).map((f, i) => ({
      key: `${f.ruleId}-${i}`, level: f.severity as Level, source: f.source, category: f.category, title: f.title, detail: f.detail, fix: f.fix,
    })),
    ...passedChecks(fileType as RubricFileType, report, llmRan).map((c) => ({
      key: c.ruleId, level: 'pass' as Level, source: sourceOf(c.ruleId), category: c.category, title: c.label,
    })),
  ].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const gradeColor = GRADE_COLOR[report.grade];

  return (
    <>
      <style>{'@keyframes mxHealthPing { 0% { opacity: 0.5; transform: scale(1); } 75%, 100% { opacity: 0; transform: scale(2.6); } }'}</style>
      <HStack
        gap={0}
        flexShrink={0}
        bg="bg.elevated"
        border="1px solid"
        borderColor="border.default"
        borderRadius="sm"
        overflow="hidden"
        fontFamily="mono"
        fontSize="2xs"
        fontWeight="600"
      >
      <Popover.Root
        positioning={{ placement: 'bottom-start' }}
        onOpenChange={(e) => { if (e.open && AUTO_RUN_VISUAL_REVIEW && !override && !judging) void runJudge(); }}
      >
      <Popover.Trigger asChild>
        <Box
          as="button"
          aria-label={`File health: ${report.overall} of 5 (${report.grade})`}
          display="inline-flex"
          alignItems="center"
          cursor="pointer"
          px={1.5}
          py={0.5}
          bg="transparent"
          _hover={{ bg: 'bg.muted' }}
        >
          <Box position="relative" w={2} h={2} mr={2}>
            <Box position="absolute" inset={0} borderRadius="full" bg={gradeColor} style={{ animation: 'mxHealthPing 1.6s ease-out infinite' }} />
            <Box position="absolute" inset={0} borderRadius="full" bg={gradeColor} />
          </Box>
          <Text color="fg.default">File Health: {report.overall}</Text>
          <Text color="fg.muted" ml={0.5}>/5</Text>
        </Box>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="420px" maxH="72vh" overflowY="auto">
            <Popover.Body>
              <VStack align="stretch" gap={3}>
                <HStack justify="space-between">
                  <HStack gap={2}>
                    <Icon as={LuHeartPulse} color={gradeColor} />
                    <Text fontWeight="700" fontSize="sm">File health</Text>
                  </HStack>
                  <HStack gap={1} fontFamily="mono" align="baseline">
                    <Text fontSize="lg" fontWeight="700" color={gradeColor}>{report.overall}</Text>
                    <Text fontSize="xs" color="fg.muted">/5 · {report.grade}</Text>
                  </HStack>
                </HStack>

                <VStack align="stretch" gap={1.5}>
                  {report.categories.filter((c) => c.assessed || c.weight > 0).map((c) => (
                    <HStack key={c.category} justify="space-between" fontSize="xs">
                      <Text color="fg.muted">{CATEGORY_LABEL[c.category]}</Text>
                      {c.assessed && c.score !== null ? (
                        <HStack gap={2}>
                          <Box w="90px" h="5px" bg="bg.muted" borderRadius="full" overflow="hidden">
                            <Box h="full" w={`${(c.score / 5) * 100}%`} bg={scoreColor(c.score)} />
                          </Box>
                          <Text fontFamily="mono" color="fg.default" minW="26px" textAlign="right">{c.score}</Text>
                        </HStack>
                      ) : (
                        <Text color="fg.subtle" fontStyle="italic">not scored · run visual review</Text>
                      )}
                    </HStack>
                  ))}
                </VStack>

                {HAS_LLM(fileType) && (
                  <Button
                    aria-label="Run visual review with the LLM judge"
                    size="xs"
                    variant="subtle"
                    onClick={runJudge}
                    disabled={judging}
                  >
                    {judging ? <Spinner size="xs" /> : <Icon as={LuScanEye} />}
                    <Text>{llmRan ? 'Re-run visual review' : 'Run visual review'}</Text>
                  </Button>
                )}

                {shot && (
                  <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden" bg="bg.subtle">
                    <Text fontSize="2xs" color="fg.subtle" px={2} py={1}>Reviewed image</Text>
                    <Image src={shot} alt="Rendered file reviewed by the judge" w="100%" maxH="200px" objectFit="contain" objectPosition="top" />
                  </Box>
                )}

                {judgeError && (
                  <Text fontSize="2xs" color="accent.danger">Visual review failed: {judgeError}</Text>
                )}

                {HAS_LLM(fileType) && !llmRan && (
                  <Text
                    aria-label="Structural checks only — run visual review to add visual checks"
                    fontSize="2xs"
                    color="fg.subtle"
                    fontStyle="italic"
                  >
                    * Structural checks only (from file content). Run visual review to add the visual checks.
                  </Text>
                )}

                <Table.Root size="sm" css={{ '& td, & th': { borderColor: 'border.muted' } }}>
                  <Table.Header>
                    <Table.Row bg="transparent">
                      <Table.ColumnHeader px={0} py={1} fontSize="2xs" color="fg.subtle" fontWeight="600">Level</Table.ColumnHeader>
                      <Table.ColumnHeader px={2} py={1} fontSize="2xs" color="fg.subtle" fontWeight="600">Category</Table.ColumnHeader>
                      <Table.ColumnHeader px={2} py={1} fontSize="2xs" color="fg.subtle" fontWeight="600">By</Table.ColumnHeader>
                      <Table.ColumnHeader px={0} py={1} fontSize="2xs" color="fg.subtle" fontWeight="600">Check</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((row) => (
                      <Table.Row key={row.key} bg="transparent">
                        <Table.Cell px={0} py={1.5} verticalAlign="top"><LevelTag level={row.level} /></Table.Cell>
                        <Table.Cell px={2} py={1.5} verticalAlign="top">
                          <Text fontSize="2xs" color="fg.muted" whiteSpace="nowrap">{CATEGORY_LABEL[row.category]}</Text>
                        </Table.Cell>
                        <Table.Cell px={2} py={1.5} verticalAlign="top">
                          <Text fontSize="2xs" fontWeight="600" color={SOURCE[row.source].color} whiteSpace="nowrap">{SOURCE[row.source].label}</Text>
                        </Table.Cell>
                        <Table.Cell px={0} py={1.5}>
                          <Text fontSize="xs" fontWeight="600" color={row.level === 'pass' ? 'fg.muted' : 'fg.default'}>{row.title}</Text>
                          {row.detail && <Text fontSize="2xs" color="fg.muted" mt={0.5}>{row.detail}</Text>}
                          {row.fix && <Text fontSize="2xs" color="fg.subtle" mt={0.5}><Text as="span" fontWeight="700">Fix: </Text>{row.fix}</Text>}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </VStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
      </Popover.Root>
      <Box
        as="button"
        aria-label="Refresh file health"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        cursor="pointer"
        px={1}
        py={0.5}
        borderLeft="1px solid"
        borderColor="border.default"
        bg="transparent"
        _hover={{ bg: 'bg.muted' }}
        onClick={refresh}
      >
        <Icon as={LuRefreshCw} boxSize={2.5} color="fg.muted" />
      </Box>
      </HStack>
    </>
  );
}
