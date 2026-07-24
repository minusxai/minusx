import { IconType } from 'react-icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/kit/tooltip';
import { ACCENT_HEX } from '@/lib/ui/file-metadata';

interface Tab {
  value: string;
  label: string;
  icon: IconType;
}

interface TabSwitcherProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  accentColor?: string;
}

// Callers pass Chakra-era semantic tokens (e.g. 'accent.teal', metadata.color);
// resolve them to concrete colors for the kit/Tailwind stack.
function resolveAccent(color: string): string {
  if (color.startsWith('accent.')) {
    const hex = ACCENT_HEX[color.slice('accent.'.length) as keyof typeof ACCENT_HEX];
    if (hex) return hex;
  }
  if (color === 'fg.muted') return 'var(--muted-foreground)';
  return color;
}

export default function TabSwitcher({ tabs, activeTab, onTabChange, accentColor = 'accent.teal' }: TabSwitcherProps) {
  const accent = resolveAccent(accentColor);
  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <Tooltip key={tab.value}>
              <TooltipTrigger
                aria-label={tab.label}
                onClick={() => onTabChange(tab.value)}
                className={`inline-flex size-6 shrink-0 items-center justify-center rounded-sm transition-colors ${
                  isActive ? 'text-white' : 'text-foreground hover:bg-muted'
                }`}
                style={isActive ? { background: accent } : undefined}
              >
                <tab.icon />
              </TooltipTrigger>
              <TooltipContent side="bottom">{tab.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
