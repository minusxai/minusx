export class UserInterruptError extends Error {
  constructor(message = 'Execution interrupted by user') {
    super(message);
    this.name = 'UserInterruptError';
  }
}
