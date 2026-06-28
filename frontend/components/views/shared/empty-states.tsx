'use client';

import type { ReactNode } from 'react';
import { Box, Text } from '@chakra-ui/react';
import { LuScrollText, LuScanSearch, LuLayoutDashboard, LuMapPinned, LuSparkles } from 'react-icons/lu';

import { useAppSelector } from '@/store/hooks';
import { selectBranding } from '@/store/configsSlice';

/**
 * Shared "new / empty file" hero used by Story, Question and Dashboard views. Each blank file is
 * conceptually a blank canvas, so we lean into that: a small tilted tile that visibly assembles
 * itself, sitting in a soft atmospheric glow, tinted with the file type's own accent color (from
 * `file-metadata.ts`). Pure CSS, theme-token driven, dark/light aware. One orchestrated entrance
 * (staggered fade-up) rather than scattered micro-interactions.
 */

const KEYFRAMES = {
  '@keyframes mx-rise': {
    from: { opacity: 0, transform: 'translateY(10px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  '@keyframes mx-glow': {
    '0%, 100%': { opacity: 0.55 },
    '50%': { opacity: 0.9 },
  },
  '@keyframes mx-float': {
    '0%, 100%': { transform: 'rotate(-4deg) translateY(0)' },
    '50%': { transform: 'rotate(-4deg) translateY(-7px)' },
  },
  '@keyframes mx-drawx': {
    from: { transform: 'scaleX(0)' },
    to: { transform: 'scaleX(1)' },
  },
  '@keyframes mx-growy': {
    from: { transform: 'scaleY(0)' },
    to: { transform: 'scaleY(1)' },
  },
  '@keyframes mx-pop': {
    from: { opacity: 0, transform: 'scale(0.55)' },
    to: { opacity: 1, transform: 'scale(1)' },
  },
};

interface HeroProps {
  ariaLabel: string;
  /** Theme color token for this file type, e.g. 'accent.primary'. */
  accent: string;
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  /** The self-animating tile shown above the copy (compose with HeroTile). */
  illustration: ReactNode;
  /** Optional pro-tip chip content. */
  tip?: ReactNode;
  compact?: boolean;
}

function EmptyFileHero({ ariaLabel, accent, eyebrow, title, description, illustration, tip, compact = false }: HeroProps) {
  const accentVar = `var(--chakra-colors-${accent.replace(/\./g, '-')})`;
  return (
    <Box
      aria-label={ariaLabel}
      position="relative"
      flex="1"
      w="100%"
      minH={compact ? '340px' : '460px'}
      overflow="hidden"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      px={compact ? 6 : 10}
      py={compact ? 5 : 10}
      css={KEYFRAMES}
    >
      {/* Atmosphere: accent-tinted radial glow + faint dotted grid, both edge-masked so they dissolve. */}
      <Box
        aria-hidden
        position="absolute"
        inset={0}
        pointerEvents="none"
        css={{
          backgroundImage: `radial-gradient(circle at center, color-mix(in srgb, ${accentVar} 16%, transparent), transparent 62%)`,
          animation: 'mx-glow 5s ease-in-out infinite',
        }}
      />
      <Box
        aria-hidden
        position="absolute"
        inset={0}
        pointerEvents="none"
        opacity={0.5}
        css={{
          backgroundImage: 'radial-gradient(var(--chakra-colors-border-default) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)',
        }}
      />

      {illustration}

      <Text
        css={{ animation: 'mx-rise 0.5s ease-out 0.7s both' }}
        fontFamily="mono"
        fontSize="xs"
        letterSpacing="0.22em"
        fontWeight={600}
        textTransform="uppercase"
        color={accent}
        mb={2.5}
      >
        {eyebrow}
      </Text>
      <Text
        css={{ animation: 'mx-rise 0.5s ease-out 0.8s both' }}
        fontSize={compact ? 'xl' : '2xl'}
        fontWeight={700}
        letterSpacing="-0.02em"
        color="fg.default"
        textAlign="center"
        lineHeight="1.2"
      >
        {title}
      </Text>
      <Text
        css={{ animation: 'mx-rise 0.5s ease-out 0.9s both' }}
        fontSize="sm"
        color="fg.muted"
        mt={compact ? 2 : 3}
        maxW="400px"
        textAlign="center"
        lineHeight="1.6"
      >
        {description}
      </Text>
      {tip && (
        <Box
          css={{ animation: 'mx-rise 0.5s ease-out 1.05s both' }}
          mt={6}
          display="inline-flex"
          alignItems="center"
          gap={2}
          px={3.5}
          py={2}
          borderRadius="full"
          bg="bg.surface"
          borderWidth="1px"
          borderColor="border.default"
          boxShadow="sm"
          color="fg.muted"
          _hover={{ borderColor: accent, color: 'fg.default' }}
          transition="border-color 0.2s, color 0.2s"
        >
          <Box color={accent} display="flex">
            <LuSparkles size={14} strokeWidth={2} />
          </Box>
          <Text fontSize="xs">{tip}</Text>
        </Box>
      )}
    </Box>
  );
}

/** The shared tilted card: a shadow page behind, a foreground page holding `children`, and a corner badge glyph. */
function HeroTile({ accent, badge, children, compact = false }: { accent: string; badge: ReactNode; children: ReactNode; compact?: boolean }) {
  return (
    <Box
      aria-hidden
      position="relative"
      w={compact ? '156px' : '184px'}
      h={compact ? '190px' : '224px'}
      mb={compact ? 5 : 9}
      css={{ animation: 'mx-rise 0.5s ease-out both, mx-float 6s ease-in-out 0.5s infinite' }}
    >
      <Box
        position="absolute"
        inset={0}
        transform="rotate(5deg)"
        bg="bg.surface"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        opacity={0.45}
      />
      <Box
        position="absolute"
        inset={0}
        transform="rotate(-4deg)"
        bg="bg.surface"
        borderWidth="1px"
        borderColor="border.default"
        borderRadius="lg"
        boxShadow="xl"
        p={compact ? 4 : 5}
        display="flex"
        flexDirection="column"
        gap={compact ? 2 : 2.5}
      >
        {children}
      </Box>
      <Box
        position="absolute"
        bottom={compact ? '-10px' : '-14px'}
        right={compact ? '-10px' : '-14px'}
        w={compact ? '38px' : '46px'}
        h={compact ? '38px' : '46px'}
        borderRadius="full"
        bg="bg.canvas"
        borderWidth="1px"
        borderColor="border.default"
        color={accent}
        boxShadow="md"
        display="flex"
        alignItems="center"
        justifyContent="center"
        css={{ animation: 'mx-rise 0.5s ease-out 1.3s both' }}
      >
        {badge}
      </Box>
    </Box>
  );
}

function useAgentName() {
  return useAppSelector(selectBranding)?.agentName ?? 'the agent';
}

/* ---------------------------------- Story ---------------------------------- */

/** Editorial page assembling itself: headline, narrative lines, a pull-number, then an embedded visual. */
function StoryTile() {
  const lines = [
    { w: '92%', d: '0.74s' },
    { w: '78%', d: '0.82s' },
    { w: '100%', d: '1.16s' },
    { w: '82%', d: '1.24s' },
  ];
  return (
    <HeroTile accent="accent.sun" badge={<LuScrollText size={22} strokeWidth={1.75} />}>
      <Box
        h="7px"
        w="34%"
        borderRadius="full"
        bg="accent.sun"
        transformOrigin="left"
        css={{ animation: 'mx-drawx 0.45s ease-out 0.55s both' }}
      />
      <Box
        h="14px"
        w="86%"
        borderRadius="sm"
        bg="border.emphasized"
        transformOrigin="left"
        css={{ animation: 'mx-drawx 0.45s ease-out 0.64s both' }}
      />
      {lines.slice(0, 2).map((line, i) => (
        <Box
          key={i}
          h="6px"
          w={line.w}
          borderRadius="full"
          bg="border.emphasized"
          transformOrigin="left"
          css={{ animation: `mx-drawx 0.4s ease-out ${line.d} both` }}
        />
      ))}
      <Box
        display="grid"
        gridTemplateColumns="0.72fr 1fr"
        gap={2}
        alignItems="stretch"
        mt={1}
        css={{ animation: 'mx-pop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) 0.98s both' }}
      >
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          bg="bg.canvas"
          p={2}
        >
          <Box h="10px" w="76%" borderRadius="full" bg="accent.sun" mb={1.5} />
          <Box h="5px" w="52%" borderRadius="full" bg="border.emphasized" />
        </Box>
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          bg="bg.canvas"
          position="relative"
          overflow="hidden"
          minH="48px"
          color="accent.sun"
        >
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d="M0 78 C16 62 28 70 44 50 S72 18 100 28 L100 100 L0 100 Z"
              fill="currentColor"
              fillOpacity={0.22}
            />
            <path
              d="M0 78 C16 62 28 70 44 50 S72 18 100 28"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </Box>
      </Box>
      {lines.slice(2).map((line, i) => (
        <Box
          key={i}
          h="6px"
          w={line.w}
          borderRadius="full"
          bg="border.emphasized"
          transformOrigin="left"
          css={{ animation: `mx-drawx 0.4s ease-out ${line.d} both` }}
        />
      ))}
    </HeroTile>
  );
}

export function StoryEmptyState() {
  const agentName = useAgentName();
  return (
    <EmptyFileHero
      ariaLabel="No story"
      accent="accent.sun"
      eyebrow="Data Story"
      title={<>Let&rsquo;s tell a great story</>}
      description={<>Ask {agentName} to spin one up. It weaves your narrative, charts, and headline numbers into a single scrolling page.</>}
      illustration={<StoryTile />}
      tip={
        <>
          <Box as="span" fontWeight={700} color="accent.sun">Pro tip:</Box>{' '}
          <Box as="span" fontFamily="mono">@</Box>tag your tables and {agentName} weaves them into a story.
        </>
      }
    />
  );
}

/* --------------------------------- Question -------------------------------- */

/** A result card scanning into focus: two SQL lines, a divider, then a line chart that draws left→right
 *  and joins its points. Points are in a 0–100 coordinate space (x grows right, y grows DOWN). */
const QUESTION_POINTS = [
  { x: 6, y: 74, d: '1.05s' },
  { x: 22, y: 52, d: '1.13s' },
  { x: 37, y: 60, d: '1.21s' },
  { x: 53, y: 32, d: '1.29s' },
  { x: 68, y: 42, d: '1.37s' },
  { x: 83, y: 16, d: '1.45s' },
];

function QuestionTile() {
  return (
    <HeroTile accent="accent.primary" badge={<LuScanSearch size={22} strokeWidth={1.75} />}>
      {/* Two query lines: an accent keyword then the rest of the statement. */}
      <Box display="flex" gap={1.5} alignItems="center">
        <Box h="7px" w="26%" borderRadius="full" bg="accent.primary" transformOrigin="left" css={{ animation: 'mx-drawx 0.4s ease-out 0.55s both' }} />
        <Box h="7px" flex="1" borderRadius="full" bg="border.emphasized" transformOrigin="left" css={{ animation: 'mx-drawx 0.4s ease-out 0.63s both' }} />
      </Box>
      <Box h="7px" w="80%" borderRadius="full" bg="border.emphasized" transformOrigin="left" css={{ animation: 'mx-drawx 0.4s ease-out 0.71s both' }} />
      <Box h="1px" w="100%" bg="border.muted" my={1} />
      {/* Line-chart result. */}
      <Box position="relative" flex="1" mt={1} color="accent.primary">
        {/* Axes. */}
        <Box position="absolute" left={0} bottom={0} top={0} w="1.5px" bg="border.muted" />
        <Box position="absolute" left={0} right={0} bottom={0} h="1.5px" bg="border.muted" />
        {/* The connecting line, drawn from the same coordinates used to place the vertices. */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 1,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
          }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polyline
            points={QUESTION_POINTS.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Vertices, popping in as the line reaches them. Centered on each point. */}
        {QUESTION_POINTS.map((p, i) => (
          <Box
            key={i}
            position="absolute"
            left={`${p.x}%`}
            top={`${p.y}%`}
            zIndex={2}
            ml="-3px"
            mt="-3px"
            w="6px"
            h="6px"
            borderRadius="full"
            bg="bg.surface"
            borderWidth="1.5px"
            borderColor="accent.primary"
            css={{ animation: `mx-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) ${p.d} both` }}
          />
        ))}
      </Box>
    </HeroTile>
  );
}

export function QuestionEmptyState() {
  const agentName = useAgentName();
  return (
    <EmptyFileHero
      ariaLabel="No query yet"
      accent="accent.primary"
      eyebrow="Question"
      title={<>Let&rsquo;s find some answers!</>}
      description={<>Write SQL in the editor, or just ask {agentName} in plain English. It&rsquo;ll write the query, run it, and pick the perfect chart.</>}
      illustration={<QuestionTile />}
      tip={
        <>
          <Box as="span" fontWeight={700} color="accent.primary">Pro tip:</Box>{' '}
          <Box as="span" fontFamily="mono">@</Box>tag a table to focus on specific tables/columns.
        </>
      }
    />
  );
}

/* -------------------------------- Dashboard -------------------------------- */

/** A board assembling itself: a header line, then four distinct BI surfaces: area, bar, table and map. */
function DashboardTile() {
  const tiles = [
    { d: '0.7s', kind: 'area' as const },
    { d: '0.8s', kind: 'bar' as const },
    { d: '0.9s', kind: 'table' as const },
    { d: '1.0s', kind: 'map' as const },
  ];
  return (
    <HeroTile accent="accent.danger" badge={<LuLayoutDashboard size={20} strokeWidth={1.75} />} compact>
      <Box h="8px" w="48%" borderRadius="full" bg="accent.danger" transformOrigin="left" css={{ animation: 'mx-drawx 0.4s ease-out 0.55s both' }} />
      <Box flex="1" mt={1} display="grid" gridTemplateColumns="1fr 1fr" gridTemplateRows="1fr 1fr" gap={2}>
        {tiles.map((tile, i) => (
          <Box
            key={i}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            bg="bg.canvas"
            p={1.5}
            display="flex"
            alignItems="flex-end"
            gap={1}
            css={{ animation: `mx-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${tile.d} both` }}
          >
            {tile.kind === 'area' && (
              <Box w="100%" h="72%" position="relative" color="accent.danger">
                <Box position="absolute" left={0} right={0} bottom={0} h="1px" bg="border.muted" />
                <svg
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path
                    d="M4 82 L22 68 L42 74 L62 42 L82 50 L96 24 L96 100 L4 100 Z"
                    fill="currentColor"
                    fillOpacity={0.16}
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points="4,82 22,68 42,74 62,42 82,50 96,24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </Box>
            )}
            {tile.kind === 'bar' && (
              <Box w="100%" h="76%" display="flex" alignItems="flex-end" gap="4px">
                {[
                  { h: '42%', c: 'border.emphasized' },
                  { h: '76%', c: 'accent.danger' },
                  { h: '58%', c: 'border.emphasized' },
                  { h: '92%', c: 'accent.danger' },
                ].map((bar, barIndex) => (
                  <Box
                    key={barIndex}
                    flex="1"
                    h={bar.h}
                    borderRadius="2px 2px 0 0"
                    bg={bar.c}
                  />
                ))}
              </Box>
            )}
            {tile.kind === 'map' && (
              <Box w="100%" h="100%" position="relative" color="accent.danger" overflow="hidden">
                <Box position="absolute" inset={0} borderWidth="1px" borderColor="border.muted" borderRadius="sm" opacity={0.75} />
                <Box
                  position="absolute"
                  left="50%"
                  top="50%"
                  transform="translate(-50%, -50%)"
                  color="accent.danger"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                >
                  <LuMapPinned size={18} strokeWidth={1.8} />
                </Box>
              </Box>
            )}
            {tile.kind === 'table' && (
              <Box w="100%" h="100%" display="grid" gridTemplateRows="0.8fr repeat(3, 1fr)" gap="3px">
                {Array.from({ length: 4 }).map((_, row) => (
                  <Box key={row} display="grid" gridTemplateColumns="1.25fr 1fr 0.75fr" gap="3px">
                    {Array.from({ length: 3 }).map((__, col) => (
                      <Box
                        key={col}
                        borderRadius="2px"
                        bg={row === 0 ? 'accent.danger' : col === 1 && row === 2 ? 'border.emphasized' : 'border.muted'}
                        opacity={row === 0 ? 0.95 : col === 1 && row === 2 ? 0.75 : 0.7}
                      />
                    ))}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </HeroTile>
  );
}

export function DashboardEmptyState() {
  const agentName = useAgentName();
  return (
    <EmptyFileHero
      ariaLabel="Empty dashboard"
      accent="accent.danger"
      eyebrow="Dashboard"
      title={<>Let&rsquo;s build your dashboard</>}
      description={<>Add questions to lay out your dashboard, or just ask {agentName} to assemble one for you.</>}
      illustration={<DashboardTile />}
      tip={
        <>
          <Box as="span" fontWeight={700} color="accent.danger">Pro tip:</Box>{' '}
          <Box as="span" fontFamily="mono">@</Box>tag questions and {agentName} can arrange them into a dashboard.
        </>
      }
      compact
    />
  );
}
