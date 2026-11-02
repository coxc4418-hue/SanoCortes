// SanoCortes — Catálogo de la barbería: servicios, barberos, club, ficha de estilo y utilidades de agenda
export const SERVICE_CATEGORIES = ['Cortes', 'Barba', 'Combos', 'Color y química', 'Tratamientos', 'Niños', 'Extras'];

/** Servicios iniciales (precios de referencia en USD; se adaptan a la moneda del país la primera vez) */
export const DEFAULT_SERVICES = [
  { id: 'corte', name: 'Corte clásico', category: 'Cortes', minutes: 30, price: 8, color: '#d49a3a', active: true, online: true },
  { id: 'fade', name: 'Degradado (fade)', category: 'Cortes', minutes: 40, price: 10, color: '#f59e0b', active: true, online: true },
  { id: 'tijera', name: 'Corte a tijera', category: 'Cortes', minutes: 45, price: 12, color: '#b45309', active: true, online: true },
  { id: 'barba', name: 'Arreglo de barba', category: 'Barba', minutes: 20, price: 5, color: '#0ea5e9', active: true, online: true },
  { id: 'afeitado', name: 'Afeitado clásico con toalla caliente', category: 'Barba', minutes: 30, price: 8, color: '#0284c7', active: true, online: true },
  { id: 'combo', name: 'Corte + barba', category: 'Combos', minutes: 50, price: 12, color: '#dc2626', active: true, online: true },
  { id: 'vip', name: 'Experiencia VIP (corte, barba, mascarilla y bebida)', category: 'Combos', minutes: 75, price: 20, color: '#7c3aed', active: true, online: true },
  { id: 'nino', name: 'Corte de niño (hasta 12 años)', category: 'Niños', minutes: 25, price: 6, color: '#16a34a', active: true, online: true },
  { id: 'cejas', name: 'Perfilado de cejas', category: 'Extras', minutes: 10, price: 3, color: '#db2777', active: true, online: true },
  { id: 'diseno', name: 'Diseño / líneas', category: 'Extras', minutes: 15, price: 3, color: '#14b8a6', active: true, online: true },
  { id: 'lavado', name: 'Lavado y peinado', category: 'Extras', minutes: 15, price: 3, color: '#64748b', active: true, online: false },
  { id: 'tinte', name: 'Tinte / cubrir canas', category: 'Color y química', minutes: 45, price: 15, color: '#9333ea', active: true, online: true },
  { id: 'decolor', name: 'Decoloración / mechas', category: 'Color y química', minutes: 90, price: 30, color: '#a855f7', active: true, online: false },
  { id: 'keratina', name: 'Keratina / alisado', category: 'Tratamientos', minutes: 90, price: 35, color: '#ea580c', active: true, online: false },
  { id: 'mascarilla', name: 'Mascarilla facial negra', category: 'Tratamientos', minutes: 15, price: 5, color: '#334155', active: true, online: true }
];

/** Planes del club (prepago): N servicios incluidos durante D días */
export const DEFAULT_PLANS = [
  { id: 'club4', name: 'Club mensual · 4 cortes', price: 26, visits: 4, days: 30, services: ['corte', 'fade', 'tijera', 'nino'], active: true, note: 'Ahorra 2 cortes al mes' },
  { id: 'clubpro', name: 'Club Pro · 4 corte + barba', price: 40, visits: 4, days: 30, services: ['combo', 'corte', 'fade', 'barba'], active: true, note: 'Siempre impecable' },
  { id: 'barba8', name: 'Paquete barba · 8 arreglos', price: 32, visits: 8, days: 60, services: ['barba', 'afeitado'], active: true, note: '' }
];

export const BARBER_COLORS = ['#d49a3a', '#dc2626', '#0ea5e9', '#16a34a', '#7c3aed', '#db2777', '#14b8a6', '#ea580c', '#2563eb', '#64748b'];
/** Esquema de pago del barbero */
export const PAY_MODES = {
  comision: { label: 'Comisión por servicio', hint: 'El barbero gana un % de cada servicio que hace.' },
  alquiler: { label: 'Alquiler de silla', hint: 'El barbero paga una renta fija (semanal) y se queda con lo que cobra.' },
  sueldo: { label: 'Sueldo fijo + comisión', hint: 'Base fija por semana más un % de cada servicio.' }
};

// ---------- Ficha de estilo (la "receta" del corte, para repetirlo igual) ----------
export const FADE_TYPES = ['Sin degradado', 'Low fade', 'Mid fade', 'High fade', 'Taper', 'Skin fade (a cero)', 'Burst fade', 'Drop fade', 'Mohicano / fohawk'];
export const GUARDS = ['0', '0.5', '1', '1.5', '2', '3', '4', '5', '6', '7', '8'];
export const TOP_STYLES = ['Tijera', 'Texturizado', 'Crop francés', 'Pompadour', 'Quiff', 'Peinado de lado', 'Slick back', 'Buzz cut', 'Mullet', 'Rizos definidos', 'Largo / melena'];
export const BEARD_STYLES = ['Sin barba', 'Barba corta (3 días)', 'Barba completa', 'Candado', 'Perilla', 'Bigote', 'Barba degradada', 'Afeitado al ras'];
export const NECKLINE = ['Natural', 'Redondeado', 'Cuadrado', 'Degradado'];
export const HAIR_TYPES = ['Liso', 'Ondulado', 'Rizado', 'Afro', 'Fino', 'Grueso', 'Con entradas', 'Remolino en la coronilla'];
export const SKIN_NOTES = ['Piel sensible', 'Alergia a productos', 'Foliculitis / vellos encarnados', 'Caspa / dermatitis', 'Sin observaciones'];
export const DRINKS = ['Café', 'Agua', 'Refresco', 'Cerveza', 'Té', 'Nada'];

export const LOYALTY_DEFAULT = { enabled: true, every: 10, reward: 'Corte gratis', rewardServiceId: 'corte' };

// ---------- Agenda ----------
export const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Horario de la barbería para un día de la semana → { open, close } en minutos, o null si cierra */
export function hoursFor(schedule, weekday) {
  const s = schedule || {};
  if (!(s.days || []).includes(weekday)) return null;
  const o = weekday === 6 ? s.satOpen || s.open : weekday === 0 ? s.sunOpen : s.open;
  const c = weekday === 6 ? s.satClose || s.close : weekday === 0 ? s.sunClose : s.close;
  if (!o || !c) return null;
  return { open: toMin(o), close: toMin(c) };
}
/** Horario de un barbero un día (su propio turno dentro del horario del local) */
export function barberHours(barber, schedule, weekday) {
  const h = hoursFor(schedule, weekday);
  if (!h || !barber || barber.active === false) return null;
  if (Array.isArray(barber.days) && barber.days.length && !barber.days.includes(weekday)) return null;
  const open = Math.max(h.open, barber.from ? toMin(barber.from) : 0);
  const close = Math.min(h.close, barber.to ? toMin(barber.to) : 24 * 60);
  return close > open ? { open, close, breakFrom: barber.breakFrom ? toMin(barber.breakFrom) : null, breakTo: barber.breakTo ? toMin(barber.breakTo) : null } : null;
}
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/**
 * Horarios libres de un barbero en un día.
 * busy: [[inicio, fin], ...] en minutos. step: intervalo de la agenda. minFrom: no antes de (p. ej. ahora + anticipación).
 */
export function freeSlots({ barber, schedule, weekday, busy = [], minutes = 30, step = 15, minFrom = 0 }) {
  const h = barberHours(barber, schedule, weekday);
  if (!h) return [];
  const out = [];
  for (let t = h.open; t + minutes <= h.close; t += step) {
    if (t < minFrom) continue;
    if (h.breakFrom != null && h.breakTo != null && overlaps(t, t + minutes, h.breakFrom, h.breakTo)) continue;
    if (busy.some(([s, e]) => overlaps(t, t + minutes, s, e))) continue;
    out.push(t);
  }
  return out;
}

/** Días promedio entre visitas (con al menos 2 visitas) */
export function avgInterval(dates) {
  const d = [...new Set((dates || []).map((x) => String(x).slice(0, 10)))].sort();
  if (d.length < 2) return null;
  const ms = (k) => new Date(k + 'T12:00').getTime();
  const gaps = [];
  for (let i = 1; i < d.length; i++) gaps.push((ms(d[i]) - ms(d[i - 1])) / 864e5);
  const recent = gaps.slice(-6);
  return Math.max(5, Math.round(recent.reduce((a, b) => a + b, 0) / recent.length));
}

/** Resumen corto de la receta del corte: "Mid fade · lados 1 → arriba tijera · barba candado" */
export function styleLine(st) {
  if (!st) return '';
  const p = [];
  if (st.fade && st.fade !== 'Sin degradado') p.push(st.fade);
  if (st.sides) p.push(`lados #${st.sides}`);
  if (st.top) p.push(`arriba ${st.top}`);
  if (st.topStyle) p.push(st.topStyle);
  if (st.beard && st.beard !== 'Sin barba') p.push(`barba: ${st.beard.toLowerCase()}`);
  if (st.neck && st.neck !== 'Natural') p.push(`nuca ${st.neck.toLowerCase()}`);
  return p.join(' · ');
}
