import ExcelJS from 'exceljs';
import { toCsv, wallClock } from '../utils/csv.js';

const NUMFMT = { date: 'dd-mmm-yyyy', datetime: 'dd-mmm-yyyy hh:mm', money: '#,##0.00', number: '#,##0.##' };
const cell = (v, type) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : wallClock(v); // shown as the wall-clock time in REPORT_TZ
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return type === 'money' && typeof v === 'number' ? Math.round(v * 100) / 100 : v;
};

// One Excel workbook, one sheet per dataset: bold frozen header, filters, formatted dates and amounts.
export async function toXlsx(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = process.env.COMPANY_NAME || 'Haulwise';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(c.width || 14, c.header.length + 2), style: c.type ? { numFmt: NUMFMT[c.type] } : {} }));
    for (const r of s.rows) ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, cell(r[c.key], c.type)])));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16212B' } };
    head.alignment = { vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export { toCsv };

export const stamp = (d = new Date()) => d.toISOString().slice(0, 10);
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
