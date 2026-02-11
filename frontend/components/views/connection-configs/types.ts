/**
 * Shared types for connection config components
 */

export interface BaseConfigProps {
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
  mode: 'create' | 'view';
}
