'use client';

import { IconButton } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { useExplainQuestion } from '@/lib/hooks/useExplainQuestion';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface ExplainButtonProps {
  questionId: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

/**
 * Button that triggers AI explanation for a question.
 * Opens the chat sidebar and sends a message asking to explain the question.
 */
export default function ExplainButton({
  questionId,
  size = 'xs',
}: ExplainButtonProps) {
  const { explainQuestion } = useExplainQuestion();
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    explainQuestion(questionId);
  };

  return (
    <Tooltip content={`Ask ${agentName} to explain this question`}>
      <IconButton
        onClick={handleClick}
        aria-label={`Ask ${agentName} to explain this question`}
        size={size}
        bg="linear-gradient(135deg, #1abc9c 0%, #16a085 100%)"
        color="white"
        _hover={{
          opacity: 0.85,
          transform: "scale(1.05)",
          "& svg": {
            transform: "rotate(90deg)",
          },
        }}
        _active={{
          transform: "scale(0.95)",
        }}
        transition="all 0.15s ease"
        css={{
          "& svg": {
            transition: "transform 0.2s ease",
          },
        }}
      >
        <LuSparkles />
      </IconButton>
    </Tooltip>
  );
}
