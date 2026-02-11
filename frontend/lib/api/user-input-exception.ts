/**
 * Exception thrown by frontend tools to request user input
 * Tool execution pauses until user provides input
 */
export class UserInputException extends Error {
  constructor(public props: UserInputProps) {
    super('User input required');
    this.name = 'UserInputException';
  }
}

export interface UserInputProps {
  type: 'confirmation' | 'text' | 'choice' | 'form';
  title: string;
  message?: string;

  // For confirmation
  confirmText?: string;
  cancelText?: string;

  // For text input
  placeholder?: string;
  multiline?: boolean;

  // For choice selection
  options?: Array<{ label: string; value?: any; description?: string }>;
  multiSelect?: boolean;  // Allow multiple selections for choice type
  cancellable?: boolean;  // Show cancel button for choice type

  // For form input
  fields?: Array<{
    name: string;
    label: string;
    type: 'text' | 'number' | 'date';
    required?: boolean;
    placeholder?: string;
  }>;
}

export interface UserInput {
  id: string;                    // Unique ID for this user input request
  props: UserInputProps;         // What to show user
  result?: any;                  // User's response (undefined = pending)
  providedAt?: string;           // Timestamp when user responded
}
