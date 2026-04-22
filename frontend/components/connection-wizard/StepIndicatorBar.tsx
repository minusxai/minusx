'use client';

import { Flex, HStack, Box, Text, Icon } from '@chakra-ui/react';
import { LuCheck } from 'react-icons/lu';
import { type ConnectionWizardStep, WIZARD_STEP_LABELS } from './ConnectionWizardTypes';
import { fadeInUpKeyframes } from '@/lib/ui/animations';

const STEPS: ConnectionWizardStep[] = ['connection', 'context', 'generating'];

interface StepIndicatorBarProps {
  currentStep: ConnectionWizardStep;
}

export default function StepIndicatorBar({ currentStep }: StepIndicatorBarProps) {
  return (
    <>
      <style>{fadeInUpKeyframes}</style>
      <Flex
        align="center"
        justify="center"
        mb={6}
        bg="bg.surface"
        border="1px solid"
        borderColor="border.default"
        borderRadius="lg"
        px={5}
        py={3}
        css={{ animation: 'fadeInUp 0.3s ease-out forwards' }}
      >
        <HStack gap={3}>
          {STEPS.map((s) => {
            const info = WIZARD_STEP_LABELS[s];
            const currentInfo = WIZARD_STEP_LABELS[currentStep];
            const isActive = s === currentStep;
            const isPast = info.number < currentInfo.number;
            return (
              <HStack key={s} gap={1.5}>
                <Box
                  w="22px"
                  h="22px"
                  borderRadius="full"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  fontSize="xs"
                  fontFamily="mono"
                  fontWeight="600"
                  border="1.5px solid"
                  borderColor={isActive ? 'accent.teal' : isPast ? 'accent.teal' : 'border.default'}
                  bg={isPast ? 'accent.teal' : 'transparent'}
                  color={isPast ? 'white' : isActive ? 'accent.teal' : 'fg.subtle'}
                  transition="all 0.3s"
                >
                  {isPast ? <LuCheck size={12} /> : info.number}
                </Box>
                <Text
                  fontSize="xs"
                  fontFamily="mono"
                  color="accent.teal"
                  fontWeight={isActive ? 800 : 300}
                  display={{ base: 'none', md: 'block' }}
                  transition="color 0.3s"
                >
                  {info.label}
                </Text>
                {s !== 'generating' && (
                  <Box
                    w="24px"
                    h="1px"
                    bg={isPast ? 'accent.teal' : 'border.default'}
                    display={{ base: 'none', md: 'block' }}
                    transition="background 0.3s"
                  />
                )}
              </HStack>
            );
          })}
        </HStack>
      </Flex>
    </>
  );
}
