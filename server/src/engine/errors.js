// A special error for bad input (wrong numbers, missing fields).
// Later, the Express API can check `err instanceof ValidationError`
// and send a 400 Bad Request with the message, instead of a 500 server error.
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}
