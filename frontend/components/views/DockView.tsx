'use client';

import { Box, HStack, VStack, Text, IconButton, SimpleGrid } from '@chakra-ui/react';
import { LuLayoutDashboard, LuFileText, LuPresentation, LuTrash2, LuScanSearch, LuType, LuLayers, LuMaximize2 } from 'react-icons/lu';
import { useMemo } from 'react';
import { AssetReference, InlineAsset, DashboardLayoutItem, DeckSlide } from '@/lib/types';
import { useAppSelector } from '@/store/hooks';
import { Tooltip } from '@/components/ui/tooltip';
import SmartEmbeddedQuestionContainer from '../containers/SmartEmbeddedQuestionContainer';

/**
 * DockView — the master asset repository ("dock").
 *
 * Renders every asset on the document as a card, independent of any single
 * view's layout. Each card shows which of the three views (Dashboard / Report /
 * Presentation) the asset currently appears in.
 *
 * Membership is *derived* (read-only) from the document's real view data:
 *   - Dashboard:    the asset key appears in `layout.items`
 *   - Report:       a `:::chart{id=N}` embed for the question exists in `report`
 *   - Presentation: the asset id appears in some `deck` slide's items
 */

type ViewKey = 'dashboard' | 'report' | 'presentation';

const VIEW_META: Record<ViewKey, { label: string; icon: typeof LuLayoutDashboard; color: string }> = {
  dashboard: { label: 'Dashboard', icon: LuLayoutDashboard, color: 'accent.primary' },
  report: { label: 'Report', icon: LuFileText, color: 'accent.cyan' },
  presentation: { label: 'Present', icon: LuPresentation, color: 'accent.teal' },
};

/** Stable key for an asset (matches the layout key used elsewhere). */
const assetKey = (asset: AssetReference): string =>
  asset.type === 'question' ? String((asset as { id: number }).id) : (asset as InlineAsset).id || '';

interface DockViewProps {
  assets: AssetReference[];
  /** Dashboard grid layout — its `items` determine dashboard membership. */
  layout?: { items?: DashboardLayoutItem[] } | null;
  /** Report markdown — `:::chart{id=N}` embeds determine report membership. */
  report?: string | null;
  /** Presentation deck — slide items determine presentation membership. */
  deck?: DeckSlide[] | null;
  onRemoveAsset: (key: string) => void;
  onOpenQuestion?: (questionId: number) => void;
}

export default function DockView({ assets, layout, report, deck, onRemoveAsset, onOpenQuestion }: DockViewProps) {
  // Derive per-view membership (read-only) from the document's real view data.
  const membershipFor = useMemo(() => {
    const inDashboard = new Set((layout?.items ?? []).map(i => String(i.id)));
    const inPresentation = new Set((deck ?? []).flatMap(s => (s.items ?? []).map(i => String(i.id))));
    // Report embeds questions by id as `:::chart{id=N}`; text isn't a pooled ref there.
    const reportIds = new Set<string>();
    if (report) {
      for (const m of report.matchAll(/:::chart\{id=(\d+)\}/g)) reportIds.add(m[1]);
    }
    return (key: string): Set<ViewKey> => {
      const set = new Set<ViewKey>();
      if (inDashboard.has(key)) set.add('dashboard');
      if (reportIds.has(key)) set.add('report');
      if (inPresentation.has(key)) set.add('presentation');
      return set;
    };
  }, [layout, report, deck]);

  // Only real assets (questions / text); dividers are layout sugar, not pool members.
  const dockAssets = useMemo(
    () => assets.filter(a => a.type === 'question' || a.type === 'text'),
    [assets],
  );

  return (
    <Box maxW="100%" pb={20}>
      {/* Header */}
      <HStack gap={2} mb={1} color="fg.muted">
        <LuLayers size={15} />
        <Text fontSize="sm" fontWeight={700} fontFamily="mono" textTransform="uppercase" letterSpacing="0.05em">
          Asset Dock
        </Text>
        <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
          {dockAssets.length.toString().padStart(2, '0')} assets
        </Text>
      </HStack>
      <Text fontSize="xs" color="fg.muted" mb={5} maxW="600px">
        The master repository of assets for this document. Each card shows which views the asset currently appears in.
      </Text>

      {dockAssets.length === 0 ? (
        <Box
          bg="bg.surface"
          p={12}
          borderRadius="lg"
          border="2px dashed"
          borderColor="border.muted"
          textAlign="center"
        >
          <Box mb={3} display="inline-block" opacity={0.3}>
            <LuLayers size={64} strokeWidth={1.5} />
          </Box>
          <Text fontSize="lg" fontWeight={700} color="fg.default">
            The dock is empty
          </Text>
          <Text fontSize="sm" color="fg.muted" mt={1}>
            Add questions or text to start building your story.
          </Text>
        </Box>
      ) : (
        <SimpleGrid columns={{ base: 2, sm: 3, md: 4, lg: 5, '2xl': 6 }} gap={2}>
          {dockAssets.map(asset => (
            <DockCard
              key={assetKey(asset)}
              asset={asset}
              membership={membershipFor(assetKey(asset))}
              onRemove={() => onRemoveAsset(assetKey(asset))}
              onOpen={asset.type === 'question' && onOpenQuestion
                ? () => onOpenQuestion((asset as { id: number }).id)
                : undefined}
            />
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}

interface DockCardProps {
  asset: AssetReference;
  membership: Set<ViewKey>;
  onRemove: () => void;
  onOpen?: () => void;
}

function DockCard({ asset, membership, onRemove, onOpen }: DockCardProps) {
  const isQuestion = asset.type === 'question';

  return (
    <VStack
      align="stretch"
      gap={0}
      bg="bg.surface"
      borderWidth="1px"
      borderColor="border.default"
      borderRadius="lg"
      overflow="hidden"
      transition="border-color 0.15s, box-shadow 0.15s"
      _hover={{ borderColor: 'border.emphasized', boxShadow: 'sm' }}
    >
      {/* Body — clickable to open the question (like clicking it on the dashboard) */}
      <Box
        {...(onOpen ? { role: 'button', tabIndex: 0, 'aria-label': 'Open question', onClick: onOpen } : {})}
        cursor={onOpen ? 'pointer' : 'default'}
        display="flex"
        flexDirection="column"
        flex={1}
        css={onOpen ? { '&:hover .dock-open-hint': { opacity: 1 } } : undefined}
        position="relative"
      >
        {onOpen && (
          <Box
            className="dock-open-hint"
            position="absolute"
            top={1.5}
            right={1.5}
            zIndex={1}
            opacity={0}
            transition="opacity 0.15s"
            color="fg.muted"
            bg="bg.surface/80"
            borderRadius="sm"
            p={0.5}
          >
            <LuMaximize2 size={11} />
          </Box>
        )}
        {isQuestion
          ? <QuestionCardBody questionId={(asset as { id: number }).id} />
          : (
            <Box flex={1} p={2.5} minH="100px">
              <TextCardBody content={(asset as InlineAsset).content || ''} />
            </Box>
          )}
      </Box>

      {/* Footer: view membership + remove */}
      <HStack
        gap={1}
        px={2}
        py={1.5}
        borderTopWidth="1px"
        borderColor="border.muted"
        bg="bg.subtle"
        justify="space-between"
      >
        <HStack gap={1.5}>
          {(Object.keys(VIEW_META) as ViewKey[]).map(view => (
            <ViewChip
              key={view}
              view={view}
              active={membership.has(view)}
            />
          ))}
        </HStack>
        <Tooltip content="Remove from dock">
          <IconButton
            onClick={onRemove}
            aria-label="Remove from dock"
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            _hover={{ color: 'accent.danger', bg: 'accent.danger/10' }}
          >
            <LuTrash2 size={13} />
          </IconButton>
        </Tooltip>
      </HStack>
    </VStack>
  );
}

function ViewChip({ view, active }: { view: ViewKey; active: boolean }) {
  const meta = VIEW_META[view];
  const Icon = meta.icon;
  return (
    <Tooltip content={`${active ? 'In' : 'Not in'} ${meta.label}`}>
      <Box
        aria-label={`${meta.label}: ${active ? 'included' : 'excluded'}`}
        display="flex"
        alignItems="center"
        justifyContent="center"
        w="20px"
        h="20px"
        borderRadius="md"
        borderWidth="1px"
        transition="all 0.12s"
        bg={active ? `${meta.color}/10` : 'transparent'}
        borderColor={active ? `${meta.color}/25` : 'border.muted'}
        color={active ? meta.color : 'fg.subtle'}
        opacity={active ? 1 : 0.4}
      >
        <Icon size={11} />
      </Box>
    </Tooltip>
  );
}

function QuestionCardBody({ questionId }: { questionId: number }) {
  const file = useAppSelector(state => state.files.files[questionId]);
  const name = file?.name || 'Untitled Question';

  return (
    <VStack align="stretch" gap={0} flex={1}>
      {/* Tiny title */}
      <HStack gap={1.5} align="center" px={2.5} pt={2} pb={1}>
        <Box color="accent.primary" flexShrink={0}>
          <LuScanSearch size={12} />
        </Box>
        <Text fontSize="2xs" fontWeight={600} color="fg.default" lineClamp={1} title={name} fontFamily="mono">
          {name}
        </Text>
      </HStack>

      {/* Live mini chart — rendered full-size, then scaled down (like the agent
          turn thumbnails) so proportions stay clean instead of cramming axes. */}
      <Box height="120px" overflow="hidden" position="relative" pointerEvents="none">
        <Box
          width="200%"           /* 100 / scale */
          height="240px"         /* thumb height / scale */
          transform="scale(0.5)"
          transformOrigin="top left"
          css={{ '& > div': { height: '100%' } }}
        >
          <SmartEmbeddedQuestionContainer questionId={questionId} showTitle={false} />
        </Box>
      </Box>
    </VStack>
  );
}

function TextCardBody({ content }: { content: string }) {
  // Cheap markdown-ish strip for a preview.
  const preview = content
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>#-]/g, '')
    .trim()
    .slice(0, 160) || 'Empty text block';

  return (
    <HStack gap={1.5} align="flex-start" height="100%">
      <Box color="accent.secondary" mt={0.5} flexShrink={0}>
        <LuType size={13} />
      </Box>
      <Text fontSize="xs" color="fg.muted" lineClamp={3}>
        {preview}
      </Text>
    </HStack>
  );
}
