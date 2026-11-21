import { round2 } from './gst.js';

// Most specific active card wins: customer-specific + vehicle type > customer-specific > default for type > default.
export function pickRateCard(cards, { customerId, vehicleType }) {
  const fits = cards.filter((c) => c.isActive !== false
    && (!c.customer || String(c.customer?._id ?? c.customer) === String(customerId))
    && (c.vehicleType === 'any' || !c.vehicleType || c.vehicleType === vehicleType));
  const score = (c) => (c.customer ? 4 : 0) + (c.vehicleType && c.vehicleType !== 'any' ? 2 : 0);
  return fits.sort((a, b) => score(b) - score(a))[0] || null;
}

// fare = max(minFare, baseFare + perKm * km + perTonne * tonnes)
export function calcFare(card, { distanceKm = 0, cargoWeightKg = 0 }) {
  const base = Number(card.baseFare) || 0;
  const distance = (Number(card.perKm) || 0) * Number(distanceKm);
  const weight = (Number(card.perTonne) || 0) * (Number(cargoWeightKg) / 1000);
  const sum = round2(base + distance + weight);
  const min = Number(card.minFare) || 0;
  return { fare: round2(Math.max(sum, min)), base: round2(base), distance: round2(distance), weight: round2(weight), minApplied: min > sum };
}
