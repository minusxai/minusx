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
import StepModels from './steps/StepModels';
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
  showModelsStep = false,
}: ConnectionWizardProps) {
  const [step, setStep] = useState<ConnectionWizardStep>(initialStep);
  const [connectionId, setConnectionId] = useState<number | null>(initialConnectionId);
  const [connectionName, setConnectionName] = useState<string | null>(initialConnectionName);
  const [contextFileId, setContextFileId] = useState<number | null>(initialContextFileId);
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<QuestionnaireAnswers | null>(
    initialQuestionnaireAnswers,
  );

  const connectionCriteria = useMemo(() => ({ type: 'connection' as const }), []);
  const { files: connectionFiles } = useFilesByCriteria({ criteria: connectionCriteria, partial: true });
  const _hasConnections = connectionFiles.some(f => (f.id as number) > 0);

  // Start schema fetching only after questionnaire is done — avoids blocking the transition
  // from connection step to questionnaire while the schema loader runs.
  const pastQuestionnaire = step === 'context' || step === 'generating' || step === 'slack';
  const { connections, loading: connectionsLoading } = useConnections({ skip: !connectionName || !pastQuestionnaire });

  const handleModelsComplete = useCallback(() => {
    setStep('connection');
    onStepChange?.('connection', {});
  }, [onStepChange]);

  const handleConnectionComplete = useCallback((id: number, name: string) => {
    setConnectionId(id);
    setConnectionName(name);
    setStep('questionnaire');
    onStepChange?.('questionnaire', { connectionId: id, connectionName: name });
  }, [onStepChange]);


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
      <StepIndicatorBar currentStep={step} showSlackStep={showSlackStep} showModelsStep={showModelsStep} onSkip={onComplete} />

      <Box
        bg="bg.surface"
        border="1px solid"
        borderColor="border.default"
        borderRadius="xl"
        p={{ base: 3, md: 10 }}
        minH="500px"
        css={{ animation: 'fadeInUp 0.4s ease-out forwards' }}
      >
        {step === 'models' && (
          <StepModels
            onComplete={handleModelsComplete}
            greeting={greeting('models')}
          />
        )}
        {step === 'connection' && (
            <StepConnection
              onComplete={handleConnectionComplete}
              greeting={greeting('connection')}
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
            staticSchemas={null}
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
            onFinish={onComplete}
            showSlackStep={showSlackStep}
            staticSchemas={null}
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
