// SanoCortes — Prueba de punta a punta contra los emuladores (datos creados por test-emu.sh)
// Uso: node e2e.mjs [url=http://127.0.0.1:5111] [carpeta de capturas]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5111';
const BASE = ORIGIN + '/?emu=1';
const OUT = path.resolve(here, process.argv[3] || 'shots');
mkdirSync(OUT, { recursive: true });
const acc = JSON.parse(readFileSync(path.join(here, '.accounts-emu.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; let passed = 0;
const ok = (name, cond, extra = '') => { console.log(cond ? '  ✔' : '  ✘', name, extra); if (cond) passed++; else fails++; };
const errs = [];
const logs = [];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function newPage(w = 1366, h = 860) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  p.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) logs.push(m.text()); });
  return { ctx, p };
}
// Ejecuta una función con acceso a los módulos de la app
const run = (p, fn, arg = null) => p.evaluate(async (src, a) => {
  const M = { store: (await import('/js/store.js')).store, ops: await import('/js/ops.js'), utils: await import('/js/utils.js'), barber: await import('/js/barber.js') };
  M.wait = async (f, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return f(); };
  return (0, eval)(src)(M, a);
}, fn.toString(), arg);
const go = async (p, route) => { await p.evaluate((r) => { location.hash = '#/' + r; }, route); await sleep(1100); };
const text = (p) => p.evaluate(() => document.body.innerText);
const pin = async (p, value = null) => {
  await p.waitForSelector('.modal [data-pin]', { timeout: 8000 });
  await p.type('.modal [data-pin]', value || acc.sede01.pin);
  await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
  await sleep(900);
};
const pickCountry = async (p, code) => {
  await p.waitForSelector(`.country-grid [data-c="${code}"]`, { timeout: 60000 });
  await p.click(`.country-grid [data-c="${code}"]`); await sleep(250);
  await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
  await sleep(1500);
};

try {
  // ==================================================================
  console.log('1) Inicio de sesión y país');
  let { ctx, p } = await newPage();
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.screenshot({ path: path.join(OUT, '01-login.png') });
  await p.type('#lg-user', 'sede01'); await p.type('#lg-pass', acc.sede01.password); await p.click('#lg-btn');
  await pickCountry(p, 'VE');
  await p.waitForSelector('.sb-nav', { timeout: 30000 });
  ok('sede01 entra y elige país (Venezuela)', (await run(p, ({ store }) => store.settings.country)) === 'VE');
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());

  // ==================================================================
  console.log('2) Equipo, horario y caja');
  const r1 = await run(p, async ({ store, ops }) => {
    const all = { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59', satOpen: '00:00', satClose: '23:59', sunOpen: '00:00', sunClose: '23:59' };
    const base = { phone: '', specialty: '', days: [], from: '', to: '', breakFrom: '', breakTo: '', online: true, walkins: true, active: true };
    await store.saveSettings({
      businessName: 'Barbería Prueba', whatsapp: '04141234567', schedule: all,
      barbers: [
        { ...base, id: 'b1', name: 'Pedro Comisión', color: '#d49a3a', mode: 'comision', commission: 50, productCommission: 10, rent: 0, salary: 0 },
        { ...base, id: 'b2', name: 'Juan Alquiler', color: '#dc2626', mode: 'alquiler', commission: 0, productCommission: 10, rent: 30, salary: 0 }
      ]
    });
    await ops.openShift({ openingUSD: 20 });
    await new Promise((r) => setTimeout(r, 800));
    return { barbers: store.activeBarbers.length, shift: !!store.openShift, svc: store.activeServices.length };
  });
  ok('Dos barberos (comisión y alquiler) guardados', r1.barbers === 2);
  ok('Servicios sugeridos de barbería cargados', r1.svc >= 10, String(r1.svc));
  ok('Caja abierta', r1.shift);

  // ==================================================================
  console.log('3) Clientes y agenda');
  const r2 = await run(p, async ({ store, ops, utils }) => {
    const c = await ops.saveClient({ name: 'Mario Prueba', phone: '04241112233', birthday: '1990-05-10' });
    let dup = ''; try { await ops.saveClient({ name: 'Otro', phone: '04241112233' }); } catch (e) { dup = e.message; }
    const tomorrow = utils.dayKey(utils.addDays(new Date(), 1));
    const a = await ops.saveAppointment({ client: { id: c.id }, date: tomorrow, time: '10:00', barberId: 'b1', serviceIds: ['corte', 'barba'] });
    let conflict = ''; try { await ops.saveAppointment({ client: { name: 'Luis Choque', phone: '04165550000' }, date: tomorrow, time: '10:15', barberId: 'b1', serviceIds: ['corte'] }); } catch (e) { conflict = e.code + ' ' + e.message; }
    const other = await ops.saveAppointment({ client: { name: 'Luis Choque', phone: '04165550000' }, date: tomorrow, time: '10:15', barberId: 'b2', serviceIds: ['corte'] });
    await new Promise((r) => setTimeout(r, 600));
    const card = await (await import('/js/store.js')).getCard(c.cardCode);
    return { id: c.id, number: c.number, code: c.cardCode, dup, minutes: a.minutes, end: a.end, conflict, other: other.barberName, next: card?.next?.time, luis: !!store.findByPhone('04165550000') };
  });
  ok('Cliente nuevo con número y tarjeta', /^C-\d{4}$/.test(r2.number) && !!r2.code, r2.number);
  ok('Rechaza teléfono duplicado', /Ya existe/.test(r2.dup));
  ok('Cita corte + barba dura 50 min', r2.minutes === 50 && r2.end === 650, `${r2.minutes} min`);
  ok('Detecta choque de horario del mismo barbero', /conflict/.test(r2.conflict), r2.conflict.slice(0, 70));
  ok('Otro barbero sí puede a esa hora y crea al cliente', r2.other === 'Juan Alquiler' && r2.luis);
  ok('La tarjeta del cliente muestra la próxima cita', r2.next === '10:00', String(r2.next));
  await go(p, 'agenda'); await sleep(800);
  await p.screenshot({ path: path.join(OUT, '02-agenda.png') });

  // ==================================================================
  console.log('4) Sala de espera, silla y cobro');
  const r3 = await run(p, async ({ store, ops, wait }) => {
    const c = store.client((await wait(() => store.clients.find((x) => x.name === 'Mario Prueba'))).id);
    const w = await ops.addWalkin({ client: { id: c.id }, serviceIds: ['fade'], barberId: 'b1' });
    const w2 = await ops.addWalkin({ client: { name: 'Pana Sin Cita' }, serviceIds: ['corte'], barberId: 'any' });
    await wait(() => store.waiting.length >= 2);
    const waiting = store.waiting.length;
    const a = await wait(() => store.appointments.find((x) => x.id === w.id));
    await ops.setApptStatus(a, 'en_silla');
    await wait(() => store.inChair.length === 1);
    let busy = ''; const a2 = store.appointments.find((x) => x.id === w2.id);
    try { await ops.setApptStatus({ ...a2, barberId: 'b1' }, 'en_silla', { barberId: 'b1' }); } catch (e) { busy = e.message; }
    const appt = store.appointments.find((x) => x.id === w.id);
    const fade = store.service('fade');
    const res = await ops.chargeTicket({
      lines: [{ kind: 'servicio', serviceId: 'fade', name: fade.name, price: fade.price, listPrice: fade.price, qty: 1, barberId: 'b1' }],
      client: { id: c.id }, appt, tips: [{ barberId: 'b1', amount: 2 }], payments: [{ method: 'efectivo', amount: 20 }],
      style: { fade: 'Mid fade', guard: '1', top: 'Texturizado', notes: 'Prueba' }
    });
    await wait(() => store.appointments.find((x) => x.id === w.id)?.status === 'terminada');
    const after = store.client(c.id);
    return { q1: w.queueNo, q2: w2.queueNo, waiting, busy, total: res.sale.total, change: res.sale.changeUSD, number: res.sale.number, status: store.appointments.find((x) => x.id === w.id).status, stamps: after.stamps, visits: after.visits, style: after.lastStyle?.fade, w2b: w2.barberId };
  });
  ok('Turnos sin cita numerados en la fila', r3.q1 === 1 && r3.q2 === 2 && r3.waiting >= 2, `${r3.q1}, ${r3.q2}`);
  ok('"El primero libre" asigna un barbero', ['b1', 'b2'].includes(r3.w2b), r3.w2b);
  ok('Un barbero no puede tener dos clientes en la silla', /está atendiendo/.test(r3.busy), r3.busy);
  ok('Cobro con propina y vuelto', r3.total === 12 && r3.change === 8, `total ${r3.total} · vuelto ${r3.change} · ${r3.number}`);
  ok('El turno queda terminado', r3.status === 'terminada');
  ok('Suma visita, sello y guarda la receta del corte', r3.visits === 1 && r3.stamps === 1 && r3.style === 'Mid fade', JSON.stringify([r3.visits, r3.stamps, r3.style]));
  await go(p, 'turnos'); await sleep(600);
  await p.screenshot({ path: path.join(OUT, '03-turnos.png') });

  // ==================================================================
  console.log('5) Fiado, club y premios');
  const r4 = await run(p, async ({ store, ops, wait }) => {
    const c0 = store.clients.find((x) => x.name === 'Mario Prueba');
    const corte = store.service('corte');
    const line = (extra = {}) => ({ kind: 'servicio', serviceId: 'corte', name: corte.name, price: corte.price, listPrice: corte.price, qty: 1, barberId: 'b1', ...extra });
    await ops.chargeTicket({ lines: [line()], client: { id: c0.id }, credit: 8, payments: [] });
    const debt = await wait(() => store.client(c0.id).balance > 0 && store.client(c0.id).balance);
    await ops.payBalance(store.client(c0.id), { amount: 8, payments: [{ method: 'efectivo', amount: 8 }] });
    await wait(() => store.client(c0.id).balance < 0.01);
    const paid = store.client(c0.id).balance;
    const plan = store.activePlans.find((x) => x.id === 'club4');
    await ops.sellPlan({ client: { id: c0.id }, plan, payments: [{ method: 'transferencia', amount: plan.price }] });
    await wait(() => store.client(c0.id).membership?.left === 4);
    await ops.chargeTicket({ lines: [line({ price: 0, club: true })], client: { id: c0.id }, payments: [] });
    await wait(() => store.client(c0.id).membership?.left === 3);
    const left = store.client(c0.id).membership?.left;
    let noClub = ''; try { await ops.chargeTicket({ lines: [line({ price: 0, club: true })], client: { name: 'Sin Club Nadie' }, payments: [] }); } catch (e) { noClub = e.message; }
    await ops.adjustLoyalty(store.client(c0.id), { stamps: 9, rewards: 0, reason: 'prueba' });
    await wait(() => store.client(c0.id).stamps === 9);
    const s = await ops.chargeTicket({ lines: [line()], client: { id: c0.id }, payments: [{ method: 'efectivo', amount: 8 }] });
    await wait(() => store.client(c0.id).rewards === 1);
    const rewards = store.client(c0.id).rewards;
    await ops.chargeTicket({ lines: [line({ price: 0, reward: true })], client: { id: c0.id }, payments: [] });
    await wait(() => store.client(c0.id).rewards === 0);
    const used = store.client(c0.id).rewards;
    return { debt, paid, left, noClub, earned: s.sale.earnedReward, rewards, used, stamps: store.client(c0.id).stamps };
  });
  ok('Fiado deja saldo pendiente', r4.debt === 8, String(r4.debt));
  ok('Abono deja la deuda en cero', r4.paid < 0.01, String(r4.paid));
  ok('Club: un corte del plan descuenta un servicio', r4.left === 3, String(r4.left));
  ok('Club: no se usa sin plan', /club/i.test(r4.noClub), r4.noClub);
  ok('Al completar 10 sellos gana el premio', r4.earned === true && r4.rewards === 1, JSON.stringify([r4.earned, r4.rewards]));
  ok('Canjear el premio lo descuenta (sin sumar sello)', r4.used === 0 && r4.stamps === 0, `sellos ${r4.stamps}`);

  // ==================================================================
  console.log('6) Pagos a barberos');
  const r5 = await run(p, async ({ ops, utils }) => {
    const t = utils.todayKey(); const from = utils.dayKey(utils.addDays(new Date(), -6));
    const rows = await ops.payroll(from, t);
    const b1 = rows.find((r) => r.barber.id === 'b1'); const b2 = rows.find((r) => r.barber.id === 'b2');
    const pay = await ops.payBarber({ barber: b1.barber, from, to: t, amount: b1.net, method: 'efectivo', summary: { services: b1.services } });
    await new Promise((r) => setTimeout(r, 800));
    const again = (await ops.payroll(from, t)).find((r) => r.barber.id === 'b1');
    return { services: b1.services, tips: b1.tips, comm: b1.serviceComm, net: b1.net, rent: b2.rent, b2net: b2.net, pay: pay.number, after: again.net, paid: again.paid };
  });
  ok('Comisión del 50% sobre lista (incluye club y premio) + propina', r5.comm === 21 && r5.tips === 2 && r5.services === 5, `servicios ${r5.services} · comisión ${r5.comm} · propina ${r5.tips}`);
  ok('Barbero de alquiler debe la silla de la semana', r5.rent === 30 && r5.b2net === -30, `alquiler ${r5.rent} · neto ${r5.b2net}`);
  ok('Pago registrado deja la liquidación en cero', /^L-\d{4}$/.test(r5.pay) && Math.abs(r5.after) < 0.01 && r5.paid === r5.net, `${r5.pay} · ${r5.net} · después ${r5.after}`);

  // ==================================================================
  console.log('7) Reserva en línea y tarjeta pública');
  const slug = 'barberia-prueba-e2e';
  const r6 = await run(p, async ({ store, ops }, sl) => {
    await store.saveSettings({ booking: { ...store.settings.booking, enabled: true, slug: sl, leadMinutes: 0, autoAccept: false } });
    await ops.publishBooking({ force: true });
    const d = await (await import('/js/store.js')).getBookingPage(sl);
    return { ok: !!d, barbers: d?.barbers?.length, svcs: d?.services?.length };
  }, slug);
  ok('Página de reservas publicada', r6.ok && r6.barbers === 2 && r6.svcs >= 8, JSON.stringify(r6));
  const pubCtx = await browser.createBrowserContext();
  const pub = await pubCtx.newPage();
  await pub.setViewport({ width: 390, height: 844, isMobile: true });
  pub.on('pageerror', (e) => errs.push('público: ' + e.message));
  await pub.goto(`${ORIGIN}/reservar/${slug}?emu=1`, { waitUntil: 'networkidle2' });
  await pub.waitForSelector('[data-s]', { timeout: 20000 });
  await pub.click('[data-s="corte"]'); await sleep(200);
  await pub.screenshot({ path: path.join(OUT, '04-reserva-1.png') });
  await pub.click('[data-next]'); await sleep(300);
  await pub.screenshot({ path: path.join(OUT, '04-reserva-2.png') });
  await pub.click('[data-b="b2"]'); await sleep(400);
  const tomorrow = await run(p, ({ utils }) => utils.dayKey(utils.addDays(new Date(), 1)));
  await pub.click(`[data-d="${tomorrow}"]`); await sleep(300);
  await pub.screenshot({ path: path.join(OUT, '04-reserva-3.png') });
  // 10:15–10:45 está ocupado con Luis (Juan) → 10:00, 10:15 y 10:30 no deben aparecer
  const busyHidden = await pub.evaluate(() => !document.querySelector('[data-t="10:00"]') && !document.querySelector('[data-t="10:15"]') && !document.querySelector('[data-t="10:30"]'));
  const freeShown = await pub.evaluate(() => !!document.querySelector('[data-t="11:00"]') && !!document.querySelector('[data-t="09:45"]'));
  ok('Horario ocupado no aparece, libre sí', busyHidden && freeShown);
  await pub.click('[data-t="11:00"]'); await sleep(200); await pub.click('[data-next]'); await sleep(300);
  await pub.type('input[name="name"]', 'Cliente Web Prueba'); await pub.type('input[name="phone"]', '04261234567'); await pub.type('input[name="note"]', 'mismo de siempre');
  await pub.click('[data-f] button.btn-success'); await sleep(2500);
  ok('Cliente envía la reserva sin cuenta', (await pub.evaluate(() => document.body.innerText)).includes('¡Reserva enviada!'));
  await pub.screenshot({ path: path.join(OUT, '04-reserva-ok.png') });
  // Tarjeta pública
  await pub.goto(`${ORIGIN}/tarjeta/${r2.code}?emu=1`, { waitUntil: 'networkidle2' });
  await pub.waitForSelector('.mcard', { timeout: 20000 }); await sleep(800);
  const ct = await pub.evaluate(() => document.body.innerText);
  ok('Tarjeta pública con nombre, club y QR', ct.includes('Mario Prueba') && ct.includes('Club mensual') && !!(await pub.$('.mcard-qr img')), ct.replace(/\s+/g, ' ').slice(0, 100));
  await pub.screenshot({ path: path.join(OUT, '05-tarjeta.png'), fullPage: true });
  await pub.goto(`${ORIGIN}/tarjeta/NOEXISTE1?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  ok('Tarjeta inexistente muestra aviso', (await pub.evaluate(() => document.body.innerText)).includes('Tarjeta no encontrada'));
  await pub.goto(`${ORIGIN}/reservar/no-existe-nada?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  await pub.screenshot({ path: path.join(OUT, '05-reserva-noexiste.png') });
  await pubCtx.close();
  // La barbería recibe la solicitud
  const r7 = await run(p, async ({ store, ops, wait }) => {
    const r = await wait(() => store.pendingRequests.find((x) => x.name === 'Cliente Web Prueba'), 10000);
    if (!r) return { got: false };
    const a = await ops.acceptRequest(r, { barberId: ops.barberForRequest(r) });
    await wait(() => !store.pendingRequests.length);
    return { got: true, status: a.status, barber: a.barberId, time: a.time, src: a.source, left: store.pendingRequests.length, client: !!store.findByPhone('04261234567') };
  });
  ok('La barbería recibe la solicitud en vivo', r7.got);
  ok('Aceptarla crea cita confirmada y el cliente', r7.status === 'confirmada' && r7.barber === 'b2' && r7.time === '11:00' && r7.client && r7.left === 0, JSON.stringify(r7));

  // ==================================================================
  console.log('8) Pantallas, reportes y pantalla de turnos');
  const before = errs.length;
  for (const v of ['inicio', 'agenda', 'turnos', 'clientes', 'fidelizar', 'cobrar', 'barberos', 'facturas', 'caja', 'inventario', 'ajustes']) {
    await go(p, v);
    await p.screenshot({ path: path.join(OUT, `10-${v}.png`) });
  }
  await go(p, 'fidelizar');
  const ftabs = await p.$$eval('.tabs button', (x) => x.length);
  for (let i = 0; i < ftabs; i++) { await p.evaluate((n) => document.querySelectorAll('.tabs button')[n].click(), i); await sleep(500); }
  await go(p, 'barberos');
  const btabs = await p.$$eval('.tabs button', (x) => x.length);
  for (let i = 0; i < btabs; i++) { await p.evaluate((n) => document.querySelectorAll('.tabs button')[n].click(), i); await sleep(900); if (i === 1) await p.screenshot({ path: path.join(OUT, '11-barberos-pagos.png') }); }
  await go(p, 'reportes'); await pin(p); await sleep(1800);
  const rt = await text(p);
  ok('Reportes con PIN muestran ocupación y barberos', /ocupaci/i.test(rt) && rt.includes('Pedro Comisión'));
  await p.screenshot({ path: path.join(OUT, '10-reportes.png'), fullPage: true });
  await p.evaluate(async (id) => (await import('/js/client.js')).openClient(id), r2.id); await sleep(1500);
  const tabs = await p.$$eval('.modal [data-tabs] [data-t]', (x) => x.map((b) => b.dataset.t));
  for (const t of tabs) { await p.click(`.modal [data-tabs] [data-t="${t}"]`).catch(() => {}); await sleep(700); }
  await p.screenshot({ path: path.join(OUT, '12-ficha.png') });
  await p.evaluate(async () => (await import('/js/utils.js')).closeAllModals());
  ok('Todas las pantallas y pestañas sin errores', errs.length === before && ftabs >= 5 && btabs >= 3 && tabs.length >= 3, errs.slice(before).join(' | ') + ` · fid ${ftabs} · barberos ${btabs} · ficha ${tabs.join(',')}`);
  await go(p, 'pantalla'); await sleep(1200);
  await p.screenshot({ path: path.join(OUT, '13-pantalla-sala.png') });
  await p.click('[data-mode="self"]'); await sleep(500);
  await p.click('#k-nophone'); await sleep(300);
  await p.type('#k-name', 'Kiosco Cliente'); await p.click('#k-next'); await sleep(300);
  await p.click('[data-s="corte"]'); await sleep(200); await p.click('#k-next'); await sleep(400);
  await p.click('[data-b="any"]'); await sleep(2000);
  await p.screenshot({ path: path.join(OUT, '13-pantalla-turno.png') });
  const kq = await run(p, ({ store }) => store.waiting.find((a) => a.clientName === 'Kiosco Cliente' && a.source === 'kiosco')?.queueNo || 0);
  ok('Autoservicio crea el turno en la sala de espera', kq >= 2, `turno ${kq}`);
  await p.click('#k-exit'); await pin(p); await sleep(800);
  ok('Salir de la pantalla con PIN vuelve a la sala de espera', (await p.evaluate(() => location.hash)).includes('turnos'));
  const r9 = await run(p, async ({ store, ops, wait }) => { const s = store.openShift; const e = ops.shiftExpected(s); await ops.closeShift(s, { countedUSD: e.cashUSD ?? e.usd ?? 0 }); return !!(await wait(() => !store.openShift)); });
  ok('Cierre de caja', r9);
  await ctx.close();

  // ==================================================================
  console.log('9) Demo');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.click('#lg-demo');
  await pickCountry(p, 'CO');
  await p.waitForFunction(() => document.body.innerText.includes('Modo demo') && !document.getElementById('boot'), { timeout: 120000 });
  await sleep(3000);
  const d = await run(p, ({ store }) => ({ clients: store.clients.length, today: store.todayAppts.length, chair: store.inChair.length, wait: store.waiting.length, sales: store.recentSales.length, products: store.products.length, shift: !!store.openShift, cur: store.settings.currency, corte: store.service('corte')?.price, barbers: store.activeBarbers.length, req: store.pendingRequests.length, due: store.dueClients.length }));
  ok('Demo con barbería de ejemplo completa', d.clients >= 20 && d.today >= 6 && d.chair >= 1 && d.sales >= 10 && d.products >= 10 && d.shift && d.barbers === 4, JSON.stringify(d));
  ok('Precios de la demo en pesos colombianos', d.cur === 'COP' && d.corte > 10000, String(d.corte));
  ok('Recorrido guiado abierto al entrar', !!(await p.waitForSelector('.tour-tip', { timeout: 20000 }).catch(() => null)));
  await p.screenshot({ path: path.join(OUT, '20-demo-tour.png') });
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());
  const b2 = errs.length;
  for (const v of ['inicio', 'agenda', 'turnos', 'clientes', 'fidelizar', 'cobrar', 'barberos', 'caja', 'pantalla']) { await go(p, v); await sleep(400); await p.screenshot({ path: path.join(OUT, `21-demo-${v}.png`) }); }
  ok('Pantallas de la demo sin errores', errs.length === b2, errs.slice(b2).join(' | '));
  await p.evaluate(() => { localStorage.setItem('sc_kiosk_mode', 'tv'); location.hash = '#/inicio'; }); await sleep(1500);
  const codes = await run(p, ({ store }) => store.clients.map((m) => m.cardCode));
  const dslug = await run(p, ({ store }) => store.settings.booking?.slug);
  const uid = await p.evaluate(async () => (await import('/js/firebase.js')).auth.currentUser.uid);
  await p.evaluate(() => document.getElementById('demo-end').click());
  await p.waitForSelector('.modal [data-yes]'); await p.click('.modal [data-yes]');
  await p.waitForSelector('#login-form', { timeout: 60000 }).catch(async (e) => { await p.screenshot({ path: path.join(OUT, '29-demo-fin.png') }); console.log('LOGS', logs.slice(-15).join(' || ')); throw e; });
  ok('Terminar la demo vuelve al login', true);
  await ctx.close();

  // ==================================================================
  console.log('10) Administrador general');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.type('#lg-user', 'admin'); await p.type('#lg-pass', acc.admin.password); await p.click('#lg-btn');
  await p.waitForSelector('[data-enter]', { timeout: 30000 }); await sleep(2000);
  ok('Admin ve las sedes', (await p.$$('[data-enter]')).length === 3);
  await p.screenshot({ path: path.join(OUT, '30-admin.png') });
  const gone = await p.evaluate(async (u, cs, sl) => {
    const f = await import('/js/firebase.js');
    const t = await f.getDoc(f.doc(f.db, 'tenants', u)); const c = await f.getDoc(f.doc(f.db, 'cards', cs[0]));
    const b = sl ? await f.getDoc(f.doc(f.db, 'booking', sl)) : null;
    return !t.exists() && !c.exists() && !(b && b.exists());
  }, uid, codes, dslug);
  ok('La demo, sus tarjetas y su página de reservas se borraron', gone, String(dslug));
  await ctx.close();
} catch (e) { console.log('ERROR', e.stack || e.message); fails++; }
await browser.close();
console.log('Errores de página:', errs.length ? errs.join(' | ') : 'ninguno');
console.log(`${passed} OK · ${fails} fallas`);
process.exit(fails ? 1 : 0);
