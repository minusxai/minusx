'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  LuBellRing,
  LuCircleAlert,
  LuCircleCheck,
  LuDatabase,
  LuFileText,
  LuLayoutDashboard,
  LuListChecks,
  LuMapPinned,
  LuNotebook,
  LuScanSearch,
  LuScrollText,
  LuSparkles,
} from 'react-icons/lu';

import { cn } from '@/components/kit/cn';
import { useConfigs } from '@/lib/hooks/useConfigs';

/**
 * Shared "new / empty file" hero used by Story, Question and Dashboard views. Each blank file is
 * conceptually a blank canvas, so we lean into that: a small tilted tile that visibly assembles
 * itself, sitting in a soft atmospheric glow, tinted with the file type's own accent color (from
 * `file-metadata.ts`). Pure CSS, theme-token driven, dark/light aware. One orchestrated entrance
 * (staggered fade-up) rather than scattered micro-interactions.
 */

// Accent hexes (theme accent.* equivalents, post-Chakra).
const ACCENT = {
  sun: '#d35400',
  primary: '#2980b9',
  secondary: '#9b59b6',
  danger: '#c0392b',
  warning: '#f39c12',
  teal: '#16a085',
} as const;

// Keyframes for the hero's orchestrated entrance. Injected via a <style> tag so
// this stays self-contained (the old Chakra `css` prop defined them inline too).
const KEYFRAMES_CSS = `
@keyframes mx-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes mx-glow { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.9; } }
@keyframes mx-float { 0%, 100% { transform: rotate(-4deg) translateY(0); } 50% { transform: rotate(-4deg) translateY(-7px); } }
@keyframes mx-drawx { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes mx-growy { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes mx-pop { from { opacity: 0; transform: scale(0.55); } to { opacity: 1; transform: scale(1); } }
`;

interface HeroProps {
  ariaLabel: string;
  /** Accent hex color for this file type, e.g. ACCENT.primary. */
  accent: string;
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  /** The self-animating tile shown above the copy (compose with HeroTile). */
  illustration: ReactNode;
  /** Optional CTA row rendered between the description and the pro-tip (e.g. action buttons). */
  actions?: ReactNode;
  /** Optional pro-tip chip content. */
  tip?: ReactNode;
  compact?: boolean;
}

function EmptyFileHero({ ariaLabel, accent, eyebrow, title, description, illustration, actions, tip, compact = false }: HeroProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        'relative flex w-full flex-1 flex-col items-center justify-center overflow-hidden',
        compact ? 'min-h-[340px] px-6 py-5' : 'min-h-[460px] px-10 py-10',
      )}
      style={{ '--mx-accent': accent } as CSSProperties}
    >
      <style>{KEYFRAMES_CSS}</style>
      {/* Atmosphere: accent-tinted radial glow + faint dotted grid, both edge-masked so they dissolve. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at center, color-mix(in srgb, ${accent} 16%, transparent), transparent 62%)`,
          animation: 'mx-glow 5s ease-in-out infinite',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)',
        }}
      />

      {illustration}

      <p
        className="mb-2.5 font-mono text-xs font-semibold uppercase tracking-[0.22em]"
        style={{ color: accent, animation: 'mx-rise 0.5s ease-out 0.7s both' }}
      >
        {eyebrow}
      </p>
      <p
        className={cn(
          'text-center font-bold leading-[1.2] tracking-[-0.02em] text-foreground',
          compact ? 'text-xl' : 'text-2xl',
        )}
        style={{ animation: 'mx-rise 0.5s ease-out 0.8s both' }}
      >
        {title}
      </p>
      <p
        className={cn(
          'max-w-[400px] text-center text-sm leading-[1.6] text-muted-foreground',
          compact ? 'mt-2' : 'mt-3',
        )}
        style={{ animation: 'mx-rise 0.5s ease-out 0.9s both' }}
      >
        {description}
      </p>
      {actions && (
        <div className={compact ? 'mt-5' : 'mt-6'} style={{ animation: 'mx-rise 0.5s ease-out 1s both' }}>
          {actions}
        </div>
      )}
      {tip && (
        <div
          className={cn(
            'mt-6 inline-flex items-start gap-2 rounded-full border border-border bg-card px-3.5 py-2 shadow-sm',
            'text-muted-foreground transition-[border-color,color] duration-200 hover:border-(--mx-accent) hover:text-foreground',
            compact ? 'max-w-[640px]' : 'max-w-[720px]',
          )}
          style={{ animation: 'mx-rise 0.5s ease-out 1.05s both' }}
        >
          <div className="flex shrink-0 pt-px" style={{ color: accent }}>
            <LuSparkles size={14} strokeWidth={2} />
          </div>
          <p className="text-xs leading-[1.45] [text-wrap:pretty]">{tip}</p>
        </div>
      )}
    </div>
  );
}

/** The shared tilted card: a shadow page behind, a foreground page holding `children`, and a corner badge glyph. */
function HeroTile({ accent, badge, children, compact = false, height }: { accent: string; badge: ReactNode; children: ReactNode; compact?: boolean; height?: string }) {
  return (
    <div
      aria-hidden
      className={cn('relative', compact ? 'mb-5 w-[156px]' : 'mb-9 w-[184px]')}
      style={{
        height: height ?? (compact ? '190px' : '224px'),
        animation: 'mx-rise 0.5s ease-out both, mx-float 6s ease-in-out 0.5s infinite',
      }}
    >
      <div className="absolute inset-0 rotate-[5deg] rounded-lg border border-border/60 bg-card opacity-45" />
      <div
        className={cn(
          'absolute inset-0 flex rotate-[-4deg] flex-col rounded-lg border border-border bg-card shadow-xl',
          compact ? 'gap-2 p-4' : 'gap-2.5 p-5',
        )}
      >
        {children}
      </div>
      <div
        className={cn(
          'absolute flex items-center justify-center rounded-full border border-border bg-background shadow-md',
          compact ? 'right-[-10px] bottom-[-10px] h-[38px] w-[38px]' : 'right-[-14px] bottom-[-14px] h-[46px] w-[46px]',
        )}
        style={{ color: accent, animation: 'mx-rise 0.5s ease-out 1.3s both' }}
      >
        {badge}
      </div>
    </div>
  );
}

function useAgentName() {
  const { config } = useConfigs();
  return config.branding?.agentName ?? 'the agent';
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
    <HeroTile accent={ACCENT.sun} badge={<LuScrollText size={22} strokeWidth={1.75} />}>
      <div
        className="h-[7px] w-[34%] origin-left rounded-full bg-[#d35400]"
        style={{ animation: 'mx-drawx 0.45s ease-out 0.55s both' }}
      />
      <div
        className="h-[14px] w-[86%] origin-left rounded-sm bg-border"
        style={{ animation: 'mx-drawx 0.45s ease-out 0.64s both' }}
      />
      {lines.slice(0, 2).map((line, i) => (
        <div
          key={i}
          className="h-[6px] origin-left rounded-full bg-border"
          style={{ width: line.w, animation: `mx-drawx 0.4s ease-out ${line.d} both` }}
        />
      ))}
      <div
        className="mt-1 grid grid-cols-[0.72fr_1fr] items-stretch gap-2"
        style={{ animation: 'mx-pop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) 0.98s both' }}
      >
        <div className="rounded-md border border-border/60 bg-background p-2">
          <div className="mb-1.5 h-[10px] w-[76%] rounded-full bg-[#d35400]" />
          <div className="h-[5px] w-[52%] rounded-full bg-border" />
        </div>
        <div className="relative min-h-[48px] overflow-hidden rounded-md border border-border/60 bg-background text-[#d35400]">
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
        </div>
      </div>
      {lines.slice(2).map((line, i) => (
        <div
          key={i}
          className="h-[6px] origin-left rounded-full bg-border"
          style={{ width: line.w, animation: `mx-drawx 0.4s ease-out ${line.d} both` }}
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
      accent={ACCENT.sun}
      eyebrow="Story"
      title={<>Let&rsquo;s tell a great story</>}
      description={<>Ask {agentName} to spin one up. It weaves your narrative, charts, and headline numbers into a single scrolling page.</>}
      illustration={<StoryTile />}
      tip={
        <>
          <span className="font-bold text-[#d35400]">Pro tip:</span>{' '}
          <span className="font-mono">@</span>tag your dashboards and {agentName} weaves them into a story.
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
    <HeroTile accent={ACCENT.primary} badge={<LuScanSearch size={22} strokeWidth={1.75} />}>
      {/* Two query lines: an accent keyword then the rest of the statement. */}
      <div className="flex items-center gap-1.5">
        <div className="h-[7px] w-[26%] origin-left rounded-full bg-[#2980b9]" style={{ animation: 'mx-drawx 0.4s ease-out 0.55s both' }} />
        <div className="h-[7px] flex-1 origin-left rounded-full bg-border" style={{ animation: 'mx-drawx 0.4s ease-out 0.63s both' }} />
      </div>
      <div className="h-[7px] w-[80%] origin-left rounded-full bg-border" style={{ animation: 'mx-drawx 0.4s ease-out 0.71s both' }} />
      <div className="my-1 h-px w-full bg-border/60" />
      {/* Line-chart result. */}
      <div className="relative mt-1 flex-1 text-[#2980b9]">
        {/* Axes. */}
        <div className="absolute inset-y-0 left-0 w-[1.5px] bg-border/60" />
        <div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-border/60" />
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
          <div
            key={i}
            className="absolute z-[2] -ml-[3px] -mt-[3px] h-[6px] w-[6px] rounded-full border-[1.5px] border-[#2980b9] bg-card"
            style={{ left: `${p.x}%`, top: `${p.y}%`, animation: `mx-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) ${p.d} both` }}
          />
        ))}
      </div>
    </HeroTile>
  );
}

export function QuestionEmptyState() {
  const agentName = useAgentName();
  return (
    <EmptyFileHero
      ariaLabel="No query yet"
      accent={ACCENT.primary}
      eyebrow="Question"
      title={<>Let&rsquo;s find some answers!</>}
      description={<>Write SQL in the editor, or just ask {agentName} in plain English. It&rsquo;ll write the query, run it, and pick the perfect chart.</>}
      illustration={<QuestionTile />}
      tip={
        <>
          <span className="font-bold text-[#2980b9]">Pro tip:</span>{' '}
          <span className="font-mono">@</span>tag a table to focus on specific tables/columns.
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
    <HeroTile accent={ACCENT.danger} badge={<LuLayoutDashboard size={20} strokeWidth={1.75} />} compact>
      <div className="h-[8px] w-[48%] origin-left rounded-full bg-[#c0392b]" style={{ animation: 'mx-drawx 0.4s ease-out 0.55s both' }} />
      <div className="mt-1 grid flex-1 grid-cols-2 grid-rows-2 gap-2">
        {tiles.map((tile, i) => (
          <div
            key={i}
            className="flex items-end gap-1 rounded-md border border-border/60 bg-background p-1.5"
            style={{ animation: `mx-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${tile.d} both` }}
          >
            {tile.kind === 'area' && (
              <div className="relative h-[72%] w-full text-[#c0392b]">
                <div className="absolute inset-x-0 bottom-0 h-px bg-border/60" />
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
              </div>
            )}
            {tile.kind === 'bar' && (
              <div className="flex h-[76%] w-full items-end gap-[4px]">
                {[
                  { h: '42%', c: 'bg-border' },
                  { h: '76%', c: 'bg-[#c0392b]' },
                  { h: '58%', c: 'bg-border' },
                  { h: '92%', c: 'bg-[#c0392b]' },
                ].map((bar, barIndex) => (
                  <div
                    key={barIndex}
                    className={cn('flex-1 rounded-t-[2px]', bar.c)}
                    style={{ height: bar.h }}
                  />
                ))}
              </div>
            )}
            {tile.kind === 'map' && (
              <div className="relative h-full w-full overflow-hidden text-[#c0392b]">
                <div className="absolute inset-0 rounded-sm border border-border/60 opacity-75" />
                <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-[#c0392b]">
                  <LuMapPinned size={18} strokeWidth={1.8} />
                </div>
              </div>
            )}
            {tile.kind === 'table' && (
              <div className="grid h-full w-full grid-rows-[0.8fr_repeat(3,1fr)] gap-[3px]">
                {Array.from({ length: 4 }).map((_, row) => (
                  <div key={row} className="grid grid-cols-[1.25fr_1fr_0.75fr] gap-[3px]">
                    {Array.from({ length: 3 }).map((__, col) => (
                      <div
                        key={col}
                        className={cn(
                          'rounded-[2px]',
                          row === 0 ? 'bg-[#c0392b] opacity-95' : col === 1 && row === 2 ? 'bg-border opacity-75' : 'bg-border/60 opacity-70',
                        )}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </HeroTile>
  );
}

export function DashboardEmptyState() {
  const agentName = useAgentName();
  return (
    <EmptyFileHero
      ariaLabel="Empty dashboard"
      accent={ACCENT.danger}
      eyebrow="Dashboard"
      title={<>Let&rsquo;s build your dashboard</>}
      description={<>Add questions to lay out your dashboard, or just ask {agentName} to assemble one for you.</>}
      illustration={<DashboardTile />}
      tip={
        <>
          <span className="font-bold text-[#c0392b]">Pro tip:</span>{' '}
          <span className="font-mono">@</span>tag questions and {agentName} can arrange them into a dashboard.
        </>
      }
      compact
    />
  );
}

/* ---------------------------------- Alert ---------------------------------- */

/** An alert's checklist of tests assembling itself, watched by a bell badge. Each row is a discrete
 *  check with a pass/fail status that pops into place. Deliberately short. */
function AlertTile() {
  const rows = [
    { icon: LuCircleCheck, color: ACCENT.teal, width: '70%', d: '0.7s' },
    { icon: LuCircleAlert, color: ACCENT.warning, width: '82%', d: '0.82s' },
  ];
  return (
    <HeroTile accent={ACCENT.secondary} badge={<LuBellRing size={20} strokeWidth={1.75} />} compact height="108px">
      {/* Header: a checklist glyph + the alert's title. */}
      <div className="flex items-center gap-2">
        <div className="flex text-[#9b59b6]"><LuListChecks size={13} strokeWidth={1.9} /></div>
        <div className="h-[6px] max-w-[60px] flex-1 origin-left rounded-full bg-border" style={{ animation: 'mx-drawx 0.4s ease-out 0.55s both' }} />
      </div>
      {/* Test rows, each a discrete check with a pass/fail status. */}
      <div className="flex flex-1 flex-col justify-center gap-[6px]">
        {rows.map((row, index) => {
          const Icon = row.icon;
          return (
            <div
              key={index}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-[7px] py-[5px]"
              style={{ animation: `mx-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${row.d} both` }}
            >
              <div className="flex" style={{ color: row.color }}><Icon size={12} strokeWidth={2} /></div>
              <div className="h-[5px] flex-1 rounded-full bg-border/60" style={{ maxWidth: row.width }} />
            </div>
          );
        })}
      </div>
    </HeroTile>
  );
}

export function AlertHistoryEmptyState({ message }: { message: string }) {
  const agentName = useAgentName();
  return (
    <EmptyFileHero
      ariaLabel="No alert checks"
      accent={ACCENT.secondary}
      eyebrow="Alert"
      title={<>Let&rsquo;s catch issues early</>}
      description={message}
      illustration={<AlertTile />}
      tip={
        <>
          <span className="font-bold text-[#9b59b6]">Pro tip:</span>{' '}
          <span className="font-mono">@</span>tag a question and {agentName} sets up an alert that watches it.
        </>
      }
      compact
    />
  );
}

/* -------------------------------- Notebook --------------------------------- */

/** A notebook page assembling itself: a SQL cell (query line → drawn line-chart) stacked above a
 *  text cell (prose lines). Two distinct cells = the essence of a notebook. */
function NotebookTile() {
  return (
    <HeroTile accent={ACCENT.warning} badge={<LuNotebook size={20} strokeWidth={1.75} />} compact>
      {/* SQL cell — database glyph, a query line, then a mini area-chart result. */}
      <div
        className="flex flex-1 flex-col gap-1.5 rounded-md border border-border/60 bg-background p-2"
        style={{ animation: 'mx-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.62s both' }}
      >
        <div className="flex items-center gap-1.5">
          <div className="flex text-[#f39c12]"><LuDatabase size={12} strokeWidth={1.9} /></div>
          <div className="h-[6px] max-w-[58px] flex-1 origin-left rounded-full bg-border" style={{ animation: 'mx-drawx 0.4s ease-out 0.8s both' }} />
        </div>
        <div className="relative min-h-[30px] flex-1 text-[#f39c12]">
          <div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-border/60" />
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d="M3 80 L24 58 L46 66 L68 32 L97 16 L97 100 L3 100 Z"
              fill="currentColor"
              fillOpacity={0.16}
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points="3,80 24,58 46,66 68,32 97,16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>
      {/* Text cell — a prose glyph and two narrative lines. */}
      <div
        className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-background p-2"
        style={{ animation: 'mx-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.92s both' }}
      >
        <div className="flex items-center gap-1.5">
          <div className="flex text-muted-foreground"><LuFileText size={12} strokeWidth={1.9} /></div>
          <div className="h-[6px] max-w-[70px] flex-1 origin-left rounded-full bg-border" style={{ animation: 'mx-drawx 0.4s ease-out 1.08s both' }} />
        </div>
        <div className="h-[5px] w-[86%] origin-left rounded-full bg-border/60" style={{ animation: 'mx-drawx 0.4s ease-out 1.16s both' }} />
      </div>
    </HeroTile>
  );
}

export function NotebookEmptyState({ actions }: { actions?: ReactNode }) {
  const agentName = useAgentName();
  return (
    <EmptyFileHero
      ariaLabel="Empty notebook"
      accent={ACCENT.warning}
      eyebrow="Notebook"
      title={<>Let&rsquo;s think it through, cell by cell</>}
      description={<>Mix SQL cells and rich text into one living document, or ask {agentName} to draft the whole analysis for you.</>}
      illustration={<NotebookTile />}
      actions={actions}
      tip={
        <>
          <span className="font-bold text-[#f39c12]">Pro tip:</span>{' '}
          <span className="font-mono">@</span>tag your tables and {agentName} fills the notebook with cells.
        </>
      }
    />
  );
}
