'use client';

import { useState, useCallback, useMemo } from 'react';
import { Box, Text } from '@chakra-ui/react';

import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { fadeInUpKeyframes } from '@/lib/ui/animations';
import { type ConnectionWizardStep, type ConnectionWizardProps } from './ConnectionWizardTypes';
import StepIndicatorBar from './StepIndicatorBar';
import StepConnection from './steps/StepConnection';
import StepStaticUpload from './steps/StepStaticUpload';
import StepContext from './steps/StepContext';
import StepGenerating from './steps/StepGenerating';

export default function ConnectionWizard({
  initialStep = 'connection',
  initialConnectionId = null,
  initialConnectionName = null,
  initialContextFileId = null,
  onStepChange,
  onComplete,
  showGreetings = false,
  showSkipConnection = false,
  greetings,
}: ConnectionWizardProps) {
  const [step, setStep] = useState<ConnectionWizardStep>(initialStep);
  const [connectionId, setConnectionId] = useState<number | null>(initialConnectionId);
  const [connectionName, setConnectionName] = useState<string | null>(initialConnectionName);
  const [contextFileId, setContextFileId] = useState<number | null>(initialContextFileId);
  // Sub-state for static connection (CSV/Sheets) upload within the connection step
  const [staticTab, setStaticTab] = useState<'csv' | 'sheets' | null>(null);
  // Schema names from static upload — used to auto-select only relevant schemas in context step
  const [staticSchemas, setStaticSchemas] = useState<string[] | null>(null);

  const connectionCriteria = useMemo(() => ({ type: 'connection' as const }), []);
  const { files: connectionFiles } = useFilesByCriteria({ criteria: connectionCriteria, partial: true });
  const hasConnections = connectionFiles.some(f => (f.id as number) > 0);

  const handleConnectionComplete = useCallback((id: number, name: string) => {
    setConnectionId(id);
    setConnectionName(name);
    setStep('context');
    onStepChange?.('context', { connectionId: id, connectionName: name });
  }, [onStepChange]);

  const handleStaticSelect = useCallback((tab: 'csv' | 'sheets') => {
    setStaticTab(tab);
  }, []);

  const handleStaticComplete = useCallback((id: number, name: string, schemaNames: string[]) => {
    setStaticTab(null);
    setStaticSchemas(schemaNames);
    handleConnectionComplete(id, name);
  }, [handleConnectionComplete]);

  const handleStaticBack = useCallback(() => {
    setStaticTab(null);
  }, []);

  const handleContextComplete = useCallback((fileId: number) => {
    setContextFileId(fileId);
    setStep('generating');
    onStepChange?.('generating', {
      connectionId: connectionId ?? undefined,
      connectionName: connectionName ?? undefined,
      contextFileId: fileId,
    });
  }, [onStepChange, connectionId, connectionName]);

  const handleSkipConnection = useCallback(() => {
    const first = connectionFiles[0];
    if (!first) return;
    handleConnectionComplete(first.id as number, first.name);
  }, [connectionFiles, handleConnectionComplete]);

  const handleRequestChat = useCallback((fileId: number) => {
    setContextFileId(fileId);
  }, []);

  const greeting = (s: ConnectionWizardStep) => showGreetings ? greetings?.[s] : undefined;

  return (
    <>
      <style>{fadeInUpKeyframes}</style>
      <StepIndicatorBar currentStep={step} />

      <Box
        bg="bg.surface"
        border="1px solid"
        borderColor="border.default"
        borderRadius="xl"
        p={{ base: 6, md: 10 }}
        minH="500px"
        css={{ animation: 'fadeInUp 0.4s ease-out forwards' }}
      >
        {step === 'connection' && !staticTab && (
          <>
            <StepConnection
              onComplete={handleConnectionComplete}
              onStaticSelect={handleStaticSelect}
              greeting={greeting('connection')}
            />
            {showSkipConnection && hasConnections && (
              <Text
                mt={4}
                fontSize="sm"
                color="fg.muted"
                fontFamily="mono"
                cursor="pointer"
                textDecoration="underline"
                _hover={{ color: 'fg.default' }}
                onClick={handleSkipConnection}
              >
                I&apos;ve already connected my data &rarr;
              </Text>
            )}
          </>
        )}
        {step === 'connection' && staticTab && (
          <StepStaticUpload
            tab={staticTab}
            onComplete={handleStaticComplete}
            onBack={handleStaticBack}
          />
        )}
        {step === 'context' && connectionName && (
          <StepContext
            connectionName={connectionName}
            connectionId={connectionId!}
            onComplete={handleContextComplete}
            onRequestChat={handleRequestChat}
            onContextCreated={handleRequestChat}
            greeting={greeting('context')}
            staticSchemas={staticSchemas}
          />
        )}
        {step === 'generating' && connectionName && (
          <StepGenerating
            connectionName={connectionName}
            contextFileId={contextFileId!}
            greeting={greeting('generating')}
            onComplete={onComplete}
            staticSchemas={staticSchemas}
          />
        )}
      </Box>
    </>
  );
}
