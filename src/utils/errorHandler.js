import { AppError } from './errors.js';

const pretty = (p = 'value') => {
  const s = p.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const mongooseMsg = (e) => {
  const L = pretty(e.path);
  switch (e.kind) {
    case 'required': return `${L} is required`;
    case 'enum': return `${L} has an invalid value`;
    case 'min': return `${L} must be at least ${e.properties?.min}`;
    case 'max': return `${L} must be at most ${e.properties?.max}`;
    case 'minlength': return `${L} is too short`;
    case 'maxlength': return `${L} is too long`;
    case 'Number': case 'Date': case 'Boolean': case 'ObjectId': case 'ObjectID': return `${L} has an invalid value`;
    default: return e.message;
  }
};

// Every failure leaves the API as { success:false, error:{ code, message, fields?, requestId? } }
export function errorHandler(err, req, res, _next) {
  let e = err;
  if (!(e instanceof AppError)) {
    if (e.type === 'entity.parse.failed') e = new AppError(400, 'BAD_JSON', 'The request body is not valid JSON');
    else if (e.type === 'entity.too.large') e = new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
    else if (e.name === 'ValidationError') {
      const fields = {};
      for (const [k, v] of Object.entries(e.errors)) fields[k] = mongooseMsg(v);
      e = new AppError(422, 'VALIDATION_ERROR', 'Please fix the highlighted fields', fields);
    } else if (e.name === 'CastError') e = new AppError(400, 'BAD_REQUEST', `Invalid value for "${e.path}"`);
    else if (e.code === 11000) {
      const k = Object.keys(e.keyPattern || e.keyValue || {})[0];
      e = k
        ? new AppError(409, 'DUPLICATE', `${pretty(k)} already exists`, { [k]: `This ${pretty(k).toLowerCase()} is already in use` })
        : new AppError(409, 'DUPLICATE', 'That value already exists');
    } else if (/MongooseServerSelection|MongoNetwork/.test(e.name)) {
      e = new AppError(503, 'DB_UNAVAILABLE', 'The database is unavailable right now. Please try again in a moment.');
    } else e = new AppError(500, 'INTERNAL', 'Something went wrong on our side. Please try again.');
  }
  if (e.status >= 500) console.error(`[${req.id}]`, err);
  res.status(e.status).json({
    success: false,
    error: { code: e.code, message: e.message, fields: e.fields, requestId: e.status >= 500 ? req.id : undefined },
  });
}
