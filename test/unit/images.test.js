import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImage } from '../../src/utils/images.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]).toString('base64');
const fail = (fn, field, re) => assert.throws(fn, (e) => e.status === 422 && re.test(e.fields[field]));

test('accepts real PNG and JPEG data', () => {
  assert.equal(parseImage(`data:image/png;base64,${PNG}`, 'photos').ext, 'png');
  assert.equal(parseImage(`data:image/jpeg;base64,${JPG}`, 'photos').ext, 'jpg');
});

test('rejects anything that is not a PNG/JPEG data URL', () => {
  fail(() => parseImage(undefined, 'photos'), 'photos', /missing/);
  fail(() => parseImage('hello', 'photos'), 'photos', /JPEG or PNG/);
  fail(() => parseImage(`data:image/gif;base64,${PNG}`, 'photos'), 'photos', /JPEG or PNG/);
  fail(() => parseImage(`data:text/html;base64,${PNG}`, 'photos'), 'photos', /JPEG or PNG/);
});

test('checks the real bytes, not the declared type', () => {
  const script = Buffer.from('<script>alert(1)</script>').toString('base64');
  fail(() => parseImage(`data:image/png;base64,${script}`, 'photos'), 'photos', /not a valid/);
  fail(() => parseImage(`data:image/jpeg;base64,${PNG}`, 'photos'), 'photos', /not a valid/);
});

test('rejects corrupt base64 and oversized files', () => {
  fail(() => parseImage('data:image/png;base64,@@@@', 'photos'), 'photos', /corrupt/);
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
  fail(() => parseImage(`data:image/jpeg;base64,${big}`, 'photos'), 'photos', /under 2 MB/);
  fail(() => parseImage(`data:image/png;base64,${PNG}`, 'signature', { maxBytes: 10 }), 'signature', /under/);
});
