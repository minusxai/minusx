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
import { Box, HStack, VStack, Text, Icon, IconButton, Popover, Portal, Button, Spinner } from '@chakra-ui/react';
import { LuHeartPulse, LuCircleAlert, LuTriangleAlert, LuInfo, LuSparkles, LuRefreshCw } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { useAppSelector, useAppStore } from '@/store/hooks';
import { selectFile, selectMergedContent } from '@/store/filesSlice';
import { useScreenshot } from '@/lib/hooks/useScreenshot';
import { isRubricFileType, scoreFileDeterministic } from '@/lib/rubric/registry';
import type { RubricCategory, RubricFinding, RubricReport, RubricSeverity } from '@/lib/rubric/types';

/**
 * Door for piece 3: when true, opening the panel auto-runs the combined visual review (a
 * screenshot capture + judge LLM call) instead of waiting for the "Run visual review" click.
 * Off by default — each open would otherwise cost an LLM call. Flip to true to always show the
 * combined total on open.
 */
const AUTO_RUN_VISUAL_REVIEW = false;

const GRADE_COLOR: Record<string, string> = { good: 'accent.success', fair: 'accent.warning', poor: 'accent.danger' };
const SEVERITY: Record<RubricSeverity, { color: string; icon: IconType }> = {
  error: { color: 'accent.danger', icon: LuCircleAlert },
  warn: { color: 'accent.warning', icon: LuTriangleAlert },
  info: { color: 'fg.muted', icon: LuInfo },
};
const CATEGORY_LABEL: Record<RubricCategory, string> = {
  correctness: 'Correctness', clarity: 'Clarity', aesthetics: 'Aesthetics',
};
const SEVERITY_ORDER: Record<RubricSeverity, number> = { error: 0, warn: 1, info: 2 };

function scoreColor(score: number): string {
  if (score >= 4) return 'accent.success';
  if (score >= 2.5) return 'accent.warning';
  return 'accent.danger';
}

export function FileHealthBadge({ fileId, fileType }: { fileId: number; fileType: string }) {
  // Score the SAVED content, not live edits — so this recomputes on save/load, NOT on every
  // keypress (which re-parsed stories on each stroke and froze the header). The refresh button
  // re-runs against the current unsaved edits on demand.
  const savedContent = useAppSelector((s) => selectFile(s, fileId)?.content);
  const store = useAppStore();
  const [override, setOverride] = useState<RubricReport | null>(null); // manual refresh or judge result
  const [judging, setJudging] = useState(false);
  const { captureFileView, blobToDataURL } = useScreenshot();

  const deterministic = useMemo<RubricReport | null>(() => {
    if (!isRubricFileType(fileType) || !savedContent) return null;
    try {
      return scoreFileDeterministic(fileType, savedContent);
    } catch {
      return null;
    }
  }, [fileType, savedContent]);

  // A new save (or file load) invalidates any manual-refresh / judge override.
  useEffect(() => { setOverride(null); }, [savedContent]);

  const report = override ?? deterministic;
  if (!report) return null;

  // Re-run the deterministic scorer against the CURRENT (unsaved) merged content, on demand.
  const refresh = () => {
    if (!isRubricFileType(fileType)) return;
    const merged = selectMergedContent(store.getState(), fileId);
    if (!merged) return;
    try {
      setOverride(scoreFileDeterministic(fileType, merged));
    } catch {
      // ignore — keep the current report
    }
  };

  const runJudge = async () => {
    setJudging(true);
    try {
      const blob = await captureFileView(fileId, { fullHeight: true });
      const screenshot = await blobToDataURL(blob);
      const res = await fetch(`/api/files/${fileId}/rubric`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenshot }),
      });
      const json = await res.json().catch(() => null);
      if (json?.data?.report) setOverride(json.data.report as RubricReport);
    } catch {
      // best-effort — leave the deterministic report in place
    } finally {
      setJudging(false);
    }
  };

  const findings = report.categories
    .flatMap((c) => c.findings)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const gradeColor = GRADE_COLOR[report.grade];

  return (
    <HStack gap={0.5} flexShrink={0}>
      <style>{'@keyframes mxHealthPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.6); } }'}</style>
      <Popover.Root
      positioning={{ placement: 'bottom-start' }}
      onOpenChange={(e) => { if (e.open && AUTO_RUN_VISUAL_REVIEW && !override && !judging) void runJudge(); }}
    >
      <Popover.Trigger asChild>
        <Button
          aria-label={`File health: ${report.overall} of 5 (${report.grade})`}
          variant="plain"
          size="xs"
          h="auto"
          px={1.5}
          py={0.5}
          bg="bg.elevated"
          borderRadius="sm"
          border="1px solid"
          borderColor="border.default"
          flexShrink={0}
          _hover={{ bg: 'bg.muted' }}
        >
          <HStack gap={0} fontFamily="mono" fontSize="2xs" fontWeight="600">
            <Box
              w={2}
              h={2}
              mr={2}
              borderRadius="full"
              bg={gradeColor}
              style={{ animation: 'mxHealthPulse 1.6s ease-in-out infinite' }}
            />
            <Text color="fg.default">File Health: {report.overall}</Text>
            <Text color="fg.muted">/5</Text>
          </HStack>
        </Button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="360px" maxH="72vh" overflowY="auto">
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
                  {report.categories.map((c) => (
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

                {findings.length === 0 ? (
                  <Text fontSize="xs" color="fg.muted">No issues found — this file looks healthy.</Text>
                ) : (
                  <VStack align="stretch" gap={2}>
                    {findings.map((f, i) => <FindingRow key={`${f.ruleId}-${i}`} finding={f} />)}
                  </VStack>
                )}

                <Button
                  aria-label="Run visual review with the LLM judge"
                  size="xs"
                  variant="subtle"
                  onClick={runJudge}
                  disabled={judging}
                >
                  {judging ? <Spinner size="xs" /> : <Icon as={LuSparkles} />}
                  <Text>{report.source === 'deterministic' ? 'Run visual review' : 'Re-run visual review'}</Text>
                </Button>
              </VStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
      </Popover.Root>
      <IconButton
        aria-label="Refresh file health"
        size="xs"
        variant="ghost"
        h="auto"
        minW="auto"
        px={1}
        py={0.5}
        onClick={refresh}
      >
        <Icon as={LuRefreshCw} boxSize={3} />
      </IconButton>
    </HStack>
  );
}

function FindingRow({ finding }: { finding: RubricFinding }) {
  const sev = SEVERITY[finding.severity];
  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" p={2} bg="bg.subtle">
      <HStack gap={2} align="start">
        <Icon as={sev.icon} color={sev.color} mt="2px" flexShrink={0} />
        <VStack align="stretch" gap={0.5}>
          <Text fontSize="xs" fontWeight="600" color="fg.default">{finding.title}</Text>
          <Text fontSize="xs" color="fg.muted">{finding.detail}</Text>
          <Text fontSize="xs" color="fg.subtle"><Text as="span" fontWeight="600">Fix: </Text>{finding.fix}</Text>
        </VStack>
      </HStack>
    </Box>
  );
}
