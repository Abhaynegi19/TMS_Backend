import Customer from '../models/Customer.js';
import Trip from '../models/Trip.js';
import { computeGst, stateOf } from '../utils/gst.js';
import { nextInvoiceNo } from '../utils/counter.js';

// Issues the invoice for a completed trip once, freezing the figures (rate, tax split, parties) so later
// changes to GST_RATE, customer or branch details never alter an invoice that was already issued.
export async function ensureInvoice(trip, branch) {
  if (trip.invoice?.no) return { invoice: trip.invoice, created: false };
  const customer = trip.customerRef ? await Customer.findById(trip.customerRef) : null;
  const supplierGstin = branch.gstin || process.env.COMPANY_GSTIN || '';
  const supplierState = branch.stateCode || stateOf(supplierGstin);
  const buyerState = customer?.stateCode || stateOf(customer?.gstin);
  const gst = computeGst({ taxable: trip.fare, rate: process.env.GST_RATE || '5', supplierState, supplyState: buyerState || supplierState });
  const issuedAt = new Date();
  const no = trip.invoiceNo || (await nextInvoiceNo(branch, issuedAt));
  const invoice = {
    no, date: issuedAt, dueDate: new Date(issuedAt.getTime() + (customer?.paymentTermsDays ?? 30) * 864e5),
    sac: process.env.INVOICE_SAC_CODE || '9965', ...gst, placeOfSupplyCode: buyerState || supplierState || '',
    supplier: {
      name: process.env.COMPANY_NAME || 'Haulwise', branch: branch.name, address: [branch.address, branch.city].filter(Boolean).join(', '),
      phone: branch.phone || '', email: branch.email || '', gstin: supplierGstin, stateCode: supplierState || '',
    },
    buyer: {
      name: customer?.name || trip.customer, address: [customer?.address, customer?.city].filter(Boolean).join(', '),
      gstin: customer?.gstin || '', stateCode: buyerState || '', email: customer?.email || '',
    },
  };
  // Conditional write: if two requests race, only the first one wins and both return the same invoice.
  const r = await Trip.updateOne({ _id: trip._id, invoice: { $exists: false } }, { $set: { invoice, invoiceNo: no, invoicedAt: issuedAt } });
  const fresh = await Trip.findById(trip._id).select('invoice invoiceNo invoicedAt');
  trip.invoice = fresh.invoice; trip.invoiceNo = fresh.invoiceNo; trip.invoicedAt = fresh.invoicedAt;
  return { invoice: fresh.invoice, created: r.modifiedCount > 0 };
}
