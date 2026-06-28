import { Button } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import { Tooltip } from './tooltip';

/**
 * The "✨ Auto" chip — a small "generate with AI" affordance shown next to an
 * empty field (title, description, …) that a micro-task can auto-fill. `label`
 * is both the aria-label and the tooltip text. Shared by the file header and the
 * context-docs editor.
 */
export function GenerateButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} positioning={{ placement: 'top' }}>
      <Button
        aria-label={label}
        onClick={onClick}
        loading={loading}
        size="2xs"
        variant="ghost"
        gap={1}
        px={1.5}
        h="18px"
        flexShrink={0}
        fontFamily="mono"
        fontWeight="700"
        fontSize="2xs"
        color="accent.secondary"
        bg="accent.secondary/8"
        borderWidth="1px"
        borderColor="accent.secondary/15"
        _hover={{ bg: 'accent.secondary/15' }}
      >
        <LuSparkles />
        Auto
      </Button>
    </Tooltip>
  );
}
