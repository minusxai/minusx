'use client';

import { LuSparkles } from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { useExplainQuestion } from '@/lib/hooks/useExplainQuestion';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface ExplainButtonProps {
  questionId: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<ExplainButtonProps['size']>, string> = {
  xs: 'size-6',
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
};

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
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger
          onClick={handleClick}
          aria-label={`Ask ${agentName} to explain this question`}
          className={`inline-flex ${SIZE_CLASS[size]} items-center justify-center rounded-md text-white outline-none transition-all duration-150 hover:scale-105 hover:opacity-85 active:scale-95 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:rotate-90`}
          style={{ background: 'linear-gradient(135deg, #1abc9c 0%, #16a085 100%)' }}
        >
          <LuSparkles />
        </TooltipTrigger>
        <TooltipContent>{`Ask ${agentName} to explain this question`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
