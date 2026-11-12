// SanoCortes — Modo demo (sesión anónima de 30 minutos) con una barbería de ejemplo llena de vida
import { auth, db, doc, collection, writeBatch, getDoc, getDocs, query, where, Timestamp, signInAnonymously, signOut } from './firebase.js';
import { store, DEFAULT_SETTINGS } from './store.js';
import { fmtSeq, genCode, cardData, openShift, chargeTicket, cashMovement, addWalkin, sellPlan } from './ops.js';
import { round2, nowISO, todayKey, dayKey, addDays, sha256, scaleUSD, PAY_METHODS } from './utils.js';
import { minToTime, avgInterval } from './barber.js';

/** PIN de administrador de todas las demos (se muestra en pantalla) */
export const DEMO_PIN = '1234';
export const DEMO_MINUTES = 30;
const DATA_COLLECTIONS = ['clients', 'appointments', 'visits', 'memberships', 'photos', 'products', 'sales', 'payouts', 'cash_shifts', 'cash_movements', 'inventory_logs', 'config'];
const BIZ = 'Barbería El Bigote (demo)';

export async function startDemo() { await signInAnonymously(auth); }

export function demoRemainingMs(tenant) {
  const exp = tenant?.expiresAt;
  if (!exp) return 0;
  const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : new Date(exp).getTime();
  return ms - Date.now();
}

const BARBERS = [
  { id: 'b1', name: 'Carlos “El Maestro” Rivas', phone: '0414-5550101', specialty: 'Fades y diseños', color: '#d49a3a', mode: 'comision', commission: 50, productCommission: 10, rent: 0, salary: 0 },
  { id: 'b2', name: 'Luis Herrera', phone: '0424-5550202', specialty: 'Barba y afeitado clásico', color: '#dc2626', mode: 'alquiler', commission: 0, productCommission: 15, rent: 40, salary: 0 },
  { id: 'b3', name: 'Andrés Paredes', phone: '0412-5550303', specialty: 'Cortes a tijera y color', color: '#0ea5e9', mode: 'sueldo', commission: 25, productCommission: 10, rent: 0, salary: 60 },
  { id: 'b4', name: 'Miguel Ángel Soto', phone: '0416-5550404', specialty: 'Niños y cortes rápidos', color: '#16a34a', mode: 'comision', commission: 45, productCommission: 10, rent: 0, salary: 0 }
].map((b) => ({ ...b, days: [], from: '', to: '', breakFrom: '', breakTo: '', online: true, walkins: true, active: true }));

/** Horario de la demo: siempre abierto a la hora en que se prueba */
function demoSchedule() {
  const h = new Date().getHours();
  const open = Math.max(0, Math.min(8, h - 4));
  const close = Math.min(23, Math.max(21, h + 5));
  const o = `${String(open).padStart(2, '0')}:00`; const c = close >= 23 ? '23:59' : `${String(close).padStart(2, '0')}:00`;
  return { days: [0, 1, 2, 3, 4, 5, 6], open: o, close: c, satOpen: o, satClose: c, sunOpen: o, sunClose: c };
}

export async function createDemoTenant(uid) {
  const expiresAt = Timestamp.fromMillis(Date.now() + DEMO_MINUTES * 60 * 1000);
  const b1 = writeBatch(db);
  b1.set(doc(db, 'tenants', uid), { name: BIZ, code: 'demo', ownerUid: uid, ownerEmail: '', active: true, demo: true, createdAt: nowISO(), expiresAt });
  await b1.commit();
  const ref = (name, id) => doc(db, 'tenants', uid, name, id);
  const b = writeBatch(db);
  b.set(ref('config', 'settings'), {
    ...DEFAULT_SETTINGS, businessName: BIZ, rif: 'J-50000000-0', phone: '0212-5550000', whatsapp: '0414-5550000', email: 'demo@sanocortes.app',
    address: 'Av. Principal de Las Mercedes, local 4', instagram: '@barberiaelbigote', barbers: BARBERS, schedule: demoSchedule(),
    booking: { ...DEFAULT_SETTINGS.booking, enabled: true, leadMinutes: 30, note: 'Café de cortesía · Estacionamiento gratis' },
    receiptFooter: '¡Gracias por tu visita! Te esperamos en tu próximo corte. 💈'
  });
  b.set(ref('config', 'security'), { pinHash: await sha256(`${uid}:${DEMO_PIN}`), updatedAt: nowISO() });
  await b.commit();
}

async function waitFor(cond, ms = 6000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 120));
}
const at = (daysAgo, h, m = 0) => { const d = addDays(new Date(), -daysAgo); d.setHours(h, m, 0, 0); return d; };
const birth = (age, mOff, d) => { const t = new Date(); return `${t.getFullYear() - age}-${String(((t.getMonth() + mOff) % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
const birthdayIn = (age, days) => { const t = addDays(new Date(), days); return `${new Date().getFullYear() - age}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

const ST = {
  midfade: { fade: 'Mid fade', sides: '1', top: 'Tijera', topStyle: 'Texturizado', beard: 'Barba degradada', neck: 'Degradado', products: 'Pomada mate', notes: 'Raya al lado izquierdo con navaja' },
  skin: { fade: 'Skin fade (a cero)', sides: '0', top: '#3', topStyle: 'Crop francés', beard: 'Sin barba', neck: 'Degradado', products: 'Cera en polvo', notes: '' },
  clasico: { fade: 'Taper', sides: '2', top: 'Tijera', topStyle: 'Peinado de lado', beard: 'Afeitado al ras', neck: 'Cuadrado', products: 'Gel fijación media', notes: 'No rebajar mucho la coronilla' },
  barba: { fade: 'Low fade', sides: '1.5', top: 'Tijera', topStyle: 'Quiff', beard: 'Barba completa', neck: 'Redondeado', products: 'Aceite de barba', notes: 'Perfilar mejillas con navaja' },
  nino: { fade: 'Low fade', sides: '2', top: 'Tijera', topStyle: 'Peinado de lado', beard: '', neck: 'Natural', products: '', notes: 'Se mueve mucho: usar silla elevada' },
  rizos: { fade: 'Burst fade', sides: '1', top: 'Tijera', topStyle: 'Rizos definidos', beard: 'Candado', neck: 'Natural', products: 'Crema para rizos', notes: '' },
  buzz: { fade: 'High fade', sides: '0.5', top: '#2', topStyle: 'Buzz cut', beard: 'Barba corta (3 días)', neck: 'Degradado', products: '', notes: '' }
};
/** k, nombre, teléfono, barbero, ciclo (días), último corte (días atrás), visitas, servicios, estilo, extras */
const CLIENTS = [
  ['jose', 'José Gregorio Pérez', '0414-1112233', 'b1', 14, 3, 14, ['fade', 'barba'], 'midfade', { drink: 'Café', hairType: ['Grueso'], club: 'clubpro' }],
  ['kevin', 'Kevin Rodríguez', '0424-2223344', 'b1', 15, 17, 9, ['fade'], 'skin', { drink: 'Agua', noShows: 2 }],
  ['ramon', 'Ramón Castillo', '0412-3334455', 'b3', 28, 31, 6, ['tijera'], 'clasico', { drink: 'Café', allergies: 'Alergia al alcohol de la loción' }],
  ['daniel', 'Daniel Moreno', '0416-4445566', 'b2', 10, 2, 12, ['combo'], 'barba', { drink: 'Cerveza', rewards: 1 }],
  ['mateo', 'Mateo Silva (niño)', '0414-5556677', 'b4', 21, 24, 5, ['nino'], 'nino', { guardianName: 'Carla Silva' }],
  ['andres', 'Andrés Bello Ruiz', '0424-6667788', 'b1', 18, 95, 4, ['fade'], 'buzz', {}],
  ['luisf', 'Luis Fernando Gil', '0412-7778899', 'b2', 12, 8, 10, ['afeitado', 'corte'], 'clasico', { drink: 'Té', debt: 6 }],
  ['victor', 'Víctor Ochoa', '0416-8889900', 'b1', 20, 22, 7, ['fade', 'cejas'], 'midfade', { birthday: 0 }],
  ['samuel', 'Samuel Contreras', '0414-9990011', 'b3', 30, 12, 4, ['tinte', 'corte'], 'clasico', {}],
  ['jesus', 'Jesús Alberto Mora', '0424-1013141', 'b4', 14, 15, 8, ['corte'], 'buzz', { club: 'club4' }],
  ['gabriel', 'Gabriel Torres', '0412-1415161', 'b1', 16, 1, 9, ['vip'], 'barba', { drink: 'Cerveza', stampsBoost: 9 }],
  ['angel', 'Ángel David Rojas', '0416-1617181', 'b2', 25, 120, 3, ['combo'], 'barba', {}],
  ['oscar', 'Óscar Medina', '0414-1819202', 'b3', 35, 40, 5, ['tijera', 'lavado'], 'clasico', { drink: 'Café' }],
  ['santiago', 'Santiago Blanco', '0424-2021222', 'b4', 21, 6, 6, ['nino'], 'nino', { guardianName: 'Pedro Blanco', birthday: 3 }],
  ['eduardo', 'Eduardo Linares', '0412-2223242', 'b1', 13, 13, 11, ['fade', 'diseno'], 'rizos', { drink: 'Refresco' }],
  ['frank', 'Frank Mendoza', '0416-2425262', 'b2', 9, 4, 13, ['barba'], 'barba', { club: 'barba8' }],
  ['cristian', 'Cristian Paz', '0414-2627282', 'b1', 18, 19, 6, ['fade'], 'skin', {}],
  ['manuel', 'Manuel Ávila', '0424-2829303', 'b3', 24, 70, 4, ['corte'], 'clasico', {}],
  ['diego', 'Diego Fernández', '0412-3031323', 'b4', 15, 0, 7, ['corte', 'cejas'], 'buzz', {}],
  ['ricardo', 'Ricardo Salas', '0416-3233343', 'b2', 14, 16, 8, ['combo', 'mascarilla'], 'barba', { drink: 'Café', debt: 4 }],
  ['julio', 'Julio César Vargas', '0414-3435363', 'b1', 21, 9, 5, ['fade'], 'midfade', {}],
  ['adrian', 'Adrián Quintero', '0424-3637383', 'b3', 30, 33, 3, ['keratina'], 'rizos', {}],
  ['pablo', 'Pablo Urdaneta', '0412-3839404', 'b4', 20, 140, 2, ['corte'], 'buzz', {}],
  ['marcos', 'Marcos Villalobos', '0416-4041424', 'b1', 15, 5, 10, ['fade', 'barba'], 'midfade', { drink: 'Agua' }]
];
const PRODUCTS = [
  ['Pomada mate fijación fuerte', 'Ceras y pomadas', 12, 6, 14, 4, '#d49a3a'], ['Cera en polvo texturizante', 'Ceras y pomadas', 10, 5, 3, 4, '#b45309'],
  ['Aceite para barba 30 ml', 'Cuidado de barba', 9, 4, 10, 3, '#0ea5e9'], ['Bálsamo para barba', 'Cuidado de barba', 11, 5, 6, 3, '#0284c7'],
  ['Shampoo anticaspa', 'Shampoo y acondicionador', 8, 4, 8, 3, '#16a34a'], ['Gel fijación extrema', 'Fijadores y geles', 5, 2, 20, 5, '#64748b'],
  ['Aftershave clásico', 'Aftershave y lociones', 7, 3, 9, 3, '#7c3aed'], ['Cerveza artesanal', 'Bebidas', 3, 1.5, 24, 6, '#ca8a04'],
  ['Peine de madera', 'Accesorios', 4, 1.5, 12, 3, '#92400e'], ['Cuchillas de afeitar (caja x100)', 'Insumos internos', 0, 6, 2, 2, '#334155']
];

/** Barbería de ejemplo: clientes en todos los estados, historial de cortes, agenda de hoy y mañana, fila, reservas, club, caja y pagos. */
export async function seedDemoActivity() {
  const money = (v) => scaleUSD(v);
  const t = todayKey();
  const methods = ['efectivo', 'efectivo', 'transferencia', 'debito', ...Object.keys(PAY_METHODS).slice(4, 6)];
  const svc = (id) => store.service(id);

  // 1) Caja abierta
  if (!store.openShift) { await openShift({ openingUSD: money(30), note: 'Apertura demo' }); await waitFor(() => store.openShift); }

  // 2) Productos
  let b = store.batch();
  PRODUCTS.forEach(([name, category, price, cost, stock, minStock, color], i) => {
    const internal = category === 'Insumos internos';
    b.set(store.ref('products', 'demo_p' + i), { name, category, price: money(price), cost: money(cost), stock, minStock, color, unit: 'und', trackStock: true, sellable: !internal, active: true, sku: String(7590000000200 + i), sold: 0, createdAt: nowISO(), updatedAt: nowISO(), by: 'demo' });
  });
  await store.commit(b);

  // 3) Clientes con su historial de cortes (ventas y visitas con fechas pasadas)
  const L = store.loyalty; const every = Number(L.every) || 10;
  const hist = []; const clients = {};
  CLIENTS.forEach(([k, name, phone, barberId, cycle, last, visits, svcIds, styleKey, x], idx) => {
    const id = 'demo_' + k;
    const dates = [];
    for (let j = 0; j < visits; j++) { const ago = last + j * cycle + ((idx + j) % 3) - 1; if (ago > 200) break; dates.push(Math.max(last === 0 ? 0 : 1, ago)); }
    dates[0] = last;
    const keys = dates.map((d) => dayKey(addDays(new Date(), -d))).sort();
    const services = svcIds.map(svc).filter(Boolean);
    const price = round2(services.reduce((a, s) => a + (Number(s.price) || 0), 0));
    let spent = 0;
    dates.forEach((d, j) => {
      if (d === 0) return; // el de hoy se cobra en vivo más abajo
      const hour = 9 + ((idx * 2 + j) % 10);
      const date = at(d, hour, (idx * 7) % 4 * 15);
      const tip = (idx + j) % 4 === 0 ? money(1) : 0;
      const prod = (idx + j) % 6 === 0 ? 0 : null;
      hist.push({ k, id, name, phone, barberId, date, services, price, tip, prod, styleKey, method: methods[(idx + j) % methods.length] });
      spent += price + tip;
    });
    const style = ST[styleKey];
    const totalVisits = dates.filter((d) => d > 0).length;
    clients[k] = {
      id, name, phone, email: '', birthDate: x.birthday != null ? birthdayIn(18 + (idx * 3) % 30, x.birthday) : birth(18 + (idx * 3) % 30, idx % 11 + 1, (idx * 5) % 27 + 1),
      barberId, hairType: x.hairType || [], skin: [], drink: x.drink || '', allergies: x.allergies || '', guardianName: x.guardianName || '', notes: '', tags: [],
      number: '', cardCode: genCode(8), active: true, visits: totalVisits, totalSpent: round2(spent), balance: x.debt ? money(x.debt) : 0, noShows: x.noShows || 0,
      stamps: x.stampsBoost != null ? x.stampsBoost : totalVisits % every, rewards: x.rewards || 0,
      visitDates: keys.filter((d) => d < t).slice(-10), avgDays: avgInterval(keys.filter((d) => d < t)) || null,
      lastVisitAt: last > 0 ? at(last, 11).toISOString() : (dates[1] ? at(dates[1], 11).toISOString() : null), lastStyle: style, lastBarberId: barberId, lastServiceIds: svcIds,
      membership: null, createdAt: at(Math.max(...dates, 1) + 2, 10).toISOString(), updatedAt: nowISO(), by: 'demo', _spec: { last, x, svcIds }
    };
  });
  // Números de cliente por antigüedad
  b = store.batch();
  Object.values(clients).sort((a, z) => a.createdAt.localeCompare(z.createdAt)).forEach((c) => { const seq = store.nextSeq(b, 'cli'); c.number = fmtSeq('C', seq, 4); c.seq = seq; });
  await store.commit(b);

  // Ventas y visitas históricas en orden cronológico
  hist.sort((a, z) => a.date - z.date);
  const docs = [];
  const nb = store.batch(); // solo para los correlativos
  for (const h of hist) {
    const seq = store.nextSeq(nb, 'inv');
    const number = fmtSeq(store.settings.invoicePrefix || 'R', seq, 6);
    const items = h.services.map((s) => ({ productId: null, serviceId: s.id, planId: null, barberId: h.barberId, barber: store.barber(h.barberId)?.name || '', name: s.name, qty: 1, price: s.price, listPrice: s.price, cost: 0, kind: 'servicio', club: false, reward: false, total: s.price }));
    if (h.tip) items.push({ productId: null, serviceId: null, planId: null, barberId: h.barberId, barber: store.barber(h.barberId)?.name || '', name: `Propina · ${store.barber(h.barberId)?.name || ''}`, qty: 1, price: h.tip, listPrice: h.tip, cost: 0, kind: 'propina', club: false, reward: false, total: h.tip });
    const total = round2(items.reduce((a, i) => a + i.total, 0));
    const date = h.date.toISOString();
    const saleId = 'demo_s' + seq;
    const c = clients[h.k];
    docs.push(['sales', saleId, {
      number, seq, kind: 'servicio', date, dayKey: dayKey(h.date), items, subtotal: total, discount: 0, total, cost: 0, rate: 1,
      payments: [{ method: h.method, currency: 'USD', amount: total, usd: total }], paidUSD: total, changeUSD: 0, changeCurrency: 'USD', method: h.method, received: total, shiftId: null, cashFlow: null,
      memberId: h.id, memberName: h.name, memberPhone: h.phone, memberIdDoc: '', memberNumber: c.number, barberIds: [h.barberId], barberId: h.barberId, status: 'completed', by: 'demo', stamp: true, credit: 0
    }]);
    docs.push(['visits', 'demo_v' + seq, { clientId: h.id, clientName: h.name, date, dayKey: dayKey(h.date), barberId: h.barberId, barberName: store.barber(h.barberId)?.name || '', services: h.services.map((s) => s.name), total: round2(h.price), saleId, saleNumber: number, apptId: null, style: ST[h.styleKey], by: 'demo' }]);
  }
  await store.commit(nb);
  for (let i = 0; i < docs.length; i += 80) {
    const bb = store.batch();
    docs.slice(i, i + 80).forEach(([col, id, data]) => bb.set(store.ref(col, id), data));
    await store.commit(bb);
  }
  b = store.batch();
  for (const c of Object.values(clients)) {
    const { _spec, id, ...data } = c;
    b.set(store.ref('clients', id), data);
    b.set(store.cardRef(c.cardCode), cardData({ id, ...data }));
  }
  await store.commit(b);
  await waitFor(() => store.clients.length >= CLIENTS.length);

  // 4) Citas: ayer, hoy (en silla, próximas, una que no vino) y mañana
  const nm = (() => { const d = new Date(); return Math.floor((d.getHours() * 60 + d.getMinutes()) / 15) * 15; })();
  const tomorrow = dayKey(addDays(new Date(), 1)); const yesterday = dayKey(addDays(new Date(), -1));
  const mk = (k, barberId, date, start, svcIds, status, extra = {}) => {
    const c = store.client('demo_' + k) || clients[k];
    const services = svcIds.map(svc).filter(Boolean).map((s) => ({ id: s.id, name: s.name, price: s.price, minutes: s.minutes }));
    const minutes = services.reduce((a, s) => a + s.minutes, 0) || 30;
    const br = store.barber(barberId);
    return {
      date, time: minToTime(start), start, end: start + minutes, minutes, barberId, barberName: br.name, barberColor: br.color, services, serviceIds: services.map((s) => s.id), serviceNames: services.map((s) => s.name).join(' + '),
      estimate: round2(services.reduce((a, s) => a + s.price, 0)), clientId: c.id, clientName: c.name, clientPhone: c.phone, note: '', status, kind: 'cita', source: 'local', createdAt: at(2, 18).toISOString(), updatedAt: nowISO(), by: 'demo', ...extra
    };
  };
  const ap = [];
  const okT = (m) => m >= 0 && m < 24 * 60 - 30;
  ap.push(['demo_a1', mk('cristian', 'b1', yesterday, 600, ['fade'], 'terminada')]);
  ap.push(['demo_a2', mk('manuel', 'b3', yesterday, 660, ['corte'], 'no_vino')]);
  // Hoy: en la silla
  ap.push(['demo_a3', mk('jose', 'b1', t, nm - 15, ['fade', 'barba'], 'en_silla', { startedMin: nm - 15, startedAt: new Date(Date.now() - 15 * 60000).toISOString(), arrivedAt: new Date(Date.now() - 20 * 60000).toISOString() })]);
  ap.push(['demo_a4', mk('ricardo', 'b2', t, nm - 5, ['combo'], 'en_silla', { startedMin: nm - 5, startedAt: new Date(Date.now() - 5 * 60000).toISOString(), arrivedAt: new Date(Date.now() - 12 * 60000).toISOString(), source: 'online' })]);
  // Hoy: no vino (más temprano) y próximas
  if (okT(nm - 75)) ap.push(['demo_a5', mk('kevin', 'b3', t, nm - 75, ['fade'], 'no_vino')]);
  if (okT(nm + 45)) ap.push(['demo_a6', mk('eduardo', 'b1', t, nm + 45, ['fade', 'diseno'], 'confirmada', { remindedAt: nowISO() })]);
  if (okT(nm + 30)) ap.push(['demo_a7', mk('frank', 'b2', t, nm + 60, ['barba'], 'reservada')]);
  if (okT(nm + 20)) ap.push(['demo_a8', mk('samuel', 'b3', t, nm + 30, ['tinte', 'corte'], 'confirmada', { source: 'online' })]);
  if (okT(nm + 90)) ap.push(['demo_a9', mk('julio', 'b4', t, nm + 90, ['corte'], 'reservada')]);
  if (okT(nm + 120)) ap.push(['demo_a10', mk('kevin', 'b1', t, nm + 120, ['fade'], 'reservada', { note: 'Ya faltó 2 veces: confirmar' })]);
  // Mañana
  ap.push(['demo_a11', mk('ramon', 'b3', tomorrow, 600, ['tijera'], 'confirmada')]);
  ap.push(['demo_a12', mk('daniel', 'b2', tomorrow, 660, ['combo'], 'reservada', { source: 'online' })]);
  ap.push(['demo_a13', mk('victor', 'b1', tomorrow, 900, ['fade', 'cejas'], 'reservada')]);
  ap.push(['demo_a14', mk('santiago', 'b4', tomorrow, 1050, ['nino'], 'confirmada')]);
  // Atendidos hoy más temprano (se cobran en vivo para pasar por la caja)
  const early = [];
  if (okT(nm - 100)) early.push(['demo_a15', mk('diego', 'b4', t, nm - 100, ['corte', 'cejas'], 'en_silla', { startedMin: nm - 100 })]);
  if (okT(nm - 80)) early.push(['demo_a16', mk('marcos', 'b1', t, nm - 80, ['fade', 'barba'], 'en_silla', { startedMin: nm - 80 })]);
  if (okT(nm - 60)) early.push(['demo_a17', mk('gabriel', 'b2', t, nm - 60, ['vip'], 'en_silla', { startedMin: nm - 60 })]);
  b = store.batch();
  [...ap, ...early].forEach(([id, data]) => b.set(store.ref('appointments', id), data));
  await store.commit(b);
  await waitFor(() => store.appointments.length >= ap.length + early.length - 2);

  // 5) Club (prepagos): uno activo, uno por vencer, uno de barba
  try {
    for (const [k, planId] of [['jose', 'clubpro'], ['jesus', 'club4'], ['frank', 'barba8']]) {
      const plan = store.plan(planId); const c = store.client('demo_' + k);
      if (plan && c) await sellPlan({ client: c, plan, payments: [{ method: 'transferencia', amount: Number(plan.price) || 0 }] });
    }
    const j = store.client('demo_jesus');
    if (j?.membership) {
      const ms = { ...j.membership, start: dayKey(addDays(new Date(), -27)), end: dayKey(addDays(new Date(), 2)), left: 1 };
      const bb = store.batch();
      bb.set(store.ref('clients', j.id), { membership: ms }, { merge: true });
      bb.set(store.ref('memberships', ms.id), { start: ms.start, end: ms.end, left: 1 }, { merge: true });
      bb.set(store.cardRef(j.cardCode), cardData({ ...j, membership: ms }), { merge: true });
      await store.commit(bb);
    }
  } catch (e) { console.warn('[demo] club', e); }

  // 6) Cobros de hoy en vivo (cierran las citas, suman sellos, propinas y productos)
  try {
    const pom = store.product('demo_p0'); const oil = store.product('demo_p2'); const beer = store.product('demo_p7');
    for (const [id, a] of early) {
      const c = store.client(a.clientId);
      const lines = a.services.map((s) => ({ kind: 'servicio', serviceId: s.id, name: s.name, price: s.price, listPrice: s.price, qty: 1, barberId: a.barberId }));
      if (id === 'demo_a16' && pom) lines.push({ kind: 'producto', productId: pom.id, name: pom.name, price: pom.price, cost: pom.cost, qty: 1, barberId: a.barberId });
      if (id === 'demo_a17' && beer) lines.push({ kind: 'producto', productId: beer.id, name: beer.name, price: beer.price, cost: beer.cost, qty: 2, barberId: a.barberId });
      const tips = id === 'demo_a16' ? [{ barberId: a.barberId, amount: money(2) }] : [];
      const total = round2(lines.reduce((s, l) => s + l.price * l.qty, 0) + tips.reduce((s, x) => s + x.amount, 0));
      await chargeTicket({ lines, client: c, appt: { id, ...a }, tips, payments: [{ method: id === 'demo_a15' ? 'efectivo' : 'transferencia', amount: total }], style: c?.lastStyle || null });
    }
    if (oil) await chargeTicket({ lines: [{ kind: 'producto', productId: oil.id, name: oil.name, price: oil.price, cost: oil.cost, qty: 1, barberId: 'b2' }], payments: [{ method: 'efectivo', amount: oil.price }] });
    await cashMovement({ direction: 'out', currency: 'USD', amount: money(6), concept: 'Talco, toallas y capas', category: 'Insumos (cuchillas, capas, toallas, talco)' });
    await cashMovement({ direction: 'out', currency: 'USD', amount: money(10), concept: 'Adelanto a Miguel Ángel Soto', category: 'Adelanto a barbero', barberId: 'b4' });
  } catch (e) { console.warn('[demo] cobros de hoy', e); }

  // 7) Fila de espera: dos clientes que llegaron sin cita
  try {
    await addWalkin({ client: store.client('demo_cristian'), serviceIds: ['fade'], barberId: 'b1', via: 'recepcion' });
    await addWalkin({ client: { name: 'Hernán Guzmán', phone: '0414-7654321' }, serviceIds: ['corte', 'barba'], barberId: 'any', via: 'kiosco' });
  } catch (e) { console.warn('[demo] fila', e); }

  // 8) Reserva en línea pendiente de aceptar
  try {
    const bb = store.batch();
    bb.set(doc(collection(db, 'requests')), { tenantId: store.tenantId, slug: store.settings.booking?.slug || '', name: 'Rafael Montilla', phone: '0412-9876543', note: 'Primera vez, me recomendó José', serviceIds: ['fade', 'barba'], serviceNames: 'Degradado (fade) + Arreglo de barba', minutes: 60, estimate: round2((svc('fade')?.price || 0) + (svc('barba')?.price || 0)), barberId: 'any', date: tomorrow, time: '16:00', status: 'nueva', createdAt: new Date(Date.now() - 25 * 60000).toISOString() });
    await store.commit(bb);
  } catch (e) { console.warn('[demo] solicitud', e); }

  // 9) Pago de la semana pasada a un barbero
  try {
    const bb = store.batch();
    const seq = store.nextSeq(bb, 'pay');
    const from = dayKey(addDays(new Date(), -14)); const to = dayKey(addDays(new Date(), -8));
    bb.set(store.ref('payouts', 'demo_l1'), { number: fmtSeq('L', seq, 4), barberId: 'b1', barberName: store.barber('b1').name, from, to, amount: money(85), method: 'transferencia', summary: {}, note: 'Semana anterior', date: at(7, 19).toISOString(), dayKey: dayKey(addDays(new Date(), -7)), shiftId: null, status: 'pagada', by: 'demo' });
    await store.commit(bb);
  } catch (e) { console.warn('[demo] pagos', e); }
}

/** Borra todos los datos de una sede (sus tarjetas públicas, su página de reservas y sus solicitudes). */
export async function purgeTenant(tenantId, onlyDemo = true, slug = '') {
  try {
    const snap = await getDocs(collection(db, 'tenants', tenantId, 'clients'));
    const codes = snap.docs.map((d) => d.data().cardCode).filter(Boolean);
    for (let i = 0; i < codes.length; i += 80) {
      const b = writeBatch(db);
      codes.slice(i, i + 80).forEach((c) => b.delete(doc(db, 'cards', c)));
      await b.commit().catch((e) => console.warn('[purge] tarjetas', e?.code || e));
    }
  } catch (e) { console.warn('[purge] tarjetas', e?.code || e); }
  try {
    let s = slug;
    if (!s) { const st = await getDoc(doc(db, 'tenants', tenantId, 'config', 'settings')); s = st.exists() ? st.data().booking?.slug || '' : ''; }
    if (s) { const bk = await getDoc(doc(db, 'booking', s)); if (bk.exists() && bk.data().tenantId === tenantId) { const b = writeBatch(db); b.delete(bk.ref); await b.commit(); } }
  } catch (e) { console.warn('[purge] reservas', e?.code || e); }
  try {
    const rq = await getDocs(query(collection(db, 'requests'), where('tenantId', '==', tenantId)));
    for (let i = 0; i < rq.docs.length; i += 80) { const b = writeBatch(db); rq.docs.slice(i, i + 80).forEach((d) => b.delete(d.ref)); await b.commit(); }
  } catch (e) { console.warn('[purge] solicitudes', e?.code || e); }
  for (const c of DATA_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, c));
      for (let i = 0; i < snap.docs.length; i += 80) {
        const b = writeBatch(db);
        snap.docs.slice(i, i + 80).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    } catch (e) { console.warn('[purge]', c, e?.code || e); }
  }
  if (onlyDemo) {
    try {
      const t = await getDoc(doc(db, 'tenants', tenantId));
      if (t.exists() && t.data().demo === true) { const b = writeBatch(db); b.delete(t.ref); await b.commit(); }
    } catch (e) { console.warn('[purge] sede', e?.code || e); }
  }
}

/** Borra la demo actual y la cuenta anónima. */
export async function cleanupDemo(tenantId, slug = '') {
  await purgeTenant(tenantId, true, slug);
  const u = auth.currentUser;
  if (u && u.isAnonymous) {
    try { await u.delete(); } catch (_) { await signOut(auth).catch(() => {}); }
  }
}
