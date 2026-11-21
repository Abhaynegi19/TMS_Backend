// India GST helpers: state codes, GSTIN validation, tax split, amount in words, financial year.
export const STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// The 15th GSTIN character is a mod-36 checksum of the first 14.
export const gstinCheckChar = (first14) => {
  let sum = 0;
  [...first14].forEach((ch, i) => {
    const p = CHARS.indexOf(ch) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  });
  return CHARS[(36 - (sum % 36)) % 36];
};
export const gstinValid = (g) =>
  typeof g === 'string' && /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) && Boolean(STATES[g.slice(0, 2)]) && gstinCheckChar(g.slice(0, 14)) === g[14];
export const stateOf = (gstin) => (gstin && gstin.length >= 2 ? gstin.slice(0, 2) : '');

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Same state => CGST + SGST (half each). Different states => IGST. If a state is unknown the supply is treated as intra-state.
export function computeGst({ taxable, rate, supplierState, supplyState }) {
  const base = round2(taxable || 0);
  const r = Number(rate) || 0;
  if (!r) return { mode: 'none', taxable: base, rate: 0, cgst: 0, sgst: 0, igst: 0, total: base };
  if (supplierState && supplyState && supplierState !== supplyState) {
    const igst = round2((base * r) / 100);
    return { mode: 'inter', taxable: base, rate: r, cgst: 0, sgst: 0, igst, total: round2(base + igst) };
  }
  const half = round2((base * r) / 200);
  return { mode: 'intra', taxable: base, rate: r, cgst: half, sgst: half, igst: 0, total: round2(base + half * 2) };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
const three = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', n % 100 ? two(n % 100) : ''].filter(Boolean).join(' ');
function words(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${words(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}
// Indian numbering: "Rupees Forty Nine Thousand Five Hundred Sixty Only"
export function amountInWords(amount) {
  const total = Math.round(Number(amount || 0) * 100);
  const rupees = Math.floor(total / 100), paise = total % 100;
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

// Indian financial year (1 Apr - 31 Mar) as "2627", evaluated in IST.
export function fiscalYear(date = new Date()) {
  const ist = new Date(new Date(date).getTime() + 19800000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`;
}
