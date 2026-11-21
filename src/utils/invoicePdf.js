import PDFDocument from 'pdfkit';
import { STATES, amountInWords } from './gst.js';

const INK = '#16212B', MUTE = '#5B6B7A', LINE = '#D9DEE3', TEAL = '#0F766E', TINT = '#EDF0F2';
const STATUS_COLOR = { paid: '#14663A', partial: '#7A5600', unpaid: '#9A2A1F' };
// The built-in PDF fonts have no rupee glyph, so amounts are written as "Rs."
const num = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const stateLine = (code) => (code ? `${STATES[code] || 'State'} (${code})` : '');

// Takes the frozen invoice snapshot (see services/invoice.js) plus trip, vehicle, driver and an optional signature image.
export function buildInvoice({ invoice: inv, trip, vehicle, driver, signature }, { compress = true } = {}) {
  const s = inv.supplier, b = inv.buyer;
  const doc = new PDFDocument({ size: 'A4', margin: 40, compress, info: { Title: `Invoice ${inv.no}`, Author: s.name } });
  const L = 40, R = 555, W = R - L;

  // header: supplier on the left, invoice details on the right
  doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text(s.name, L, 40, { width: 290 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTE);
  let y = 63;
  [s.branch, s.address, [s.phone, s.email].filter(Boolean).join('  |  '), s.gstin && `GSTIN: ${s.gstin}`, s.stateCode && `State: ${stateLine(s.stateCode)}`]
    .filter(Boolean).forEach((line) => { doc.text(line, L, y, { width: 290 }); y += 11; });
  doc.font('Helvetica-Bold').fontSize(21).fillColor(TEAL).text(s.gstin ? 'TAX INVOICE' : 'INVOICE', L, 40, { width: W, align: 'right' });
  [['Invoice no', inv.no], ['Date', day(inv.date)], ['Due date', day(inv.dueDate)], ['Trip', trip.tripNo], ['Place of supply', stateLine(inv.placeOfSupplyCode) || '-'], ['Reverse charge', 'No']]
    .forEach(([k, v], i) => {
      doc.font('Helvetica').fontSize(9).fillColor(MUTE).text(k, 330, 70 + i * 13, { width: 90 });
      doc.fillColor(INK).text(String(v), 400, 70 + i * 13, { width: R - 400, align: 'right' });
    });
  doc.moveTo(L, 158).lineTo(R, 158).strokeColor(LINE).lineWidth(1).stroke();

  // bill to + payment status
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTE).text('Billed to', L, 170);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(b.name, L, 183, { width: 330 });
  y = doc.y + 2;
  doc.font('Helvetica').fontSize(9).fillColor(MUTE);
  [b.address, b.gstin && `GSTIN: ${b.gstin}`, b.stateCode && `State: ${stateLine(b.stateCode)}`].filter(Boolean).forEach((line) => { doc.text(line, L, y, { width: 330 }); y += 11; });
  const status = trip.paymentStatus || 'unpaid';
  doc.roundedRect(R - 100, 172, 100, 28, 6).lineWidth(1.5).strokeColor(STATUS_COLOR[status]).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(STATUS_COLOR[status]).text(status.toUpperCase(), R - 100, 180, { width: 100, align: 'center' });

  // line item
  y = Math.max(y + 14, 250);
  doc.rect(L, y, W, 22).fill(TINT);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTE).text('Description', L + 8, y + 7).text('SAC', 380, y + 7, { width: 50, align: 'center' }).text('Taxable value (Rs.)', L, y + 7, { width: W - 8, align: 'right' });
  y += 32;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(`Freight: ${trip.origin} to ${trip.destination}`, L + 8, y, { width: 300 });
  const rowEnd = doc.y;
  doc.font('Helvetica').fontSize(9.5).text(inv.sac, 380, y, { width: 50, align: 'center' }).text(num(inv.taxable), L, y, { width: W - 8, align: 'right' });
  y = rowEnd + 3;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTE);
  [trip.distanceKm ? `Distance: ${trip.distanceKm} km` : null, trip.cargo ? `Cargo: ${trip.cargo}${trip.cargoWeightKg ? ` (${trip.cargoWeightKg} kg)` : ''}` : null, vehicle?.plate ? `Vehicle: ${vehicle.plate}` : null, driver?.name ? `Driver: ${driver.name}` : null]
    .filter(Boolean).forEach((t) => { doc.text(t, L + 8, y, { width: 300 }); y += 11; });
  y += 8;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).stroke();

  // totals with the GST split
  y += 12;
  const row = (label, value, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11.5 : 9.5).fillColor(INK);
    doc.text(label, 330, y, { width: 140 }).text(value, 330, y, { width: R - 330 - 8, align: 'right' });
    y += bold ? 21 : 16;
  };
  row('Taxable value', `Rs. ${num(inv.taxable)}`);
  if (inv.mode === 'intra') { row(`CGST @ ${inv.rate / 2}%`, `Rs. ${num(inv.cgst)}`); row(`SGST @ ${inv.rate / 2}%`, `Rs. ${num(inv.sgst)}`); }
  if (inv.mode === 'inter') row(`IGST @ ${inv.rate}%`, `Rs. ${num(inv.igst)}`);
  doc.moveTo(330, y).lineTo(R, y).strokeColor(INK).stroke(); y += 7;
  row('Total', `Rs. ${num(inv.total)}`, true);
  doc.font('Helvetica').fontSize(8.5).fillColor(STATUS_COLOR[status]);
  if (status !== 'paid') doc.text(status === 'partial' ? 'Part payment received. Balance due.' : 'Payment due.', 330, y, { width: R - 338, align: 'right' });

  y += 30;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTE).text('Amount in words', L, y);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(amountInWords(inv.total), L, y + 11, { width: W });
  y = doc.y + 22;

  // trip timeline and proof of delivery
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Trip details', L, y);
  y += 15;
  [['Scheduled', day(trip.scheduledAt)], ['Started', day(trip.startedAt)], ['Completed', day(trip.completedAt)]].forEach(([k, v], i) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTE).text(k, L + i * 120, y);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(v, L + i * 120, y + 11);
  });
  if (trip.pod?.receiverName) {
    y += 36;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTE).text('Proof of delivery', L, y);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(`Received by ${trip.pod.receiverName} on ${day(trip.pod.deliveredAt)}`, L, y + 11, { width: 340 });
    if (signature) { try { doc.image(signature, 400, y - 4, { fit: [150, 50] }); } catch { /* an unreadable signature must not block the invoice */ } }
  }

  doc.font('Helvetica').fontSize(8).fillColor(MUTE).text('This is a computer-generated invoice and does not require a signature.', L, 770, { width: W, align: 'center', lineBreak: false });
  return doc;
}

export const invoiceBuffer = (data, opts) => new Promise((resolve, reject) => {
  const doc = buildInvoice(data, opts);
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
  doc.end();
});
