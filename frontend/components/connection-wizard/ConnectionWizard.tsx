'use client';

import { useState, useCallback, useMemo } from 'react';
import { Box } from '@chakra-ui/react';

import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { useConnections } from '@/lib/hooks/useConnections';
import { fadeInUpKeyframes } from '@/lib/ui/animations';
import {
  type ConnectionWizardStep,
  type ConnectionWizardProps,
  type QuestionnaireAnswers,
} from './ConnectionWizardTypes';
import StepIndicatorBar from './StepIndicatorBar';
import StepConnection from './steps/StepConnection';
import StepStaticUpload from './steps/StepStaticUpload';
import StepQuestionnaire from './steps/StepQuestionnaire';
import StepContext from './steps/StepContext';
import StepGenerating from './steps/StepGenerating';
import StepSlack from './steps/StepSlack';

export default function ConnectionWizard({
  initialStep = 'connection',
  initialConnectionId = null,
  initialConnectionName = null,
  initialContextFileId = null,
  initialQuestionnaireAnswers = null,
  onStepChange,
  onComplete,
  showGreetings = false,
  showSkipConnection: _showSkipConnection = false,
  greetings,
  showSlackStep = false,
}: ConnectionWizardProps) {
  const [step, setStep] = useState<ConnectionWizardStep>(initialStep);
  const [connectionId, setConnectionId] = useState<number | null>(initialConnectionId);
  const [connectionName, setConnectionName] = useState<string | null>(initialConnectionName);
  const [contextFileId, setContextFileId] = useState<number | null>(initialContextFileId);
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<QuestionnaireAnswers | null>(
    initialQuestionnaireAnswers,
  );
  // Sub-state for static connection (CSV/Sheets) upload within the connection step
  const [staticTab, setStaticTab] = useState<'csv' | 'sheets' | null>(null);
  // Schema names from static upload — used to auto-select only relevant schemas in context step
  const [staticSchemas, setStaticSchemas] = useState<string[] | null>(null);

  const connectionCriteria = useMemo(() => ({ type: 'connection' as const }), []);
  const { files: connectionFiles } = useFilesByCriteria({ criteria: connectionCriteria, partial: true });
  const _hasConnections = connectionFiles.some(f => (f.id as number) > 0);

  // Start schema fetching only after questionnaire is done — avoids blocking the transition
  // from connection step to questionnaire while the schema loader runs.
  const pastQuestionnaire = step === 'context' || step === 'generating' || step === 'slack';
  const { connections, loading: connectionsLoading } = useConnections({ skip: !connectionName || !pastQuestionnaire });

  const handleConnectionComplete = useCallback((id: number, name: string) => {
    setConnectionId(id);
    setConnectionName(name);
    setStep('questionnaire');
    onStepChange?.('questionnaire', { connectionId: id, connectionName: name });
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

  const handleQuestionnaireComplete = useCallback((answers: QuestionnaireAnswers) => {
    setQuestionnaireAnswers(answers);
    setStep('context');
    onStepChange?.('context', {
      connectionId: connectionId ?? undefined,
      connectionName: connectionName ?? undefined,
      questionnaireAnswers: answers,
    });
  }, [onStepChange, connectionId, connectionName]);

  const handleContextComplete = useCallback((fileId: number) => {
    setContextFileId(fileId);
    setStep('generating');
    onStepChange?.('generating', {
      connectionId: connectionId ?? undefined,
      connectionName: connectionName ?? undefined,
      contextFileId: fileId,
    });
  }, [onStepChange, connectionId, connectionName]);

  const _handleSkipConnection = useCallback(() => {
    const first = connectionFiles[0];
    if (!first) return;
    handleConnectionComplete(first.id as number, first.name);
  }, [connectionFiles, handleConnectionComplete]);

  const handleGeneratingComplete = useCallback(async () => {
    if (showSlackStep) {
      setStep('slack');
      onStepChange?.('slack', {
        connectionId: connectionId ?? undefined,
        connectionName: connectionName ?? undefined,
        contextFileId: contextFileId ?? undefined,
      });
    } else {
      onComplete?.();
    }
  }, [showSlackStep, onStepChange, onComplete, connectionId, connectionName, contextFileId]);

  const handleSlackComplete = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  const handleRequestChat = useCallback((fileId: number) => {
    setContextFileId(fileId);
  }, []);

  const greeting = (s: ConnectionWizardStep) => showGreetings ? greetings?.[s] : undefined;

  return (
    <>
      <style>{fadeInUpKeyframes}</style>
      <StepIndicatorBar currentStep={step} showSlackStep={showSlackStep} />

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
            <StepConnection
              onComplete={handleConnectionComplete}
              onStaticSelect={handleStaticSelect}
              greeting={greeting('connection')}
            />
        )}
        {step === 'connection' && staticTab && (
          <StepStaticUpload
            tab={staticTab}
            onComplete={handleStaticComplete}
            onBack={handleStaticBack}
          />
        )}
        {step === 'questionnaire' && connectionName && (
          <StepQuestionnaire
            onComplete={handleQuestionnaireComplete}
            greeting={greeting('questionnaire')}
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
            questionnaireAnswers={questionnaireAnswers}
            connections={connections}
            connectionsLoading={connectionsLoading}
          />
        )}
        {step === 'generating' && connectionName && (
          <StepGenerating
            connectionName={connectionName}
            contextFileId={contextFileId!}
            greeting={greeting('generating')}
            onComplete={handleGeneratingComplete}
            staticSchemas={staticSchemas}
            initialPreference={questionnaireAnswers?.dashboardPreference}
            questionnaireAnswers={questionnaireAnswers}
          />
        )}
        {step === 'slack' && (
          <StepSlack
            onComplete={handleSlackComplete}
            greeting={greeting('slack')}
          />
        )}
      </Box>
    </>
  );
}
