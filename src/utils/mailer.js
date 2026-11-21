import nodemailer from 'nodemailer';

// With SMTP_HOST set, mail is sent for real. Without it, messages are only logged (mode "log") so development just works.
let transport = null;
let outbox = [];

function getTransport() {
  if (transport) return transport;
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
    });
    transport.mode = 'smtp';
  } else {
    transport = nodemailer.createTransport({ jsonTransport: true });
    transport.mode = 'log';
  }
  return transport;
}

export const mailMode = () => getTransport().mode;
export const mailOutbox = () => outbox;
export const resetMailer = () => { transport = null; outbox = []; };

export async function sendMail({ to, subject, text, html, attachments }) {
  const t = getTransport();
  const info = await t.sendMail({ from: process.env.MAIL_FROM || 'Haulwise <no-reply@localhost>', to, subject, text, html, attachments });
  if (t.mode === 'log') {
    if (process.env.NODE_ENV !== 'test') console.log(`[mail:log] to=${[].concat(to).join(',')} subject="${subject}"`);
    outbox.push({ to: [].concat(to), subject, text, html, attachments: (attachments || []).map((a) => a.filename) });
    if (outbox.length > 100) outbox.shift();
  }
  return { mode: t.mode, messageId: info.messageId };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
