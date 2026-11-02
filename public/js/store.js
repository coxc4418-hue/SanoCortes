// SanoCortes — Capa de datos multisede (Firestore en tiempo real + caché offline)
import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, writeBatch, increment
} from './firebase.js';
import { addDays, startOfDay, sha256, toast, todayKey, dayKey, applyLocale, scaleUSD, fromKey } from './utils.js';
import { DEFAULT_SERVICES, DEFAULT_PLANS, LOYALTY_DEFAULT, barberHours, toMin, nowMin } from './barber.js';

export const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const SEX = { M: 'Masculino', F: 'Femenino' };
export const PRODUCT_CATEGORIES = ['Ceras y pomadas', 'Cuidado de barba', 'Shampoo y acondicionador', 'Fijadores y geles', 'Aftershave y lociones', 'Bebidas', 'Accesorios', 'Insumos internos'];
export const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);

// ---------- Citas y turnos ----------
export const APPT_STATUS = {
  reservada: { label: 'Reservada', tone: 'info', icon: 'calendar' },
  confirmada: { label: 'Confirmada', tone: 'brand', icon: 'checkCircle' },
  espera: { label: 'En espera', tone: 'warning', icon: 'clock' },
  en_silla: { label: 'En la silla', tone: 'violet', icon: 'scissors' },
  terminada: { label: 'Atendido', tone: 'success', icon: 'check' },
  no_vino: { label: 'No vino', tone: 'danger', icon: 'x' },
  cancelada: { label: 'Cancelada', tone: 'neutral', icon: 'x' }
};
/** Estados que ocupan la agenda del barbero */
export const BUSY_STATUS = ['reservada', 'confirmada', 'espera', 'en_silla', 'terminada'];
export const OPEN_STATUS = ['reservada', 'confirmada', 'espera', 'en_silla'];
export const apptBadge = (s) => {
  const st = APPT_STATUS[s] || { label: s, tone: 'neutral' };
  return `<span class="badge badge-${st.tone}"><i class="dotc"></i>${st.label}</span>`;
};

// ---------- Estado del cliente ----------
export const CLIENT_STATUS = {
  nuevo: { label: 'Nuevo', tone: 'info' },
  al_dia: { label: 'Al día', tone: 'success' },
  le_toca: { label: 'Le toca corte', tone: 'warning' },
  atrasado: { label: 'Atrasado', tone: 'danger' },
  perdido: { label: 'Perdido', tone: 'neutral' },
  baja: { label: 'De baja', tone: 'neutral' }
};
export const clientBadge = (s) => {
  const st = CLIENT_STATUS[s] || { label: s, tone: 'neutral' };
  return `<span class="badge badge-${st.tone}"><i class="dotc"></i>${st.label}</span>`;
};

const DEFAULT_SETTINGS = {
  businessName: '',
  rif: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  instagram: '',
  receiptFooter: '¡Gracias por tu visita! Te esperamos en tu próximo corte. 💈',
  receiptFormat: '80mm',
  docTitle: 'RECIBO',
  country: '',
  currency: '',
  iva: 0,
  services: DEFAULT_SERVICES,
  plans: DEFAULT_PLANS,
  categories: PRODUCT_CATEGORIES,
  barbers: [],
  schedule: { days: [1, 2, 3, 4, 5, 6], open: '09:00', close: '20:00', satOpen: '08:00', satClose: '20:00', sunOpen: '', sunClose: '' },
  agenda: { step: 15, noShowMinutes: 15, remindHours: 24, buffer: 0 },
  booking: { enabled: true, slug: '', leadMinutes: 60, daysAhead: 14, autoAccept: false, note: '' },
  loyalty: LOYALTY_DEFAULT,
  cycleDays: 21,
  tips: true,
  rules: 'Llega 5 minutos antes de tu cita. Si no puedes venir, avísanos para darle el espacio a otro cliente. Después de 15 minutos de retraso la cita puede pasar al siguiente turno.'
};

class Store {
  constructor() {
    this.tenantId = null;
    this.tenant = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.security = {};
    this.counters = {};
    this.announcement = null;
    this.clients = [];
    this.appointments = [];
    this.requests = [];
    this.products = [];
    this.openShift = null;
    this.recentSales = [];
    this.ready = false;
    this._unsubs = [];
    this._listeners = {};
    this._loaded = new Set();
  }

  // ---------- Eventos ----------
  on(evt, fn) { (this._listeners[evt] ||= new Set()).add(fn); return () => this._listeners[evt].delete(fn); }
  emit(evt, data) {
    (this._listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
    (this._listeners['*'] || []).forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } });
  }

  // ---------- Referencias ----------
  col(name) { return collection(db, 'tenants', this.tenantId, name); }
  ref(name, id) { return doc(db, 'tenants', this.tenantId, name, String(id)); }
  newRef(name) { return doc(this.col(name)); }
  tenantRef(id = this.tenantId) { return doc(db, 'tenants', id); }
  cardRef(code) { return doc(db, 'cards', String(code)); }
  bookingRef(slug) { return doc(db, 'booking', String(slug)); }
  requestRef(id) { return doc(db, 'requests', String(id)); }
  batch() { return writeBatch(db); }
  get isDemo() { return this.tenant?.demo === true; }
  inc(n) { return increment(n); }

  /**
   * Confirma un lote. La caché local aplica el cambio al instante (también sin internet);
   * se espera la confirmación del servidor como máximo unos segundos para no bloquear el mostrador.
   */
  async commit(batch) {
    const p = batch.commit();
    p.catch((err) => {
      console.error('[store] commit', err);
      toast(err?.code === 'permission-denied' ? 'Sin permiso para guardar. Verifica que la sede esté activa.' : 'No se pudo sincronizar un cambio: ' + (err?.message || err), 'danger', 5000);
    });
    if (!navigator.onLine) return;
    await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 3500))]);
  }

  async save(name, id, data, merge = true) {
    const b = this.batch();
    b.set(this.ref(name, id), data, { merge });
    await this.commit(b);
  }
  async remove(name, id) {
    const b = this.batch();
    b.delete(this.ref(name, id));
    await this.commit(b);
  }

  // ---------- Ciclo de vida ----------
  async start(tenantId) {
    this.stop();
    this.tenantId = tenantId;
    this._loaded = new Set();
    const need = ['tenant', 'settings', 'clients', 'appointments', 'products', 'shift', 'sales'];
    let resolveReady;
    const readyP = new Promise((r) => { resolveReady = r; });
    const mark = (k) => { this._loaded.add(k); if (need.every((x) => this._loaded.has(x))) resolveReady(); };
    const fail = (k) => (err) => { console.error('[store]', k, err); mark(k); if (err?.code === 'permission-denied') this.emit('denied', err); };
    const listen = (q, k, fn) => this._unsubs.push(onSnapshot(q, (s) => { fn(s); mark(k); this.emit(k); this.emit('change', k); }, fail(k)));
    const rows = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'es', { numeric: true });

    listen(this.tenantRef(), 'tenant', (s) => { this.tenant = s.exists() ? { id: s.id, ...s.data() } : null; });
    listen(this.ref('config', 'settings'), 'settings', (s) => {
      this.settings = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
      applyLocale(this.settings.country || 'VE', this.settings.currency);
      for (const k of ['categories', 'services']) if (!Array.isArray(this.settings[k]) || !this.settings[k].length) this.settings[k] = DEFAULT_SETTINGS[k];
      for (const k of ['barbers', 'plans']) if (!Array.isArray(this.settings[k])) this.settings[k] = [];
      for (const k of ['schedule', 'agenda', 'booking', 'loyalty']) this.settings[k] = { ...DEFAULT_SETTINGS[k], ...(this.settings[k] || {}) };
    });
    this._unsubs.push(onSnapshot(this.ref('config', 'security'), (s) => { this.security = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(this.ref('config', 'counters'), (s) => { this.counters = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(doc(db, 'system', 'announcement'), (s) => { this.announcement = s.exists() ? s.data() : null; this.emit('announcement'); }, () => {}));
    listen(this.col('clients'), 'clients', (s) => { this.clients = rows(s).sort(byName); this._cMap = null; });
    listen(query(this.col('appointments'), where('date', '>=', dayKey(addDays(new Date(), -1)))), 'appointments', (s) => {
      this.appointments = rows(s).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`) || (a.queueNo || 0) - (b.queueNo || 0));
    });
    listen(this.col('products'), 'products', (s) => { this.products = rows(s).sort(byName); this._pMap = null; });
    listen(query(this.col('cash_shifts'), where('status', '==', 'open')), 'shift', (s) => {
      this.openShift = rows(s).sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))[0] || null;
    });
    const since = startOfDay(addDays(new Date(), -7)).toISOString();
    listen(query(this.col('sales'), where('date', '>=', since)), 'sales', (s) => {
      this.recentSales = rows(s).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    });
    // Solicitudes de la reserva en línea (colección pública, filtrada por sede)
    this._unsubs.push(onSnapshot(query(collection(db, 'requests'), where('tenantId', '==', tenantId)), (s) => {
      this.requests = rows(s).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      this.emit('requests');
    }, (e) => console.warn('[store] requests', e?.code || e)));

    // Nunca bloquear más de 8 s (p. ej. sin internet y sin caché)
    await Promise.race([readyP, new Promise((r) => setTimeout(r, 8000))]);
    this.ready = true;
  }

  stop() {
    this._unsubs.forEach((u) => { try { u(); } catch (_) {} });
    this._unsubs = [];
    this.ready = false;
    this.tenant = null; this.clients = []; this.appointments = []; this.requests = []; this.products = [];
    this.openShift = null; this.recentSales = [];
    this.settings = { ...DEFAULT_SETTINGS }; this.security = {}; this.counters = {}; this._pMap = null; this._cMap = null;
  }

  // ---------- Ajustes ----------
  get rate() { return 1; }
  get country() { return this.settings.country || ''; }
  get businessName() { return this.settings.businessName || this.tenant?.name || 'Mi barbería'; }
  service(id) { return this.settings.services.find((s) => s.id === id) || null; }
  get activeServices() { return this.settings.services.filter((s) => s.active !== false); }
  barber(id) { return this.settings.barbers.find((b) => b.id === id) || null; }
  get activeBarbers() { return this.settings.barbers.filter((b) => b.active !== false); }
  plan(id) { return this.settings.plans.find((p) => p.id === id) || null; }
  get activePlans() { return this.settings.plans.filter((p) => p.active !== false); }
  get loyalty() { return this.settings.loyalty; }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    await this.save('config', 'settings', patch, true);
    this.emit('settings');
  }
  /** País de trabajo: define moneda, formas de pago, prefijo de WhatsApp y nombres de documentos */
  async setCountry(code, currency = null) {
    const prevCur = this.settings.currency || 'USD';
    const first = !this.settings.country;
    const l = applyLocale(code, currency);
    const patch = { country: code, currency: l.cur, countrySetAt: new Date().toISOString() };
    // Primera vez: los precios de ejemplo (en USD) se adaptan a la moneda del país
    if (first && prevCur !== l.cur) {
      const defS = new Map(DEFAULT_SERVICES.map((x) => [x.id, x.price]));
      patch.services = (this.settings.services || []).map((x) => (defS.get(x.id) === x.price ? { ...x, price: scaleUSD(x.price, l.cur, l.dec) } : x));
      const defP = new Map(DEFAULT_PLANS.map((x) => [x.id, x.price]));
      patch.plans = (this.settings.plans || []).map((x) => (defP.get(x.id) === x.price ? { ...x, price: scaleUSD(x.price, l.cur, l.dec) } : x));
      patch.barbers = (this.settings.barbers || []).map((x) => ({ ...x, rent: x.rent ? scaleUSD(x.rent, l.cur, l.dec) : 0, salary: x.salary ? scaleUSD(x.salary, l.cur, l.dec) : 0 }));
    }
    await this.saveSettings(patch);
    this.emit('rate', 1);
  }

  /** Correlativo (clientes "cli", facturas "inv", turnos de caja "shift", turno de espera "q-AAAA-MM-DD"…) */
  nextSeq(b, key) {
    const n = (Number(this.counters[key]) || 0) + 1;
    this.counters = { ...this.counters, [key]: n };
    b.set(this.ref('config', 'counters'), { [key]: n }, { merge: true });
    return n;
  }

  // ---------- PIN de administrador ----------
  hasPin() { return !!this.security.pinHash; }
  async verifyPin(pin) {
    if (!this.security.pinHash) {
      const s = await getDoc(this.ref('config', 'security')).catch(() => null);
      if (s?.exists()) this.security = s.data();
    }
    if (!this.security.pinHash) return true;
    return (await sha256(`${this.tenantId}:${pin}`)) === this.security.pinHash;
  }
  async setPin(pin) {
    const pinHash = await sha256(`${this.tenantId}:${pin}`);
    this.security = { ...this.security, pinHash, updatedAt: new Date().toISOString() };
    await this.save('config', 'security', this.security, true);
  }

  // ---------- Clientes ----------
  product(id) {
    if (!this._pMap) this._pMap = new Map(this.products.map((p) => [p.id, p]));
    return this._pMap.get(id);
  }
  client(id) {
    if (!this._cMap) this._cMap = new Map(this.clients.map((p) => [p.id, p]));
    return this._cMap.get(id);
  }
  get liveClients() { return this.clients.filter((c) => c.active !== false); }
  /** Busca por código de tarjeta (o su enlace), N° de cliente o teléfono */
  findClient(code) {
    const raw = String(code || '').trim();
    if (!raw) return null;
    const url = /\/tarjeta\/([A-Z0-9]+)/i.exec(raw);
    const v = (url ? url[1] : raw).toUpperCase().replace(/\s+/g, '');
    const digits = v.replace(/\D/g, '');
    return this.clients.find((m) => (m.cardCode || '') === v)
      || this.clients.find((m) => (m.number || '').toUpperCase() === v || (/^C-?\d+$/.test(v) && Number(m.seq) === Number(digits)))
      || (digits.length >= 7 ? this.clients.find((m) => String(m.phone || '').replace(/\D/g, '').endsWith(digits.slice(-8))) : null)
      || null;
  }
  findByPhone(phone, exceptId = null) {
    const d = String(phone || '').replace(/\D/g, '');
    if (d.length < 7) return null;
    const k = d.slice(-8);
    return this.clients.find((c) => c.id !== exceptId && String(c.phone || '').replace(/\D/g, '').slice(-8) === k) || null;
  }
  /** Ciclo de corte del cliente: su promedio real o el ciclo general de la barbería */
  cycleOf(c) { return Number(c?.avgDays) || Number(this.settings.cycleDays) || 21; }
  /** Días desde su último corte */
  daysSince(c) { return c?.lastVisitAt ? daysBetween(c.lastVisitAt.slice(0, 10), todayKey()) : null; }
  clientStatus(c) {
    if (!c) return 'nuevo';
    if (c.active === false) return 'baja';
    const d = this.daysSince(c);
    if (d == null) return 'nuevo';
    const cy = this.cycleOf(c);
    if (d > Math.max(90, cy * 3)) return 'perdido';
    if (d > cy + 7) return 'atrasado';
    if (d >= cy - 2) return 'le_toca';
    return 'al_dia';
  }
  /** Su próxima cita abierta (hoy o después) */
  nextAppointmentOf(clientId) {
    const t = todayKey(); const nm = nowMin();
    return this.appointments.find((a) => a.clientId === clientId && OPEN_STATUS.includes(a.status) && (a.date > t || (a.date === t && (a.end || 0) >= nm - 30))) || null;
  }
  /** Les toca corte y no tienen cita: a quién escribirle hoy */
  get dueClients() {
    return this.liveClients.filter((c) => ['le_toca', 'atrasado'].includes(this.clientStatus(c)) && !this.nextAppointmentOf(c.id))
      .sort((a, b) => (this.daysSince(b) - this.cycleOf(b)) - (this.daysSince(a) - this.cycleOf(a)));
  }
  get lostClients() { return this.liveClients.filter((c) => this.clientStatus(c) === 'perdido').sort((a, b) => (b.lastVisitAt || '').localeCompare(a.lastVisitAt || '')); }
  get debtors() { return this.clients.filter((m) => m.active !== false && (Number(m.balance) || 0) > 0.009).sort((a, b) => (b.balance || 0) - (a.balance || 0)); }
  get totalDebt() { return this.debtors.reduce((a, m) => a + (Number(m.balance) || 0), 0); }
  get birthdaysToday() {
    const md = todayKey().slice(5);
    return this.clients.filter((m) => m.active !== false && m.birthDate && m.birthDate.slice(5) === md);
  }
  birthdaysWithin(days = 7) {
    const out = [];
    for (let i = 0; i <= days; i++) {
      const md = dayKey(addDays(new Date(), i)).slice(5);
      this.clients.filter((m) => m.active !== false && m.birthDate && m.birthDate.slice(5) === md).forEach((m) => out.push({ ...m, inDays: i }));
    }
    return out;
  }
  /** Club que vence pronto (o ya vencido hace poco) */
  clubExpiring(days = 5) {
    const t = todayKey(); const lim = dayKey(addDays(new Date(), days)); const from = dayKey(addDays(new Date(), -15));
    return this.clients.filter((c) => c.active !== false && c.membership && c.membership.status !== 'anulada' && (c.membership.end <= lim || Number(c.membership.left) <= 1) && c.membership.end >= from)
      .sort((a, b) => a.membership.end.localeCompare(b.membership.end)).map((c) => ({ ...c, _expired: c.membership.end < t }));
  }
  /** ¿El club del cliente cubre este servicio hoy? */
  clubCovers(c, serviceId) {
    const ms = c?.membership;
    if (!ms || ms.status === 'anulada') return false;
    const t = todayKey();
    if (ms.start > t || ms.end < t) return false;
    if (Number(ms.left ?? 0) <= 0) return false;
    return !(ms.services || []).length || ms.services.includes(serviceId);
  }

  // ---------- Agenda ----------
  apptsOn(date) { return this.appointments.filter((a) => a.date === date); }
  apptsFor(barberId, date) { return this.appointments.filter((a) => a.barberId === barberId && a.date === date && BUSY_STATUS.includes(a.status)); }
  get todayAppts() { return this.apptsOn(todayKey()); }
  /** Turnos de hoy en espera, por orden de llegada */
  get waiting() {
    return this.todayAppts.filter((a) => a.status === 'espera').sort((a, b) => (a.arrivedAt || a.createdAt || '').localeCompare(b.arrivedAt || b.createdAt || ''));
  }
  get inChair() { return this.todayAppts.filter((a) => a.status === 'en_silla'); }
  /** Citas de hoy que aún no llegan */
  get upcomingToday() {
    const nm = nowMin();
    return this.todayAppts.filter((a) => ['reservada', 'confirmada'].includes(a.status) && (a.end || toMin(a.time) + 30) >= nm - (Number(this.settings.agenda.noShowMinutes) || 15)).sort((a, b) => (a.start || 0) - (b.start || 0));
  }
  get pendingRequests() { return this.requests.filter((r) => (r.status || 'nueva') === 'nueva'); }
  /** Intervalos ocupados [inicio, fin] de un barbero en una fecha (minutos) */
  busyOf(barberId, date, exceptId = null) {
    return this.apptsFor(barberId, date).filter((a) => a.id !== exceptId).map((a) => [a.start ?? toMin(a.time), a.end ?? (toMin(a.time) + (a.minutes || 30))]);
  }
  /**
   * Minutos que tardaría cada barbero en quedar libre si hoy llega alguien sin cita:
   * lo que le falta al cliente en silla + los que esperan por él + sus citas que se cruzan.
   */
  waitEstimate() {
    const nm = nowMin(); const t = todayKey(); const wd = new Date().getDay();
    const out = {};
    for (const b of this.activeBarbers) {
      const h = barberHours(b, this.settings.schedule, wd);
      if (!h || nm >= h.close) continue;
      let free = Math.max(nm, h.open);
      const chair = this.inChair.find((a) => a.barberId === b.id);
      if (chair) free = Math.max(free, (chair.startedMin ?? nm) + (chair.minutes || 30));
      const queue = this.waiting.filter((a) => a.barberId === b.id);
      for (const q of queue) free += q.minutes || 30;
      const appts = this.apptsFor(b.id, t).filter((a) => ['reservada', 'confirmada'].includes(a.status)).sort((x, y) => x.start - y.start);
      for (const a of appts) if (a.start < free + 20 && a.end > free) free = Math.max(free, a.end);
      out[b.id] = { barber: b, freeAt: free, wait: Math.max(0, free - nm), queue: queue.length, chair };
    }
    return out;
  }
  /** Barbero que queda libre primero (para "el primero disponible") */
  firstFree() {
    const est = Object.values(this.waitEstimate()).filter((x) => x.barber.walkins !== false);
    return est.sort((a, b) => a.wait - b.wait)[0] || null;
  }

  // ---------- Inventario ----------
  get lowProducts() {
    return this.products.filter((p) => p.active !== false && p.trackStock !== false && (Number(p.stock) || 0) <= (Number(p.minStock) || 0));
  }
  get outProducts() { return this.products.filter((p) => p.active !== false && p.trackStock !== false && (Number(p.stock) || 0) <= 0); }
  get expiringProducts() {
    const lim = dayKey(addDays(new Date(), 60));
    return this.products.filter((p) => p.active !== false && p.expiresAt && p.expiresAt <= lim && (Number(p.stock) || 0) > 0)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  // ---------- Consultas a la base ----------
  async listBetween(name, field, fromISO, toISO) {
    const s = await getDocs(query(this.col(name), where(field, '>=', fromISO), where(field, '<=', toISO)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async salesBetween(fromISO, toISO) { return this.listBetween('sales', 'date', fromISO, toISO); }
  async listEq(name, field, value) {
    const s = await getDocs(query(this.col(name), where(field, '==', value)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async getDocById(name, id) {
    const s = await getDoc(this.ref(name, id));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  }
  async getClient(id) { return this.client(id) || this.getDocById('clients', id); }
  async clientVisits(id) { return (await this.listEq('visits', 'clientId', id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
  async clientSales(id) { return (await this.listEq('sales', 'memberId', id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
  async clientAppts(id) { return (await this.listEq('appointments', 'clientId', id)).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)); }
  async clientMemberships(id) { return (await this.listEq('memberships', 'memberId', id)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }
  async apptsBetween(from, to) { return this.listBetween('appointments', 'date', from, to); }
  async closedShifts(max = 30) {
    const s = await getDocs(query(this.col('cash_shifts'), where('status', '==', 'closed')));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || '')).slice(0, max);
  }
}

export const store = new Store();

// ---------- Administración de sedes (solo administrador general) ----------
export async function listTenants() {
  const s = await getDocs(collection(db, 'tenants'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.code || a.name || '').localeCompare(b.code || b.name || '', 'es', { numeric: true }));
}
export async function updateTenant(id, data) { await setDoc(doc(db, 'tenants', id), data, { merge: true }); }
export async function tenantSalesSince(tenantId, fromISO) {
  const s = await getDocs(query(collection(db, 'tenants', tenantId, 'sales'), where('date', '>=', fromISO)));
  return s.docs.map((d) => d.data());
}
export async function tenantApptsOn(tenantId, day) {
  const s = await getDocs(query(collection(db, 'tenants', tenantId, 'appointments'), where('date', '==', day)));
  return s.docs.map((d) => d.data());
}
export async function getTenant(id) {
  const s = await getDoc(doc(db, 'tenants', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function createTenantDoc(id, data) { await setDoc(doc(db, 'tenants', id), data); }
export async function getUsername(username) {
  const s = await getDoc(doc(db, 'usernames', String(username).toLowerCase()));
  return s.exists() ? s.data() : null;
}
export async function setUsername(username, data) { await setDoc(doc(db, 'usernames', String(username).toLowerCase()), data); }
export async function deleteUsername(username) { await deleteDoc(doc(db, 'usernames', String(username).toLowerCase())); }
export async function setAnnouncement(data) { await setDoc(doc(db, 'system', 'announcement'), data); }
export async function getAnnouncement() {
  const s = await getDoc(doc(db, 'system', 'announcement'));
  return s.exists() ? s.data() : null;
}
/** Tarjeta pública del cliente (página /tarjeta/CODIGO) */
export async function getCard(code) {
  const s = await getDoc(doc(db, 'cards', String(code).toUpperCase()));
  return s.exists() ? s.data() : null;
}
/** Página pública de reservas (/reservar/SLUG) */
export async function getBookingPage(slug) {
  const s = await getDoc(doc(db, 'booking', String(slug).toLowerCase()));
  return s.exists() ? s.data() : null;
}
export { DEFAULT_SETTINGS };
