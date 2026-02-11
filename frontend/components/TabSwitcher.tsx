import { HStack, IconButton } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { IconType } from 'react-icons';

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

export default function TabSwitcher({ tabs, activeTab, onTabChange, accentColor = 'accent.teal' }: TabSwitcherProps) {
  return (
    <HStack
      gap={0.5}
      bg="bg.surface"
      borderRadius="md"
      p={0.5}
      border="1px solid"
      borderColor="border.default"
    >
      {tabs.map((tab) => (
        <Tooltip key={tab.value} content={tab.label} positioning={{ placement: 'bottom' }}>
          <IconButton
            variant="ghost"
            size="xs"
            aria-label={tab.label}
            onClick={() => onTabChange(tab.value)}
            bg={activeTab === tab.value ? accentColor : 'transparent'}
            color={activeTab === tab.value ? 'white' : 'fg.default'}
            _hover={{ bg: activeTab === tab.value ? accentColor : 'bg.muted' }}
            borderRadius="sm"
          >
            <tab.icon />
          </IconButton>
        </Tooltip>
      ))}
    </HStack>
  );
}
