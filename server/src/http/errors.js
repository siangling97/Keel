// Turn errors into JSON responses with the right status code.
//
//   ValidationError (from the engines) -> 400 with its message
//   ZodError (bad request body)        -> 400 with one message per field
//   HttpError                          -> its own status (401, 404, 409, ...)
//   anything else                      -> 500 "Something went wrong." The real error is logged,
//                                         never sent to the browser (it could leak SQL or file paths).

import { ZodError } from 'zod';
import { ValidationError } from '../engine/errors.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Not found.') => new HttpError(404, what);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });
}

// Express knows this is an error handler because it has 4 arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: 'Some fields are invalid.',
        details: err.issues.map((issue) => ({ field: issue.path.join('.') || null, message: issue.message })),
      },
    });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: { message: err.message } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  // express.json() errors: bad JSON or body too big
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'The request body is not valid JSON.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'The request is too large.' } });
  }

  console.error(err);
  return res.status(500).json({ error: { message: 'Something went wrong.' } });
}
