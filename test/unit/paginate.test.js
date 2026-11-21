import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageParams, pageMeta, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../src/utils/paginate.js';

test('no page parameter means "everything" (dropdowns rely on this)', () => {
  assert.equal(pageParams({}), null);
  assert.equal(pageParams({ q: 'x' }), null);
});

test('pages are 10 records unless asked otherwise', () => {
  assert.equal(DEFAULT_PAGE_SIZE, 10);
  assert.deepEqual(pageParams({ page: '1' }), { page: 1, limit: 10, skip: 0 });
  assert.deepEqual(pageParams({ page: '3' }), { page: 3, limit: 10, skip: 20 });
  assert.deepEqual(pageParams({ page: '2', limit: '25' }), { page: 2, limit: 25, skip: 25 });
});

test('rejects nonsense with a clear 400', () => {
  for (const page of ['0', '-1', 'abc', '1.5', '']) {
    assert.throws(() => pageParams({ page }), (e) => e.status === 400 && /"page"/.test(e.message), `page=${page}`);
  }
  for (const limit of ['0', '-5', 'x', String(MAX_PAGE_SIZE + 1), '2.5']) {
    assert.throws(() => pageParams({ page: '1', limit }), (e) => e.status === 400 && /"limit"/.test(e.message), `limit=${limit}`);
  }
});

test('pageMeta counts pages and always has at least one', () => {
  const p = { page: 1, limit: 10, skip: 0 };
  assert.deepEqual(pageMeta(p, 0), { page: 1, limit: 10, total: 0, pages: 1 });
  assert.equal(pageMeta(p, 10).pages, 1);
  assert.equal(pageMeta(p, 11).pages, 2);
  assert.equal(pageMeta(p, 95).pages, 10);
});
