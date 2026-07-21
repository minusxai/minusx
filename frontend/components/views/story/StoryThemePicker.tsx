'use client';

/**
 * StoryThemePicker — pure view (no Redux): the story settings dialog for picking a design
 * theme (Story_Design_V2 §5). Rendered FROM the theme registry (the container passes
 * `STORY_THEMES`); shows each theme's label + description + preview image and a "Default"
 * option that clears the field. Selection calls `onChange(name | null)` — the container
 * stages the `content.theme` edit — and stays open so themes can be compared live.
 */
import { Box, CloseButton, Dialog, Image, Portal, SimpleGrid, Text } from '@chakra-ui/react';
import type { StoryTheme } from '@/lib/data/story/story-themes';

export interface StoryThemePickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** The registry entries to render (container passes STORY_THEMES). */
  themes: StoryTheme[];
  /** The story's current `content.theme` (null/undefined = neutral default). */
  value: string | null;
  /** Pick a theme (name) or clear back to the default (null). */
  onChange: (theme: string | null) => void;
}

interface ThemeCardProps {
  ariaLabel: string;
  title: string;
  description: string;
  imageUrl?: string;
  selected: boolean;
  onSelect: () => void;
}

function ThemeCard({ ariaLabel, title, description, imageUrl, selected, onSelect }: ThemeCardProps) {
  return (
    <Box
      as="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={onSelect}
      textAlign="left"
      borderWidth="2px"
      borderColor={selected ? 'accent.primary' : 'border.default'}
      borderRadius="md"
      overflow="hidden"
      bg={selected ? 'bg.subtle' : 'bg.panel'}
      cursor="pointer"
      _hover={{ borderColor: 'accent.primary' }}
    >
      {imageUrl && (
        <Image src={imageUrl} alt="" width="100%" aspectRatio={8 / 5} objectFit="cover" />
      )}
      <Box p={2}>
        <Text fontWeight="bold" fontSize="sm">{title}</Text>
        <Text fontSize="xs" color="fg.muted" lineClamp={2}>{description}</Text>
      </Box>
    </Box>
  );
}

export default function StoryThemePicker({ isOpen, onClose, themes, value, onChange }: StoryThemePickerProps) {
  if (!isOpen) return null;
  return (
    <Dialog.Root open onOpenChange={(e) => { if (!e.open) onClose(); }} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content aria-label="Story theme picker">
            <Dialog.Header>
              <Dialog.Title>Story theme</Dialog.Title>
              <CloseButton
                aria-label="Close theme picker"
                position="absolute"
                top={2}
                right={2}
                onClick={onClose}
              />
            </Dialog.Header>
            <Dialog.Body pb={4}>
              <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={3}>
                <ThemeCard
                  ariaLabel="Theme Default"
                  title="Default"
                  description="The neutral house look — no design theme applied."
                  selected={value == null}
                  onSelect={() => onChange(null)}
                />
                {themes.map((t) => (
                  <ThemeCard
                    key={t.name}
                    ariaLabel={`Theme ${t.label}`}
                    title={t.label}
                    description={t.description}
                    imageUrl={`/story-themes/${t.name}.png`}
                    selected={value === t.name}
                    onSelect={() => onChange(t.name)}
                  />
                ))}
              </SimpleGrid>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
