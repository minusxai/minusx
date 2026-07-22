import React from 'react';
import {
  MentionOption,
  isSlashCommand,
  getMentionBadgeInfo,
  getMentionPrimaryText,
  getMentionMetaText,
} from './mentions-plugin-utils';
import { LuChevronRight } from 'react-icons/lu';

interface MentionRowProps {
  mention: MentionOption;
  index: number;
  isSelected: boolean;
  selectedItemRef: React.RefObject<HTMLDivElement | null>;
  isUserSkillHeader: boolean;
  isSystemSkillHeader: boolean | null;
  onHover: (index: number) => void;
  onSelect: (mention: MentionOption) => void;
}

/** Group header ("Your skills" / "System") above a skills section. */
function GroupHeader({ label }: { label: string }) {
  return (
    <div
      className="border-b border-border px-3 py-1.5"
      style={{ background: 'color-mix(in srgb, var(--muted) 50%, transparent)' }}
    >
      <span className="block text-[10px] font-bold tracking-[0.02em] text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
}

/** A single row in the mentions dropdown (plus any group header above it). */
export function MentionRow({
  mention,
  index,
  isSelected,
  selectedItemRef,
  isUserSkillHeader,
  isSystemSkillHeader,
  onHover,
  onSelect,
}: MentionRowProps) {
  const disabled = isSlashCommand(mention) && mention.disabled;

  return (
    <>
      {isUserSkillHeader && <GroupHeader label="Your skills" />}
      {isSystemSkillHeader && <GroupHeader label="System" />}
      <div
        ref={isSelected ? selectedItemRef : null}
        className={`border-b border-border px-3 py-2.5 last:border-b-0 ${
          disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-muted'
        } ${isSelected ? 'bg-muted' : 'bg-transparent'}`}
        onMouseEnter={() => onHover(index)}
        onClick={() => onSelect(mention)}
      >
        {(() => {
          const badgeInfo = getMentionBadgeInfo(mention);
          const BadgeIcon = badgeInfo.icon;
          const primary = getMentionPrimaryText(mention);
          const meta = getMentionMetaText(mention);
          return (
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className="inline-flex h-5 min-w-[54px] shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-[10px] font-bold"
                style={{
                  background: `color-mix(in srgb, ${badgeInfo.color} 12%, transparent)`,
                  color: badgeInfo.color,
                }}
              >
                {BadgeIcon && <BadgeIcon className="size-3 shrink-0" />}
                {badgeInfo.label}
              </span>
              <div className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5">
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-sm text-foreground [font-weight:650]">
                    {primary}
                  </span>
                  {!isSlashCommand(mention) && mention.type === 'table' && meta && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {meta}
                    </span>
                  )}
                </div>
                {(isSlashCommand(mention) || (!isSlashCommand(mention) && mention.type === 'skill')) && meta && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {meta}
                  </span>
                )}
              </div>
              {/* Every table can drill down into its columns (resolved on demand). */}
              {!isSlashCommand(mention) && mention.type === 'table' && (
                <LuChevronRight className="size-3.5 shrink-0 self-center text-muted-foreground" />
              )}
            </div>
          );
        })()}
      </div>
    </>
  );
}
