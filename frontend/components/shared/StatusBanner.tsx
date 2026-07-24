'use client';

/**
 * StatusBanner
 * Live/Draft toggle + optional suppress-until control, shared by all scheduled
 * job file types: Alert, Report, Context (evals).
 *
 * Suppress is always interactive — no editMode gate — so users can mute a live
 * alert without entering full edit mode.
 *
 * Clearing uses '' (empty string) rather than undefined so deepMerge in
 * editFile doesn't silently skip the update (it skips undefined, not '').
 */
import { Switch } from '@/components/kit/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/kit/tooltip';
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

const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// House tint scheme (ReportView/AlertView): green #2ecc71/#27ae60, yellow #f39c12, orange #e67e22
const GREEN = '#2ecc71';
const GREEN_FG = '#27ae60';
const YELLOW = '#f39c12';
const ORANGE = '#e67e22';

export function StatusBanner({
  status, label, runLabel = 'Run Now', editMode, onChange,
  suppressUntil, onSuppressChange,
}: StatusBannerProps) {
  const isLive = status === 'live';
  const suppressed = isSuppressActive(suppressUntil);

  const accent = suppressed && isLive ? ORANGE : isLive ? GREEN : YELLOW;
  const textColor = suppressed && isLive ? ORANGE : isLive ? GREEN_FG : YELLOW;
  const bannerBg = mix(accent, 18);
  const bannerBorder = mix(accent, 30);
  const infoColor = textColor;

  // Parse as local date (not UTC) to avoid timezone-shifting the display by one day.
  // new Date('YYYY-MM-DD') is UTC midnight; new Date(y, m, d) is local midnight.
  const suppressedDisplay = (() => {
    if (!suppressUntil) return '';
    const [y, m, d] = suppressUntil.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  return (
    <div
      className="flex items-center gap-3 rounded-md border-b px-4 py-2"
      style={{ background: bannerBg, borderColor: bannerBorder }}
    >
      <LuInfo size={14} color={infoColor} />

      <p className="flex-1 text-xs" style={{ color: textColor }}>
        {suppressed && isLive
          ? `Suppressed until ${suppressedDisplay} — scheduled runs are paused.`
          : isLive
            ? `This ${label} is live. Scheduled runs will execute when the cron endpoint is triggered.`
            : `Draft mode — scheduled runs are disabled. Use ${runLabel} to test.`}
      </p>

      {/* Live/Draft toggle */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="h-3.5 w-px" style={{ background: bannerBorder }} />
        <span className="text-xs font-semibold" style={{ color: textColor }}>
          {isLive ? 'Live' : 'Draft'}
        </span>
        <Switch
          checked={isLive}
          disabled={!editMode}
          onCheckedChange={(checked: boolean) => onChange(checked ? 'live' : 'draft')}
          className="data-[state=checked]:bg-[#2ecc71]"
        />
      </div>

      {/* Suppress control — always interactive, no editMode gate */}
      {onSuppressChange && (
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="h-3.5 w-px" style={{ background: bannerBorder }} />
          <LuCirclePause size={13} color={suppressed ? ORANGE : infoColor} />
          <span
            className="text-xs"
            style={{ color: suppressed ? ORANGE : textColor, opacity: suppressed ? 1 : 0.8 }}
          >
            Suppress until
          </span>
          {suppressed ? (
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold" style={{ color: ORANGE }}>{suppressedDisplay}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    aria-label="Clear suppression"
                    onClick={() => onSuppressChange('')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: ORANGE, fontSize: '14px', lineHeight: 1 }}
                  >
                    ×
                  </TooltipTrigger>
                  <TooltipContent>Clear suppression</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
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
        </div>
      )}
    </div>
  );
}
