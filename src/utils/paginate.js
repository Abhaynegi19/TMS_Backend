import { badRequest } from './errors.js';

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

// Lists stay backward compatible: with no ?page= they return everything (up to a cap), which dropdowns rely on.
// With ?page=N they return N-th page of ?limit= records (default 10) plus meta { page, limit, total, pages }.
export function pageParams(query) {
  if (query.page === undefined) return null;
  const page = Number(query.page);
  const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) throw badRequest('"page" must be a whole number, 1 or higher');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw badRequest(`"limit" must be a whole number between 1 and ${MAX_PAGE_SIZE}`);
  return { page, limit, skip: (page - 1) * limit };
}
export const pageMeta = (p, total) => ({ page: p.page, limit: p.limit, total, pages: Math.max(1, Math.ceil(total / p.limit)) });
