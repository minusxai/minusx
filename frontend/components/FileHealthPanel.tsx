'use client';

/**
 * Lighthouse-style file health badge + panel. Computes the deterministic rubric client-side
 * from the file's (merged, live-edited) content — instant, no fetch — and can run the LLM
 * visual judge on demand (POST /api/files/[id]/rubric with a captured screenshot).
 *
 * See `frontend/docs/rubrik.md`. Rendered in the shared FileHeader badge row for
 * question/dashboard/story files; renders nothing for other types.
 */
import { useMemo, useState } from 'react';
import { Box, HStack, VStack, Text, Icon, Popover, Portal, Button, Spinner } from '@chakra-ui/react';
import { LuHeartPulse, LuCircleAlert, LuTriangleAlert, LuInfo, LuSparkles } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent } from '@/store/filesSlice';
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
  const content = useAppSelector((s) => selectMergedContent(s, fileId));
  const [judgeReport, setJudgeReport] = useState<RubricReport | null>(null);
  const [judging, setJudging] = useState(false);
  const { captureFileView, blobToDataURL } = useScreenshot();

  const deterministic = useMemo<RubricReport | null>(() => {
    if (!isRubricFileType(fileType) || !content) return null;
    try {
      return scoreFileDeterministic(fileType, content);
    } catch {
      return null;
    }
  }, [fileType, content]);

  const report = judgeReport ?? deterministic;
  if (!report) return null;

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
      if (json?.data?.report) setJudgeReport(json.data.report as RubricReport);
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
    <Popover.Root
      positioning={{ placement: 'bottom-start' }}
      onOpenChange={(e) => { if (e.open && AUTO_RUN_VISUAL_REVIEW && !judgeReport && !judging) void runJudge(); }}
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
          <HStack gap={1} fontFamily="mono" fontSize="2xs" fontWeight="600">
            <Box w={2} h={2} borderRadius="full" bg={gradeColor} />
            <Text color="fg.default">{report.overall}</Text>
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
                      <HStack gap={2}>
                        <Box w="90px" h="5px" bg="bg.muted" borderRadius="full" overflow="hidden">
                          <Box h="full" w={`${(c.score / 5) * 100}%`} bg={scoreColor(c.score)} />
                        </Box>
                        <Text fontFamily="mono" color="fg.default" minW="26px" textAlign="right">{c.score}</Text>
                      </HStack>
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
