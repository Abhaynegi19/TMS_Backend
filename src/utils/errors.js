export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
export const badRequest = (msg, fields) => new AppError(400, 'BAD_REQUEST', msg, fields);
export const invalid = (fields, msg = 'Please fix the highlighted fields') => new AppError(422, 'VALIDATION_ERROR', msg, fields);
export const rule = (msg, fields) => new AppError(422, 'BUSINESS_RULE', msg, fields);
export const unauthenticated = (msg = 'Please sign in to continue', code = 'UNAUTHENTICATED') => new AppError(401, code, msg);
export const forbidden = (msg = "You don't have permission to do that") => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg, fields) => new AppError(409, 'CONFLICT', msg, fields);
