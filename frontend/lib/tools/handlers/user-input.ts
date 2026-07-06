/**
 * UserInputFrontend / UserInputTool - Mock tool for tests and future client-side execution
 */
import type { FrontendToolHandler } from './types';

export const userInputFrontendHandler: FrontendToolHandler = async () => {
  return { content: 'User provided input', details: { success: true } };
};

export const userInputToolHandler: FrontendToolHandler = async () => {
  return { content: 'User provided input', details: { success: true } };
};
