'use client';

import { Box } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectViewStack, selectViewStackDepth } from '@/store/uiSlice';
import QuestionStackLayer from './stack-layers/QuestionStackLayer';

const SLIDE_IN_CSS = `
  @keyframes viewStackSlideIn {
    from { transform: translateX(8px); opacity: 0; }
    to   { transform: translateX(0);   opacity: 1; }
  }
`;

export default function ViewStackOverlay() {
  const stack = useAppSelector(selectViewStack);
  const depth = useAppSelector(selectViewStackDepth);

  if (depth === 0) return null;

  return (
    <>
      <style>{SLIDE_IN_CSS}</style>
      <Box
        position="absolute"
        inset="0"
        zIndex={50}
        display="flex"
        flexDirection="column"
        overflow="hidden"
        aria-label="Content stack"
        css={{ animation: 'viewStackSlideIn 0.2s ease forwards' }}
      >
        {stack.map((item, index) => {
          // Only render the top layer for now; extend for multi-level later
          if (index !== stack.length - 1) return null;

          if (item.type === 'question') {
            return (
              <QuestionStackLayer
                key={`question-${item.fileId}`}
                fileId={item.fileId}
                folderPath=""
                isCreateMode={false}
              />
            );
          }
          if (item.type === 'create-question') {
            return (
              <QuestionStackLayer
                key={`create-${item.folderPath}-${item.dashboardId}`}
                fileId={item.fileId}
                folderPath={item.folderPath}
                isCreateMode={true}
                dashboardId={item.dashboardId}
              />
            );
          }
          return null;
        })}
      </Box>
    </>
  );
}
