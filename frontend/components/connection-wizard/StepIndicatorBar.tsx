'use client';

import { Flex, HStack, Box, Text } from '@chakra-ui/react';
import { LuCheck } from 'react-icons/lu';
import { type ConnectionWizardStep, WIZARD_STEP_LABELS } from './ConnectionWizardTypes';
import { fadeInUpKeyframes } from '@/lib/ui/animations';

const STEPS: ConnectionWizardStep[] = ['connection', 'context', 'generating', 'slack'];

const stepperKeyframes = `
  @keyframes stepPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(22, 160, 133, 0.4); }
    50% { box-shadow: 0 0 12px 4px rgba(22, 160, 133, 0.15); }
  }
  @keyframes stepSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

interface StepIndicatorBarProps {
  currentStep: ConnectionWizardStep;
}

export default function StepIndicatorBar({ currentStep }: StepIndicatorBarProps) {
  const displayStep = currentStep === 'questionnaire' ? 'context' : currentStep;

  return (
    <>
      <style>{fadeInUpKeyframes}</style>
      <style>{stepperKeyframes}</style>
      <Flex
        align="center"
        justify="center"
        mb={6}
        borderRadius="xl"
        px={6}
        py={3}
        position="relative"
        css={{ animation: 'fadeInUp 0.3s ease-out forwards' }}
      >
        <HStack gap={0}>
          {STEPS.map((s, idx) => {
            const info = WIZARD_STEP_LABELS[s];
            const currentInfo = WIZARD_STEP_LABELS[displayStep];
            const isActive = s === displayStep;
            const isPast = info.number < currentInfo.number;
            const isFuture = !isActive && !isPast;
            const isLast = idx === STEPS.length - 1;

            return (
              <HStack key={s} gap={0}>
                {/* Step node + label */}
                <HStack gap={2} position="relative">
                  {/* Spinner ring around active step */}
                  <Box position="relative" w="28px" h="28px" flexShrink={0}>
                    {isActive && (
                      <Box
                        position="absolute"
                        inset="-5px"
                        borderRadius="full"
                        css={{
                          animation: 'stepSpin 1.5s linear infinite',
                          background: 'conic-gradient(from 0deg, transparent 0%, rgba(22, 160, 133, 1) 35%, transparent 55%)',
                          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                          filter: 'drop-shadow(0 0 4px rgba(22, 160, 133, 0.6))',
                        }}
                      />
                    )}
                    <Box
                      w="28px"
                      h="28px"
                      borderRadius="full"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      fontSize="xs"
                      fontFamily="mono"
                      fontWeight="700"
                      position="relative"
                      transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                      bg={
                        isPast
                          ? 'accent.teal'
                          : isActive
                            ? 'transparent'
                            : 'transparent'
                      }
                      color={
                        isPast
                          ? 'white'
                          : isActive
                            ? 'accent.teal'
                            : 'fg.subtle'
                      }
                      border="1.5px solid"
                      borderColor={
                        isPast
                          ? 'accent.teal'
                          : isActive
                            ? 'accent.teal'
                            : 'fg.subtle/30'
                      }
                      css={isActive ? {
                        animation: 'stepPulse 2.5s ease-in-out infinite',
                        background: 'radial-gradient(circle at center, rgba(22, 160, 133, 0.12) 0%, transparent 70%)',
                      } : isPast ? {
                        filter: 'drop-shadow(0 0 4px rgba(22, 160, 133, 0.5))',
                      } : undefined}
                    >
                      {isPast ? <LuCheck size={13} strokeWidth={3} /> : info.number}
                    </Box>
                  </Box>

                  <Text
                    fontSize="xs"
                    fontFamily="mono"
                    letterSpacing="0.02em"
                    display={{ base: 'none', md: 'block' }}
                    transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                    color={
                      isActive
                        ? 'accent.teal'
                        : isPast
                          ? 'accent.teal'
                          : 'fg.subtle'
                    }
                    fontWeight={isActive ? 700 : 400}
                    opacity={isFuture ? 0.5 : 1}
                    css={isActive ? {
                      textShadow: '0 0 12px rgba(22, 160, 133, 0.4)',
                    } : undefined}
                  >
                    {info.label}
                  </Text>
                </HStack>

                {/* Connecting line */}
                {!isLast && (
                  <Box
                    w="40px"
                    h="1.5px"
                    mx={2}
                    borderRadius="full"
                    display={{ base: 'none', md: 'block' }}
                    transition="all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
                    position="relative"
                    overflow="hidden"
                    bg={isPast ? 'accent.teal' : 'fg.subtle/20'}
                    css={isPast ? {
                      boxShadow: '0 0 6px rgba(22, 160, 133, 0.4)',
                    } : isActive ? {
                      background: 'linear-gradient(90deg, rgba(22, 160, 133, 0.8), rgba(22, 160, 133, 0.1))',
                    } : undefined}
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
