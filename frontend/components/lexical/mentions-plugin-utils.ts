import { MentionItem } from '@/lib/data/completions/types';
import { FILE_TYPE_METADATA, TABLE_MENTION_METADATA, ACCENT_HEX } from '@/lib/ui/file-metadata';
import type { DatabaseWithSchema, SkillMention, SlashCommand } from '@/lib/types';
import type { ColumnInfo } from '@/lib/hooks/use-table-columns';
import { LuTerminal } from 'react-icons/lu';

export type MentionOption = MentionItem | SkillMention | SlashCommand;
export type MentionTrigger = 'all' | 'questions' | 'skills' | 'commands';

// Map semantic token to hex value
const colorMap: Record<string, string> = {
  'accent.primary': ACCENT_HEX.primary,
  'accent.danger': ACCENT_HEX.danger,
  'accent.secondary': ACCENT_HEX.secondary,
  'accent.success': ACCENT_HEX.success,
  'accent.warning': ACCENT_HEX.warning,
  'accent.teal': ACCENT_HEX.teal,
  'accent.info': ACCENT_HEX.info,
  'accent.cyan': ACCENT_HEX.cyan,
  'accent.muted': ACCENT_HEX.muted,
};

export function isSlashCommand(option: MentionOption): option is SlashCommand {
  return option.type === 'command';
}

// Get badge info (color, label, icon) for a mention type
export function getMentionBadgeInfo(option: MentionOption) {
  if (isSlashCommand(option)) {
    return {
      label: 'CMD',
      icon: LuTerminal,
      color: ACCENT_HEX.info,
    };
  }

  if (option.type === 'skill') {
    return {
      label: 'SKILL',
      icon: null,
      color: ACCENT_HEX.teal,
    };
  }

  const type = option.type;
  if (type === 'table') {
    return {
      label: TABLE_MENTION_METADATA.label,
      icon: TABLE_MENTION_METADATA.icon,
      color: TABLE_MENTION_METADATA.color,
    };
  }

  const metadata = FILE_TYPE_METADATA[type];
  return {
    label: metadata.label.toUpperCase(),
    icon: metadata.icon,
    color: colorMap[metadata.color] || ACCENT_HEX.muted,
  };
}

export function getFilteredMentions(mentions: MentionOption[], mentionType: MentionTrigger) {
  const filtered = mentions.filter(m => mentionType === 'questions' ? m.type !== 'table' : true);
  // Sort skills: user skills first, then system
  if (mentionType === 'skills') {
    filtered.sort((a, b) => {
      const aSource = a.type === 'skill' ? a.source : 'system';
      const bSource = b.type === 'skill' ? b.source : 'system';
      if (aSource === bSource) return 0;
      return aSource === 'user' ? -1 : 1;
    });
  }
  return filtered;
}

export function getDropdownTitle(mentionType: MentionTrigger) {
  if (mentionType === 'commands') return 'Commands';
  if (mentionType === 'skills') return 'Skills';
  if (mentionType === 'questions') return 'Questions';
  return 'Tables, Questions & Dashboards';
}

export type { ColumnInfo } from '@/lib/hooks/use-table-columns';

/** Look up a table's columns from the whitelisted schemas (client-side, no API). */
export function getTableColumns(
  whitelistedSchemas: DatabaseWithSchema[] | undefined,
  schema: string | undefined,
  table: string,
): ColumnInfo[] {
  if (!whitelistedSchemas) return [];
  for (const db of whitelistedSchemas) {
    for (const s of db.schemas) {
      if (schema && s.schema !== schema) continue;
      for (const t of s.tables) {
        if (t.table === table) return t.columns ?? [];
      }
    }
  }
  return [];
}

export function getMentionPrimaryText(mention: MentionOption) {
  if (isSlashCommand(mention)) return mention.label;
  return 'display_text' in mention ? mention.display_text : mention.name;
}

export function getMentionMetaText(mention: MentionOption) {
  if (isSlashCommand(mention)) return mention.description;
  if (mention.type === 'table' && 'schema' in mention && mention.schema) {
    return mention.schema;
  }
  if (mention.type === 'skill') {
    return mention.description;
  }
  return undefined;
}
