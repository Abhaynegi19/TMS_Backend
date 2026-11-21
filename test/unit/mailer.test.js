import '../setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMail, mailMode, mailOutbox, resetMailer, esc } from '../../src/utils/mailer.js';

test('without SMTP settings mail is logged, not sent', async (t) => {
  t.mock.method(console, 'log', () => {});
  delete process.env.SMTP_HOST;
  resetMailer();
  assert.equal(mailMode(), 'log');
  const r = await sendMail({ to: 'a@b.co', subject: 'Hi', text: 'Hello', attachments: [{ filename: 'x.pdf', content: Buffer.from('x') }] });
  assert.equal(r.mode, 'log');
  assert.deepEqual(mailOutbox()[0], { to: ['a@b.co'], subject: 'Hi', text: 'Hello', html: undefined, attachments: ['x.pdf'] });
});

test('esc neutralises HTML', () => {
  assert.equal(esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});
