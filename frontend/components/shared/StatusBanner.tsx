'use client';

/**
 * StatusBanner
 * Live/Draft toggle + optional suppress-until control, shared by all scheduled
 * job file types: Alert, Report, Transformation, Context (evals).
 *
 * Suppress is always interactive — no editMode gate — so users can mute a live
 * alert without entering full edit mode.
 *
 * Clearing uses '' (empty string) rather than undefined so deepMerge in
 * editFile doesn't silently skip the update (it skips undefined, not '').
 */
import { HStack, Text, Switch, Box } from '@chakra-ui/react';
import type { CheckedChangeDetails } from '@zag-js/switch';
import { LuInfo, LuCirclePause } from 'react-icons/lu';

interface StatusBannerProps {
  status: 'live' | 'draft';
  /** Display name for the file type, e.g. "alert", "report" */
  label: string;
  /** Label for the manual-run action, e.g. "Run Now", "Check Now" */
  runLabel?: string;
  editMode?: boolean;
  onChange: (status: 'live' | 'draft') => void;
  /** ISO date "YYYY-MM-DD". When set and in the future, cron runs are skipped. */
  suppressUntil?: string;
  /** Called with a date string to suppress, or '' to clear. */
  onSuppressChange?: (value: string) => void;
}

function isSuppressActive(suppressUntil: string | undefined): boolean {
  if (!suppressUntil) return false;
  const end = new Date(suppressUntil);
  end.setHours(23, 59, 59, 999);
  return end >= new Date();
}

export function StatusBanner({
  status, label, runLabel = 'Run Now', editMode, onChange,
  suppressUntil, onSuppressChange,
}: StatusBannerProps) {
  const isLive = status === 'live';
  const suppressed = isSuppressActive(suppressUntil);

  const bannerBg = suppressed && isLive ? 'orange.subtle' : isLive ? 'green.subtle' : 'yellow.subtle';
  const bannerBorder = suppressed && isLive ? 'orange.muted' : isLive ? 'green.muted' : 'yellow.muted';
  const infoColor = suppressed && isLive
    ? 'var(--chakra-colors-orange-fg)'
    : isLive ? 'var(--chakra-colors-green-fg)' : 'var(--chakra-colors-yellow-fg)';
  const textColor = suppressed && isLive ? 'orange.fg' : isLive ? 'green.fg' : 'yellow.fg';

  // Parse as local date (not UTC) to avoid timezone-shifting the display by one day.
  // new Date('YYYY-MM-DD') is UTC midnight; new Date(y, m, d) is local midnight.
  const suppressedDisplay = (() => {
    if (!suppressUntil) return '';
    const [y, m, d] = suppressUntil.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  return (
    <HStack
      gap={3}
      px={4}
      py={2}
      bg={bannerBg}
      borderBottomWidth="1px"
      borderColor={bannerBorder}
      borderRadius="md"
    >
      <LuInfo size={14} color={infoColor} />

      <Text fontSize="xs" color={textColor} flex={1}>
        {suppressed && isLive
          ? `Suppressed until ${suppressedDisplay} — scheduled runs are paused.`
          : isLive
            ? `This ${label} is live. Scheduled runs will execute when the cron endpoint is triggered.`
            : `Draft mode — scheduled runs are disabled. Use ${runLabel} to test.`}
      </Text>

      {/* Live/Draft toggle */}
      <HStack gap={2} flexShrink={0}>
        <Box w="1px" h="3.5" bg={bannerBorder} />
        <Text fontSize="xs" fontWeight="600" color={textColor}>
          {isLive ? 'Live' : 'Draft'}
        </Text>
        <Switch.Root
          size="sm"
          checked={isLive}
          disabled={!editMode}
          onCheckedChange={(e: CheckedChangeDetails) => onChange(e.checked ? 'live' : 'draft')}
          colorPalette="green"
        >
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </HStack>

      {/* Suppress control — always interactive, no editMode gate */}
      {onSuppressChange && (
        <HStack gap={1.5} flexShrink={0}>
          <Box w="1px" h="3.5" bg={bannerBorder} />
          <LuCirclePause size={13} color={suppressed ? 'var(--chakra-colors-orange-fg)' : infoColor} />
          <Text fontSize="xs" color={suppressed ? 'orange.fg' : textColor} opacity={suppressed ? 1 : 0.8}>
            Suppress until
          </Text>
          {suppressed ? (
            <HStack gap={1}>
              <Text fontSize="xs" color="orange.fg" fontWeight="600">{suppressedDisplay}</Text>
              <button
                aria-label="Clear suppression"
                onClick={() => onSuppressChange('')}
                title="Clear suppression"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--chakra-colors-orange-fg)', fontSize: '14px', lineHeight: 1 }}
              >
                ×
              </button>
            </HStack>
          ) : (
            <input
              type="date"
              aria-label="Suppress until date"
              defaultValue={suppressUntil || ''}
              key={suppressUntil || 'none'}
              onBlur={(e) => onSuppressChange(e.target.value)}
              style={{
                fontSize: '11px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid currentColor',
                padding: '0 2px',
                width: '96px',
                colorScheme: 'dark',
                opacity: 0.8,
              }}
            />
          )}
        </HStack>
      )}
    </HStack>
  );
}
