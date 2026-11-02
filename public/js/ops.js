// SanoCortes — Operaciones: clientes, agenda, turnos, cobros, club, fidelidad, barberos, caja e inventario
import { auth } from './firebase.js';
import { store, OPEN_STATUS } from './store.js';
import { round2, round4, nowISO, todayKey, dayKey, PAY_METHODS, addDays, fromKey, loc, usd, fmtDate } from './utils.js';
import { toMin, minToTime, nowMin, avgInterval, barberHours, styleLine } from './barber.js';

export const APP_URL = 'https://sano-cortes.web.app';
export const by = () => (auth.currentUser?.isAnonymous ? 'demo' : (auth.currentUser?.email || '').split('@')[0] || '—');
const FLOW0 = () => ({ inUSD: 0, inBs: 0, outUSD: 0, outBs: 0 });

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genCode(n = 8) {
  return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => CODE_ALPHA[x % CODE_ALPHA.length]).join('');
}
export const cardUrl = (code) => `${APP_URL}/tarjeta/${code}`;
export const bookingUrl = (slug) => `${APP_URL}/reservar/${slug}`;
export const fmtSeq = (prefix, n, len = 5) => `${prefix}-${String(n).padStart(len, '0')}`;
export { toMin, minToTime };

// ======================================================================
// TOTALES
// ======================================================================
export function itemsTotal(items) { return round2((items || []).reduce((a, i) => a + (Number(i.price) || 0) * (Number(i.qty) || 0), 0)); }
export function itemsCost(items) { return round2((items || []).reduce((a, i) => a + (Number(i.cost) || 0) * (Number(i.qty) || 0), 0)); }
export function cleanItems(items) {
  return (items || []).filter((i) => i && i.name && Number(i.qty) > 0).map((i) => ({
    productId: i.productId || null, serviceId: i.serviceId || null, planId: i.planId || null, barberId: i.barberId || null, barber: i.barberId ? (store.barber(i.barberId)?.name || i.barber || '') : '',
    name: String(i.name), qty: round4(Number(i.qty)), price: round2(Number(i.price) || 0), listPrice: round2(Number(i.listPrice ?? i.price) || 0), cost: round4(Number(i.cost) || 0),
    kind: i.kind || (i.productId ? 'producto' : 'servicio'), club: !!i.club, reward: !!i.reward
  }));
}

// ======================================================================
// PAGOS Y CAJA
// ======================================================================
export function normalizePays(payments) {
  return (payments || []).filter((p) => p.amount > 0.004).map((p) => ({ method: p.method, currency: loc().cur, amount: round2(p.amount), usd: round4(p.amount) }));
}
/** Lo que realmente queda por forma de pago: lo pagado menos el vuelto, que sale del efectivo. */
export function methodNet(sale) {
  const m = {};
  (sale.payments || []).forEach((p) => { m[p.method] = round4((m[p.method] || 0) + (p.usd || 0)); });
  const ch = Number(sale.changeUSD) || 0;
  if (ch > 0.004) m.efectivo = round4((m.efectivo || 0) - ch);
  return m;
}
export function cashFlowOf(payments, changeUSD) {
  const f = FLOW0();
  for (const p of payments) if (PAY_METHODS[p.method]?.cash || p.method === 'efectivo_usd') f.inUSD += p.amount;
  if (changeUSD > 0.004) f.outUSD += round2(changeUSD);
  for (const k in f) f[k] = round2(f[k]);
  return f;
}
function shiftIncrements(flow, extra = {}) {
  const u = {};
  for (const k of ['inUSD', 'inBs', 'outUSD', 'outBs']) if (flow[k]) u[k] = store.inc(flow[k]);
  for (const [k, v] of Object.entries(extra)) if (v) u[k] = store.inc(round4(v));
  u.updatedAt = nowISO();
  return u;
}
function preparePayment({ amount, payments }) {
  const shift = store.openShift;
  if (!shift) throw new Error('Abre la caja antes de cobrar (menú Caja).');
  const pays = normalizePays(payments);
  const paidUSD = round4(pays.reduce((a, p) => a + p.usd, 0));
  if (paidUSD < amount - 0.01) throw new Error(`Falta por cobrar ${usd(amount - paidUSD)}.`);
  const changeUSD = round2(Math.max(0, paidUSD - amount));
  const flow = cashFlowOf(pays, changeUSD);
  return { rate: 1, shift, pays, paidUSD, changeUSD, changeCurrency: 'USD', flow, received: round2(paidUSD - changeUSD) };
}
const NO_PAY = () => ({ rate: 1, shift: store.openShift || null, pays: [], paidUSD: 0, changeUSD: 0, changeCurrency: 'USD', flow: FLOW0(), received: 0 });
function addToShift(b, pay) {
  if (!pay.shift || !(pay.received > 0)) return;
  const byMethod = {};
  for (const [k, v] of Object.entries(methodNet({ payments: pay.pays, changeUSD: pay.changeUSD }))) byMethod[`byMethod.${k}`] = v;
  b.update(store.ref('cash_shifts', pay.shift.id), shiftIncrements(pay.flow, { salesCount: 1, salesTotal: pay.received, ...byMethod }));
}
function paymentFields(pay) {
  return {
    rate: 1, payments: pay.pays, paidUSD: pay.paidUSD, changeUSD: pay.changeUSD, changeCurrency: 'USD',
    method: pay.pays.length === 1 ? pay.pays[0].method : pay.pays.length ? 'mixto' : 'ninguno', received: pay.received,
    shiftId: pay.shift?.id || null, cashFlow: pay.flow
  };
}
export function clientFields(c) {
  return { memberId: c?.id || null, memberName: c?.name || 'Cliente de paso', memberPhone: c?.phone || '', memberIdDoc: c?.idDoc || '', memberNumber: c?.number || '' };
}
function newSale(b, { kind, items, discount = 0, pay, client, extra = {} }) {
  const seq = store.nextSeq(b, 'inv');
  const number = fmtSeq(store.settings.invoicePrefix || 'R', seq, 6);
  const ref = store.newRef('sales');
  const subtotal = itemsTotal(items);
  const total = round2(subtotal - discount);
  const barberIds = [...new Set(items.map((i) => i.barberId).filter(Boolean))];
  const sale = {
    number, seq, kind, date: nowISO(), dayKey: todayKey(), items: items.map((x) => ({ ...x, total: round2(x.price * x.qty) })),
    subtotal, discount: round2(discount), total, cost: itemsCost(items), ...paymentFields(pay), ...clientFields(client), barberIds, status: 'completed', by: by(), ...extra
  };
  b.set(ref, sale);
  addToShift(b, pay);
  return { id: ref.id, ...sale };
}

// ======================================================================
// INVENTARIO: descuento de productos vendidos
// ======================================================================
function applyStockDelta(b, oldItems, newItems, refLabel, type = 'venta') {
  const qtyMap = (items) => {
    const m = new Map();
    (items || []).forEach((i) => { if (i.productId) m.set(i.productId, (m.get(i.productId) || 0) + (Number(i.qty) || 0)); });
    return m;
  };
  const before = qtyMap(oldItems); const after = qtyMap(newItems);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const date = nowISO();
  const low = [];
  for (const id of ids) {
    const p = store.product(id);
    const delta = round4((after.get(id) || 0) - (before.get(id) || 0));
    if (!p || !delta || p.trackStock === false) continue;
    b.update(store.ref('products', id), { stock: store.inc(-delta), ...(delta > 0 ? { sold: store.inc(delta) } : {}), updatedAt: date });
    b.set(store.newRef('inventory_logs'), { productId: id, name: p.name, date, dayKey: todayKey(), type: delta > 0 ? type : 'devolucion', qty: -delta, cost: Number(p.cost) || 0, reason: refLabel, by: by() });
    const left = (Number(p.stock) || 0) - delta;
    if (delta > 0 && left <= (Number(p.minStock) || 0)) low.push({ ...p, stock: left });
  }
  return low;
}
function checkStock(items) {
  for (const l of items) {
    const p = l.productId && store.product(l.productId);
    if (p && p.trackStock !== false && (Number(p.stock) || 0) < l.qty - 1e-9) throw new Error(`No hay suficiente ${p.name} (quedan ${Number(p.stock) || 0}).`);
  }
}

// ======================================================================
// TARJETA DEL CLIENTE (colección pública cards/{código}: datos mínimos)
// ======================================================================
export function cardData(c, extra = {}) {
  const first = String(c.name || '').trim().split(/\s+/);
  const ms = c.membership && c.membership.status !== 'anulada' ? c.membership : null;
  const L = store.loyalty;
  const next = store.nextAppointmentOf ? store.nextAppointmentOf(c.id) : null;
  return {
    tenantId: store.tenantId, shop: store.businessName, shopPhone: store.settings.whatsapp || store.settings.phone || '', shopAddress: store.settings.address || '',
    instagram: store.settings.instagram || '', country: store.settings.country || '', bookingSlug: store.settings.booking?.enabled ? store.settings.booking.slug || '' : '',
    name: first.length > 1 ? `${first[0]} ${first[first.length - 1]}` : first[0] || 'Cliente', number: c.number || '', active: c.active !== false,
    stamps: Number(c.stamps) || 0, rewards: Number(c.rewards) || 0, loyalty: L?.enabled ? { every: Number(L.every) || 10, reward: L.reward || 'Corte gratis' } : null,
    visits: Number(c.visits) || 0, lastVisitAt: c.lastVisitAt || null, avgDays: c.avgDays || null, barber: store.barber(c.barberId)?.name || '',
    style: c.lastStyle ? styleLine(c.lastStyle) : '',
    club: ms ? { name: ms.name, start: ms.start, end: ms.end, visits: ms.visits, left: ms.left } : null,
    next: next ? { date: next.date, time: next.time, barber: next.barberName || '', services: next.serviceNames || '' } : null,
    updatedAt: nowISO(), ...extra
  };
}
function putCard(b, c, extra = {}) {
  if (!c?.cardCode) return;
  b.set(store.cardRef(c.cardCode), cardData(c, extra), { merge: true });
}
/** Actualiza la tarjeta pública (p. ej. al crear o mover una cita) */
export async function refreshCard(c, extra = {}) {
  if (!c?.cardCode) return;
  const b = store.batch();
  putCard(b, c, extra);
  await store.commit(b);
}

// ======================================================================
// CLIENTES
// ======================================================================
const CLIENT_FIELDS = ['name', 'phone', 'email', 'idDoc', 'birthDate', 'sex', 'notes', 'tags', 'barberId', 'hairType', 'skin', 'drink', 'allergies', 'referredBy', 'instagram', 'guardianName', 'hasPhoto'];
export function cleanClient(data) {
  const out = {};
  for (const k of CLIENT_FIELDS) {
    if (data[k] === undefined) continue;
    out[k] = Array.isArray(data[k]) ? data[k].map((x) => String(x).trim()).filter(Boolean) : typeof data[k] === 'boolean' ? data[k] : String(data[k] ?? '').trim();
  }
  if (out.name) out.name = out.name.replace(/\s+/g, ' ');
  if (out.idDoc) out.idDoc = out.idDoc.toUpperCase().replace(/\s+/g, '');
  return out;
}
function newClientDoc(b, data) {
  const clean = cleanClient(data);
  if (!clean.name) throw new Error('Escribe el nombre del cliente.');
  const dup = clean.phone && store.findByPhone(clean.phone);
  if (dup) throw new Error(`Ya existe un cliente con ese teléfono: ${dup.name} (${dup.number}).`);
  const ref = store.newRef('clients');
  const seq = store.nextSeq(b, 'cli');
  const date = nowISO();
  const c = { ...clean, number: fmtSeq('C', seq, 4), seq, cardCode: genCode(8), active: true, visits: 0, totalSpent: 0, balance: 0, noShows: 0, stamps: 0, rewards: 0, visitDates: [], membership: null, lastVisitAt: null, createdAt: date, updatedAt: date, by: by() };
  b.set(ref, c);
  const out = { id: ref.id, ...c };
  putCard(b, out);
  return out;
}
export async function saveClient(data, id = null) {
  const b = store.batch();
  if (!id) {
    const c = newClientDoc(b, data);
    await store.commit(b);
    return c;
  }
  const clean = cleanClient(data);
  const dup = clean.phone && store.findByPhone(clean.phone, id);
  if (dup) throw new Error(`Ya existe un cliente con ese teléfono: ${dup.name} (${dup.number}).`);
  b.set(store.ref('clients', id), { ...clean, updatedAt: nowISO() }, { merge: true });
  const c = { ...(store.client(id) || {}), ...clean, id };
  putCard(b, c);
  await store.commit(b);
  return c;
}
export async function setClientActive(c, active, reason = '') {
  const b = store.batch();
  b.set(store.ref('clients', c.id), { active, updatedAt: nowISO(), ...(active ? { leftAt: null, leftReason: '' } : { leftAt: nowISO(), leftReason: reason }) }, { merge: true });
  putCard(b, { ...c, active });
  await store.commit(b);
}
export async function renewCardCode(c) {
  const b = store.batch();
  const code = genCode(8);
  if (c.cardCode) b.delete(store.cardRef(c.cardCode));
  b.set(store.ref('clients', c.id), { cardCode: code, updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...c, cardCode: code });
  await store.commit(b);
  return code;
}
/** Cliente existente por id, por teléfono, o nuevo (dentro del mismo lote) */
function resolveClient(b, client) {
  if (!client) return null;
  if (client.id) return store.client(client.id) || client;
  const dup = client.phone && store.findByPhone(client.phone);
  if (dup) return dup;
  if (!String(client.name || '').trim()) return null;
  return newClientDoc(b, client);
}

// ======================================================================
// AGENDA: citas, turnos sin cita y solicitudes en línea
// ======================================================================
/** Servicios elegidos → detalle, duración y precio estimado */
export function pickServices(ids) {
  const services = (ids || []).map((id) => store.service(id)).filter(Boolean).map((s) => ({ id: s.id, name: s.name, price: round2(Number(s.price) || 0), minutes: Number(s.minutes) || 30 }));
  const minutes = services.reduce((a, s) => a + s.minutes, 0) || 30;
  return { services, minutes, total: round2(services.reduce((a, s) => a + s.price, 0)), names: services.map((s) => s.name).join(' + ') };
}
/** Cita que se cruza con ese horario del barbero (o null) */
export function conflictOf(barberId, date, start, minutes, exceptId = null) {
  const end = start + minutes;
  return store.apptsFor(barberId, date).find((a) => a.id !== exceptId && a.status !== 'terminada' && (a.start ?? toMin(a.time)) < end && start < (a.end ?? toMin(a.time) + 30)) || null;
}
/** Avisos de horario: fuera del turno del barbero, en su descanso o en el pasado */
export function scheduleWarnings(barberId, date, start, minutes) {
  const w = [];
  const b = store.barber(barberId);
  const h = barberHours(b, store.settings.schedule, fromKey(date).getDay());
  if (!h) w.push(`${b?.name || 'El barbero'} no trabaja ese día.`);
  else {
    if (start < h.open || start + minutes > h.close) w.push(`Fuera del horario de ${b.name} (${minToTime(h.open)} a ${minToTime(h.close)}).`);
    if (h.breakFrom != null && start < h.breakTo && h.breakFrom < start + minutes) w.push(`Se cruza con su descanso (${minToTime(h.breakFrom)}–${minToTime(h.breakTo)}).`);
  }
  if (date < todayKey() || (date === todayKey() && start + minutes < nowMin())) w.push('Ese horario ya pasó.');
  return w;
}

/**
 * Crea o actualiza una cita. client: cliente existente ({id}) o datos de uno nuevo ({name, phone}).
 * force: permite guardar aunque se cruce con otra cita o esté fuera de horario.
 */
export async function saveAppointment({ id = null, client, date, time, barberId, serviceIds, note = '', status = null, source = 'local', force = false }) {
  if (!barberId || !store.barber(barberId)) throw new Error('Elige el barbero.');
  if (!date || !time) throw new Error('Elige la fecha y la hora.');
  const sv = pickServices(serviceIds);
  if (!sv.services.length) throw new Error('Elige al menos un servicio.');
  const start = toMin(time);
  const minutes = sv.minutes + (Number(store.settings.agenda.buffer) || 0);
  if (!force) {
    const c = conflictOf(barberId, date, start, minutes, id);
    if (c) throw Object.assign(new Error(`${store.barber(barberId).name} ya tiene a ${c.clientName} de ${c.time} a ${minToTime(c.end)}.`), { code: 'conflict' });
    const w = scheduleWarnings(barberId, date, start, minutes);
    if (w.length) throw Object.assign(new Error(w.join(' ')), { code: 'schedule' });
  }
  const b = store.batch();
  const cl = resolveClient(b, client);
  const barber = store.barber(barberId);
  const prev = id ? store.appointments.find((a) => a.id === id) : null;
  const ref = id ? store.ref('appointments', id) : store.newRef('appointments');
  const data = {
    date, time: minToTime(start), start, end: start + minutes, minutes, barberId, barberName: barber.name, barberColor: barber.color || '',
    services: sv.services, serviceIds: sv.services.map((s) => s.id), serviceNames: sv.names, estimate: sv.total,
    clientId: cl?.id || null, clientName: cl?.name || String(client?.name || 'Cliente').trim(), clientPhone: cl?.phone || client?.phone || '',
    note: String(note || '').trim(), updatedAt: nowISO(),
    ...(prev ? {} : { status: status || 'reservada', kind: 'cita', source, createdAt: nowISO(), by: by() }),
    ...(prev && status ? { status } : {}),
    ...(prev && (prev.date !== date || prev.start !== start || prev.barberId !== barberId) ? { remindedAt: null, moved: (prev.moved || 0) + 1 } : {})
  };
  b.set(ref, data, { merge: true });
  const out = { id: ref.id, ...(prev || {}), ...data };
  if (cl) putCard(b, cl, { next: { date, time: data.time, barber: barber.name, services: sv.names } });
  await store.commit(b);
  return out;
}

/** Cliente que llega sin cita: entra a la fila de espera (con el barbero elegido o el primero que se libere) */
export async function addWalkin({ client, serviceIds, barberId = 'any', via = 'recepcion', note = '' }) {
  const sv = pickServices(serviceIds);
  if (!sv.services.length) throw new Error('Elige al menos un servicio.');
  let bId = barberId;
  if (!bId || bId === 'any') {
    const f = store.firstFree();
    if (!f) throw new Error('No hay barberos trabajando en este momento.');
    bId = f.barber.id;
  }
  const barber = store.barber(bId);
  if (!barber) throw new Error('Elige el barbero.');
  const est = store.waitEstimate()[bId];
  const startMin = est ? est.freeAt : nowMin();
  const b = store.batch();
  const cl = resolveClient(b, client);
  const t = todayKey();
  const queueNo = store.nextSeq(b, 'q-' + t);
  const ref = store.newRef('appointments');
  const data = {
    date: t, time: minToTime(startMin), start: startMin, end: startMin + sv.minutes, minutes: sv.minutes, barberId: bId, barberName: barber.name, barberColor: barber.color || '',
    anyBarber: barberId === 'any' || !barberId, services: sv.services, serviceIds: sv.services.map((s) => s.id), serviceNames: sv.names, estimate: sv.total,
    clientId: cl?.id || null, clientName: cl?.name || String(client?.name || 'Cliente').trim() || 'Cliente', clientPhone: cl?.phone || client?.phone || '',
    note: String(note || '').trim(), status: 'espera', kind: 'turno', source: via, queueNo, arrivedAt: nowISO(), createdAt: nowISO(), updatedAt: nowISO(), by: by()
  };
  b.set(ref, data);
  await store.commit(b);
  return { id: ref.id, ...data, wait: est ? est.wait : 0 };
}

/** Cambia el estado de una cita o turno (llegó, a la silla, no vino, cancelada…) */
export async function setApptStatus(a, status, { reason = '', barberId = null } = {}) {
  const b = store.batch();
  const patch = { status, updatedAt: nowISO() };
  const nm = nowMin();
  if (status === 'espera') { patch.arrivedAt = nowISO(); }
  if (status === 'confirmada') patch.confirmedAt = nowISO();
  if (status === 'en_silla') {
    const bid = barberId || a.barberId;
    const busy = store.inChair.find((x) => x.barberId === bid && x.id !== a.id);
    if (busy) throw new Error(`${store.barber(bid)?.name || 'El barbero'} está atendiendo a ${busy.clientName}. Termina ese servicio primero.`);
    const br = store.barber(bid);
    Object.assign(patch, { startedAt: nowISO(), startedMin: nm, barberId: bid, barberName: br?.name || a.barberName, barberColor: br?.color || a.barberColor || '' });
    if (a.kind === 'turno' || a.date === todayKey()) Object.assign(patch, { start: nm, end: nm + (a.minutes || 30), time: minToTime(nm) });
    if (!a.arrivedAt) patch.arrivedAt = nowISO();
  }
  if (status === 'no_vino') { patch.noShowAt = nowISO(); if (a.clientId && store.client(a.clientId)) b.set(store.ref('clients', a.clientId), { noShows: store.inc(1) }, { merge: true }); }
  if (status === 'cancelada') { patch.cancelledAt = nowISO(); patch.cancelReason = reason; }
  if (a.status === 'no_vino' && status !== 'no_vino' && a.clientId && store.client(a.clientId)) b.set(store.ref('clients', a.clientId), { noShows: store.inc(-1) }, { merge: true });
  b.set(store.ref('appointments', a.id), patch, { merge: true });
  if (['cancelada', 'no_vino'].includes(status) && a.clientId) {
    const c = store.client(a.clientId);
    if (c) putCard(b, c, { next: null });
  }
  await store.commit(b);
  return { ...a, ...patch };
}
/** Pasa un turno a otro barbero (o cambia sus servicios) */
export async function reassignTurn(a, { barberId, serviceIds = null }) {
  const br = store.barber(barberId);
  if (!br) throw new Error('Elige el barbero.');
  const patch = { barberId, barberName: br.name, barberColor: br.color || '', anyBarber: false, updatedAt: nowISO() };
  if (serviceIds) { const sv = pickServices(serviceIds); Object.assign(patch, { services: sv.services, serviceIds: sv.services.map((s) => s.id), serviceNames: sv.names, minutes: sv.minutes, estimate: sv.total, end: (a.start || nowMin()) + sv.minutes }); }
  await store.save('appointments', a.id, patch);
}
export async function markReminded(a) { await store.save('appointments', a.id, { remindedAt: nowISO() }); }

/** Acepta una solicitud de la reserva en línea: crea (o reutiliza) el cliente y la cita */
export async function acceptRequest(r, { barberId, time, date, force = false }) {
  const appt = await saveAppointment({
    client: { name: r.name, phone: r.phone }, date: date || r.date, time: time || r.time, barberId: barberId || r.barberId,
    serviceIds: r.serviceIds || [], note: [r.note, 'Reservó en línea'].filter(Boolean).join(' · '), status: 'confirmada', source: 'online', force
  });
  const b = store.batch();
  b.delete(store.requestRef(r.id));
  await store.commit(b);
  return appt;
}
export async function rejectRequest(r) {
  const b = store.batch();
  b.delete(store.requestRef(r.id));
  await store.commit(b);
}
/** Elige el barbero para una solicitud "con cualquiera": el primero libre a esa hora */
export function barberForRequest(r) {
  if (r.barberId && r.barberId !== 'any' && store.barber(r.barberId)) return r.barberId;
  const sv = pickServices(r.serviceIds);
  const start = toMin(r.time);
  const ok = store.activeBarbers.find((b) => b.online !== false && !conflictOf(b.id, r.date, start, sv.minutes) && !scheduleWarnings(b.id, r.date, start, sv.minutes).length);
  return ok?.id || store.activeBarbers[0]?.id || null;
}

// ---------- Página pública de reservas: horarios ocupados de los próximos días ----------
export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'barberia';
}
export function bookingDoc() {
  const s = store.settings; const B = s.booking; const L = loc();
  const days = Math.min(30, Math.max(1, Number(B.daysAhead) || 14));
  const busy = {};
  for (let i = 0; i <= days; i++) {
    const d = dayKey(addDays(new Date(), i));
    const per = {};
    for (const br of store.activeBarbers) {
      const list = store.busyOf(br.id, d).map(([a, e]) => [a, e]);
      if (list.length) per[br.id] = list.flat();
    }
    if (Object.keys(per).length) busy[d] = per;
  }
  return {
    tenantId: store.tenantId, enabled: B.enabled !== false, shop: store.businessName, phone: s.whatsapp || s.phone || '', address: s.address || '', instagram: s.instagram || '',
    country: s.country || '', sym: L.sym, dec: L.dec, dial: L.dial || '', step: Number(s.agenda.step) || 15, leadMinutes: Number(B.leadMinutes) || 0, daysAhead: days, note: B.note || '', rules: s.rules || '',
    schedule: s.schedule,
    services: store.activeServices.filter((x) => x.online !== false).map((x) => ({ id: x.id, name: x.name, minutes: Number(x.minutes) || 30, price: Number(x.price) || 0, category: x.category || '' })),
    barbers: store.activeBarbers.filter((x) => x.online !== false).map((x) => ({ id: x.id, name: x.name, color: x.color || '', specialty: x.specialty || '', days: x.days || [], from: x.from || '', to: x.to || '', breakFrom: x.breakFrom || '', breakTo: x.breakTo || '' })),
    busy, demo: store.isDemo, updatedAt: nowISO()
  };
}
let lastPublished = '';
/** Publica (si cambió) la página de reservas de la barbería */
export async function publishBooking({ force = false } = {}) {
  const B = store.settings.booking;
  if (!B?.slug || !store.tenantId) return false;
  const d = bookingDoc();
  const key = JSON.stringify({ ...d, updatedAt: '' });
  if (!force && key === lastPublished) return false;
  lastPublished = key;
  const b = store.batch();
  b.set(store.bookingRef(B.slug), d);
  await store.commit(b);
  return true;
}
export function resetPublished() { lastPublished = ''; }

// ======================================================================
// COBRO DEL SERVICIO (cierra la cita, registra el corte, sellos y club)
// ======================================================================
export function cartTotals(lines, discount = 0) {
  const subtotal = round2((lines || []).reduce((a, l) => a + l.price * l.qty, 0));
  const disc = round2(Math.min(subtotal, Math.max(0, Number(discount) || 0)));
  return { subtotal, discount: disc, total: round2(subtotal - disc) };
}
/** Comisión que gana el barbero por una línea del recibo */
export function commissionOf(item, barber) {
  if (!barber) return 0;
  const amount = round2((Number(item.price) || 0) * (Number(item.qty) || 0));
  if (item.kind === 'propina') return amount;
  if (barber.mode === 'alquiler') return item.kind === 'servicio' ? amount : round2(amount * (Number(barber.productCommission) || 0) / 100);
  // Un servicio del club o un premio se paga al barbero sobre su precio de lista
  const base = item.kind === 'servicio' && (item.club || item.reward) ? round2((Number(item.listPrice) || 0) * (Number(item.qty) || 0)) : amount;
  if (item.kind === 'servicio') return round2(base * (Number(barber.commission) || 0) / 100);
  if (item.kind === 'producto') return round2(amount * (Number(barber.productCommission) || 0) / 100);
  return 0;
}

/**
 * Cobra un ticket de barbería.
 * lines: [{ kind: 'servicio'|'producto', serviceId|productId, name, price, qty, barberId, club, reward }]
 * tips: [{ barberId, amount }] · credit: parte que queda como deuda del cliente · appt: cita o turno que se cierra
 * style: ficha del corte (receta) que se guarda en el historial del cliente
 */
export async function chargeTicket({ lines, client = null, discount = 0, payments = [], note = '', appt = null, tips = [], credit = 0, style = null }) {
  const tipLines = (tips || []).filter((t) => t.barberId && Number(t.amount) > 0.004).map((t) => ({ kind: 'propina', name: `Propina · ${store.barber(t.barberId)?.name || ''}`, price: round2(t.amount), qty: 1, barberId: t.barberId }));
  const clean = cleanItems([...(lines || []), ...tipLines]);
  if (!clean.length) throw new Error('No hay nada para cobrar.');
  checkStock(clean);
  const b = store.batch();
  const cl = resolveClient(b, client);
  const t = cartTotals(clean, discount);
  const owe = round2(Math.min(t.total, Math.max(0, Number(credit) || 0)));
  if (owe > 0 && !cl) throw new Error('Para dejar saldo pendiente elige o registra al cliente.');
  const toPay = round2(t.total - owe);
  const pay = toPay > 0.004 ? preparePayment({ amount: toPay, payments }) : NO_PAY();
  const services = clean.filter((i) => i.kind === 'servicio');
  const clubUsed = services.filter((i) => i.club).reduce((a, i) => a + i.qty, 0);
  const rewardUsed = services.some((i) => i.reward) ? 1 : 0;
  const L = store.loyalty;
  // Sello: una visita con al menos un servicio pagado (los del club y los premios no suman)
  const stamp = !!(cl && L?.enabled && services.some((i) => !i.club && !i.reward && i.price > 0));
  if (clubUsed && !(cl?.membership && Number(cl.membership.left) >= clubUsed)) throw new Error('El club del cliente no tiene servicios suficientes.');
  if (rewardUsed && !(Number(cl?.rewards) > 0)) throw new Error('El cliente no tiene premios disponibles.');
  const mainBarber = services[0]?.barberId || appt?.barberId || null;
  const sale = newSale(b, {
    kind: services.length ? 'servicio' : 'producto', items: clean, discount: t.discount, pay, client: cl,
    extra: { note, apptId: appt?.id || null, credit: owe, stamp, clubUsed, rewardUsed, membershipId: clubUsed ? cl.membership.id : null, barberId: mainBarber }
  });
  const low = applyStockDelta(b, [], clean, `Venta ${sale.number}`, 'venta');
  const date = nowISO();
  let after = cl ? { ...cl } : null;
  if (cl) {
    const patch = { totalSpent: store.inc(toPay), updatedAt: date };
    if (owe > 0) { patch.balance = store.inc(owe); after.balance = (Number(cl.balance) || 0) + owe; }
    if (services.length) {
      const dates = [...(cl.visitDates || []), todayKey()].slice(-10);
      const avg = avgInterval(dates);
      Object.assign(patch, { visits: store.inc(1), lastVisitAt: date, visitDates: dates, lastBarberId: mainBarber, lastServiceIds: [...new Set(services.map((x) => x.serviceId).filter(Boolean))], ...(avg ? { avgDays: avg } : {}), ...(cl.barberId ? {} : mainBarber ? { barberId: mainBarber } : {}) });
      Object.assign(after, { visits: (Number(cl.visits) || 0) + 1, lastVisitAt: date, visitDates: dates, avgDays: avg || cl.avgDays || null });
      if (style && Object.values(style).some(Boolean)) { patch.lastStyle = style; after.lastStyle = style; }
    }
    let stamps = Number(cl.stamps) || 0; let rewards = Number(cl.rewards) || 0;
    if (rewardUsed) rewards -= 1;
    if (stamp) { stamps += 1; if (stamps >= (Number(L.every) || 10)) { stamps -= Number(L.every) || 10; rewards += 1; sale.earnedReward = true; } }
    if (stamp || rewardUsed) { patch.stamps = stamps; patch.rewards = rewards; after.stamps = stamps; after.rewards = rewards; }
    if (clubUsed) {
      const ms = { ...cl.membership, left: Math.max(0, Number(cl.membership.left) - clubUsed) };
      patch.membership = ms; after.membership = ms;
      b.set(store.ref('memberships', ms.id), { left: store.inc(-clubUsed), updatedAt: date }, { merge: true });
    }
    b.set(store.ref('clients', cl.id), patch, { merge: true });
  }
  if (services.length) {
    const ref = store.newRef('visits');
    b.set(ref, {
      clientId: cl?.id || null, clientName: cl?.name || 'Cliente de paso', date, dayKey: todayKey(), barberId: mainBarber, barberName: store.barber(mainBarber)?.name || '',
      services: services.map((s) => s.name), total: round2(services.reduce((a, s) => a + s.price * s.qty, 0)), saleId: sale.id, saleNumber: sale.number,
      apptId: appt?.id || null, style: style || null, by: by()
    });
    sale.visitId = ref.id;
  }
  if (appt?.id) b.set(store.ref('appointments', appt.id), { status: 'terminada', finishedAt: date, saleId: sale.id, saleNumber: sale.number, paid: t.total, ...(appt.startedAt ? {} : { startedAt: appt.arrivedAt || date }) }, { merge: true });
  if (after) putCard(b, after, appt?.id ? { next: null } : {});
  if (sale.earnedReward) b.update(store.ref('sales', sale.id), { earnedReward: true });
  await store.commit(b);
  return { sale, low, client: after };
}

/** Vende un plan del club (prepago de servicios) */
export async function sellPlan({ client, plan, payments = [], note = '', barberId = null }) {
  if (!plan) throw new Error('Elige un plan.');
  const b = store.batch();
  const cl = resolveClient(b, client);
  if (!cl) throw new Error('Elige o registra al cliente.');
  const price = round2(Number(plan.price) || 0);
  const pay = price > 0.004 ? preparePayment({ amount: price, payments }) : NO_PAY();
  const start = todayKey();
  const end = dayKey(addDays(new Date(), (Number(plan.days) || 30) - 1));
  const msRef = store.newRef('memberships');
  const sale = newSale(b, { kind: 'club', items: cleanItems([{ name: `${plan.name} · ${fmtDate(start)} al ${fmtDate(end)}`, price, qty: 1, planId: plan.id, kind: 'club', barberId }]), pay, client: cl, extra: { membershipId: msRef.id, planId: plan.id, note } });
  const snap = { id: msRef.id, planId: plan.id, name: plan.name, start, end, visits: Number(plan.visits) || 1, left: Number(plan.visits) || 1, services: plan.services || [], status: 'activa' };
  b.set(msRef, { ...clientFields(cl), ...snap, price, saleId: sale.id, prev: cl.membership || null, createdAt: nowISO(), by: by() });
  b.set(store.ref('clients', cl.id), { membership: snap, totalSpent: store.inc(price), updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...cl, membership: snap });
  await store.commit(b);
  return { sale, membership: snap, client: { ...cl, membership: snap } };
}

/** Cobra la deuda (saldo pendiente) del cliente */
export async function payBalance(c, { amount, payments, note = '' }) {
  const bal = round2(Number(c.balance) || 0);
  const amt = round2(Math.min(bal, Number(amount) || 0));
  if (!(amt > 0)) throw new Error('Indica el monto a abonar.');
  const b = store.batch();
  const p = preparePayment({ amount: amt, payments });
  const sale = newSale(b, { kind: 'abono', items: cleanItems([{ name: 'Abono a saldo pendiente', price: amt, qty: 1, kind: 'abono' }]), pay: p, client: c, extra: { note } });
  b.set(store.ref('clients', c.id), { balance: store.inc(-amt), totalSpent: store.inc(amt), updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...c, balance: bal - amt });
  await store.commit(b);
  return { sale };
}

/** Ajuste manual de sellos y premios (cortesía o corrección, con PIN) */
export async function adjustLoyalty(c, { stamps, rewards, reason = '' }) {
  const b = store.batch();
  const patch = { stamps: Math.max(0, Math.round(Number(stamps) || 0)), rewards: Math.max(0, Math.round(Number(rewards) || 0)), updatedAt: nowISO(), loyaltyLog: [...(c.loyaltyLog || []), { at: nowISO(), by: by(), from: [c.stamps || 0, c.rewards || 0], to: [stamps, rewards], reason }].slice(-20) };
  b.set(store.ref('clients', c.id), patch, { merge: true });
  putCard(b, { ...c, ...patch });
  await store.commit(b);
}

/** Anula un recibo: revierte caja, inventario, club, sellos, premios y saldo. */
export async function voidSale(sale, reason = '') {
  if (sale.status === 'voided') throw new Error('El documento ya está anulado.');
  const b = store.batch();
  const date = nowISO();
  b.update(store.ref('sales', sale.id), { status: 'voided', voidedAt: date, voidReason: reason || '', voidedBy: by() });
  applyStockDelta(b, sale.items, [], `Anulación ${sale.number}`, 'venta');
  const c = sale.memberId ? store.client(sale.memberId) : null;
  if (c) {
    const patch = { totalSpent: store.inc(-((sale.received || 0))), updatedAt: date };
    let after = { ...c };
    if (sale.kind === 'abono') { patch.balance = store.inc(sale.total || 0); patch.totalSpent = store.inc(-(sale.total || 0)); }
    if (sale.credit > 0) patch.balance = store.inc(-sale.credit);
    if (sale.kind === 'club' && sale.membershipId) {
      const ms = await store.getDocById('memberships', sale.membershipId);
      b.set(store.ref('memberships', sale.membershipId), { status: 'anulada', voidedAt: date, voidReason: reason }, { merge: true });
      if (c.membership?.id === sale.membershipId) { patch.membership = ms?.prev || null; after.membership = ms?.prev || null; }
    }
    if (sale.clubUsed > 0 && c.membership?.id === sale.membershipId) {
      const ms = { ...c.membership, left: (Number(c.membership.left) || 0) + sale.clubUsed };
      patch.membership = ms; after.membership = ms;
      b.set(store.ref('memberships', sale.membershipId), { left: store.inc(sale.clubUsed) }, { merge: true });
    }
    if (sale.stamp || sale.rewardUsed) {
      const every = Number(store.loyalty.every) || 10;
      let stamps = Number(c.stamps) || 0; let rewards = Number(c.rewards) || 0;
      if (sale.stamp) { if (sale.earnedReward && rewards > 0) { rewards -= 1; stamps += every; } stamps = Math.max(0, stamps - 1); }
      if (sale.rewardUsed) rewards += 1;
      patch.stamps = stamps; patch.rewards = rewards; after.stamps = stamps; after.rewards = rewards;
    }
    if (sale.kind === 'servicio' && sale.visitId) patch.visits = store.inc(-1);
    b.set(store.ref('clients', c.id), patch, { merge: true });
    putCard(b, after);
  }
  if (sale.visitId) b.delete(store.ref('visits', sale.visitId));
  if (sale.apptId) b.set(store.ref('appointments', sale.apptId), { status: 'en_silla', saleId: null, saleNumber: null, finishedAt: null }, { merge: true });
  const shift = store.openShift;
  const f = sale.cashFlow || FLOW0();
  const reverse = { inUSD: f.outUSD || 0, inBs: f.outBs || 0, outUSD: f.inUSD || 0, outBs: f.inBs || 0 };
  let cashReverted = false;
  if (shift && (sale.received || 0) > 0) {
    const extra = {};
    if (sale.shiftId === shift.id) {
      extra.salesCount = -1; extra.salesTotal = -(sale.received || 0);
      for (const [k, v] of Object.entries(methodNet(sale))) extra[`byMethod.${k}`] = -v;
    }
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(reverse, extra));
    if (reverse.inUSD || reverse.outUSD) {
      b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'void', direction: 'out', currency: 'USD', amount: 0, flow: reverse, concept: `Anulación ${sale.number}`, category: 'Anulaciones', refId: sale.id, by: by() });
    }
    cashReverted = true;
  }
  await store.commit(b);
  return { cashReverted };
}

/** Venta de mostrador (solo productos) */
export async function chargeSale({ lines, member = null, discount = 0, payments = [], note = '' }) {
  return chargeTicket({ lines, client: member, discount, payments, note });
}

// ======================================================================
// BARBEROS: liquidación (comisiones, propinas, alquiler de silla, adelantos)
// ======================================================================
const periodDays = (from, to) => Math.max(1, Math.round((fromKey(to) - fromKey(from)) / 864e5) + 1);
/** Liquidación de cada barbero en un período (fechas AAAA-MM-DD) */
export async function payroll(from, to) {
  const [sales, moves, payouts] = await Promise.all([
    store.salesBetween(fromKey(from).toISOString(), new Date(fromKey(to).getTime() + 864e5 - 1).toISOString()),
    store.listBetween('cash_movements', 'dayKey', from, to),
    store.listBetween('payouts', 'to', from, '9999-12-31')
  ]);
  const weeks = periodDays(from, to) / 7;
  const out = {};
  const row = (b) => (out[b.id] ||= { barber: b, services: 0, clients: new Set(), gross: 0, serviceComm: 0, products: 0, productComm: 0, tips: 0, club: 0, rent: 0, salary: 0, advances: 0, advList: [], paid: 0, sales: [] });
  for (const b of store.settings.barbers) if (b.active !== false) row(b);
  for (const s of sales) {
    if (s.status === 'voided') continue;
    for (const it of s.items || []) {
      const b = store.barber(it.barberId);
      if (!b) continue;
      const r = row(b);
      const amt = round2((it.price || 0) * (it.qty || 0));
      const c = commissionOf(it, b);
      if (it.kind === 'servicio') { r.services += it.qty || 1; r.gross += it.club || it.reward ? round2((it.listPrice || 0) * (it.qty || 1)) : amt; r.serviceComm += c; if (it.club || it.reward) r.club += it.qty || 1; if (s.memberId) r.clients.add(s.memberId); }
      else if (it.kind === 'producto') { r.products += amt; r.productComm += c; }
      else if (it.kind === 'propina') r.tips += amt;
      if (!r.sales.includes(s.number)) r.sales.push(s.number);
    }
  }
  for (const m of moves) {
    if (m.category !== 'Adelanto a barbero' || !m.barberId) continue;
    const b = store.barber(m.barberId); if (!b) continue;
    const r = row(b); r.advances = round2(r.advances + (m.amount || 0)); r.advList.push(m);
  }
  for (const p of payouts) {
    if (p.from > to || p.to < from || p.status === 'anulada') continue;
    const b = store.barber(p.barberId); if (!b) continue;
    row(b).paid = round2(row(b).paid + (p.amount || 0));
  }
  for (const r of Object.values(out)) {
    const b = r.barber;
    r.clients = r.clients.size;
    if (b.mode === 'alquiler') r.rent = round2((Number(b.rent) || 0) * weeks);
    if (b.mode === 'sueldo') r.salary = round2((Number(b.salary) || 0) * weeks);
    for (const k of ['gross', 'serviceComm', 'products', 'productComm', 'tips']) r[k] = round2(r[k]);
    // Lo que la barbería le debe al barbero (negativo: el barbero le debe a la barbería, p. ej. el alquiler)
    r.earned = round2(r.serviceComm + r.productComm + r.tips + r.salary);
    r.net = round2(r.earned - r.rent - r.advances - r.paid);
    r.shop = round2(r.gross + r.products - r.serviceComm - r.productComm + r.rent);
  }
  return Object.values(out).sort((a, b) => b.gross - a.gross);
}
/** Registra el pago de la liquidación al barbero (sale de la caja si es en efectivo) */
export async function payBarber({ barber, from, to, amount, method = 'efectivo', summary = {}, note = '' }) {
  const amt = round2(Number(amount) || 0);
  if (!(amt > 0)) throw new Error('Indica el monto a pagar.');
  const b = store.batch();
  const ref = store.newRef('payouts');
  const date = nowISO();
  const shift = store.openShift;
  const fromCash = method === 'efectivo';
  if (fromCash && !shift) throw new Error('Abre la caja para pagar en efectivo, o elige otra forma de pago.');
  const seq = store.nextSeq(b, 'pay');
  b.set(ref, { number: fmtSeq('L', seq, 4), barberId: barber.id, barberName: barber.name, from, to, amount: amt, method, summary, note, date, dayKey: todayKey(), shiftId: fromCash ? shift.id : null, status: 'pagada', by: by() });
  if (fromCash) {
    const flow = FLOW0(); flow.outUSD = amt;
    b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: 'USD', amount: amt, rate: 1, flow, concept: `Liquidación ${barber.name} (${fmtDate(from)} al ${fmtDate(to)})`, category: 'Pago a barberos', barberId: barber.id, refId: ref.id, by: by() });
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: amt }));
  }
  await store.commit(b);
  return { id: ref.id, number: fmtSeq('L', seq, 4) };
}
export async function listPayouts(max = 40) {
  const s = await store.listBetween('payouts', 'dayKey', '2000-01-01', '9999-12-31');
  return s.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, max);
}

// ======================================================================
// CAJA
// ======================================================================
export async function cashMovement({ direction, currency, amount, concept, category, note = '', barberId = null }) {
  const shift = store.openShift;
  if (!shift) throw new Error('No hay caja abierta.');
  const b = store.batch();
  const flow = FLOW0();
  flow[direction === 'in' ? 'inUSD' : 'outUSD'] = round2(amount);
  const date = nowISO();
  b.set(store.newRef('cash_movements'), {
    shiftId: shift.id, date, dayKey: todayKey(), type: direction === 'in' ? 'income' : 'expense', direction, currency,
    amount: round2(amount), rate: 1, flow, concept, category, note, barberId: barberId || null, by: by()
  });
  b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, direction === 'out' ? { expensesUSD: amount } : { incomeUSD: amount }));
  await store.commit(b);
}
export async function openShift({ openingUSD, openingBs = 0, note = '' }) {
  if (store.openShift) throw new Error('Ya hay una caja abierta.');
  const ref = store.newRef('cash_shifts');
  const b = store.batch();
  const seq = store.nextSeq(b, 'shift');
  b.set(ref, {
    status: 'open', openedAt: nowISO(), openedBy: by(), dayKey: todayKey(), number: fmtSeq('T', seq, 4),
    openingUSD: round2(openingUSD), openingBs: round2(openingBs), rateAtOpen: 1,
    inUSD: 0, inBs: 0, outUSD: 0, outBs: 0, salesCount: 0, salesTotal: 0, note
  });
  await store.commit(b);
  return ref.id;
}
export function shiftExpected(shift) {
  return {
    usd: round2((shift.openingUSD || 0) + (shift.inUSD || 0) - (shift.outUSD || 0)),
    bs: round2((shift.openingBs || 0) + (shift.inBs || 0) - (shift.outBs || 0))
  };
}
export async function closeShift(shift, { countedUSD, countedBs = 0, note = '' }) {
  const exp = shiftExpected(shift);
  const b = store.batch();
  b.update(store.ref('cash_shifts', shift.id), {
    status: 'closed', closedAt: nowISO(), closedBy: by(), rateAtClose: 1,
    expectedUSD: exp.usd, expectedBs: exp.bs, countedUSD: round2(countedUSD), countedBs: round2(countedBs),
    diffUSD: round2(countedUSD - exp.usd), diffBs: round2(countedBs - exp.bs), closeNote: note
  });
  await store.commit(b);
}

// ======================================================================
// INVENTARIO
// ======================================================================
/** mode: 'compra' (entrada con costo) | 'entrada' | 'merma' | 'salida' (uso interno) | 'conteo' (fija el stock) */
export async function moveProduct(p, { mode, qty, unitCost = 0, reason = '', payFromCash = false, payCurrency = 'USD', lot = '', expiresAt = '' }) {
  const current = Number(store.product(p.id)?.stock ?? p.stock) || 0;
  const q = round4(Number(qty) || 0);
  const delta = round4(mode === 'compra' || mode === 'entrada' ? q : mode === 'conteo' ? q - current : -q);
  const date = nowISO();
  const b = store.batch();
  const patch = { stock: store.inc(delta), updatedAt: date };
  if (mode === 'compra' && unitCost > 0) {
    const stockNow = Math.max(0, current);
    const avg = stockNow + q > 0 ? (stockNow * (Number(p.cost) || 0) + q * unitCost) / (stockNow + q) : unitCost;
    patch.cost = round4(avg); patch.lastCost = round4(unitCost); patch.lastPurchaseAt = date;
  }
  if ((mode === 'compra' || mode === 'entrada') && lot) patch.lot = lot;
  if ((mode === 'compra' || mode === 'entrada') && expiresAt) patch.expiresAt = !p.expiresAt || current <= 0 || expiresAt < p.expiresAt ? expiresAt : p.expiresAt;
  b.update(store.ref('products', p.id), patch);
  b.set(store.newRef('inventory_logs'), { productId: p.id, name: p.name, date, dayKey: todayKey(), type: mode, qty: delta, cost: mode === 'compra' ? unitCost : Number(p.cost) || 0, reason, lot: lot || '', expiresAt: expiresAt || '', by: by() });
  if (mode === 'compra' && payFromCash && unitCost > 0) {
    const shift = store.openShift;
    if (!shift) throw new Error('Abre la caja para pagar la compra con dinero de la caja.');
    const amount = round2(unitCost * q);
    const flow = FLOW0(); flow.outUSD = amount;
    b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: payCurrency, amount, rate: 1, flow, concept: `Compra: ${q} × ${p.name}`, category: 'Compra de mercancía', by: by() });
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: amount }));
  }
  await store.commit(b);
}

export { addDays, dayKey, OPEN_STATUS };
