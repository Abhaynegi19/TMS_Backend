// Some MongoDB-compatible servers (and older drivers) report E11000 without naming the field.
// This plugin works out which unique field collided so the API can show a precise message.
export function duplicateInfo(schema) {
  schema.post('save', async function (err, doc, next) {
    if (err?.code !== 11000 || err.keyPattern || err.keyValue) return next(err);
    try {
      for (const [path, type] of Object.entries(schema.paths)) {
        if (!type.options?.unique || doc[path] == null) continue;
        if (await doc.constructor.exists({ [path]: doc[path], _id: { $ne: doc._id } })) {
          err.keyPattern = { [path]: 1 };
          err.keyValue = { [path]: doc[path] };
          break;
        }
      }
    } catch { /* fall through with the original error */ }
    next(err);
  });
}
