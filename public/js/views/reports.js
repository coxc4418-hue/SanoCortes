// SanoCortes — Reportes de la barbería (protegidos con PIN)
import { store, DAYS_SHORT } from '../store.js';
import { methodNet } from '../ops.js';
import { esc, usd, num, emptyState, startOfDay, endOfDay, addDays, dayKey, fromKey, fmtDate, shortDate, methodLabel, toCSV, download } from '../utils.js';
import { icon } from '../icons.js';
import { printDoc } from '../shared.js';
import { barberHours } from '../barber.js';

const RANGES = { hoy: 'Hoy', '7': '7 días', '30': '30 días', mes: 'Este mes', anio: 'Este año', custom: 'Personalizado' };
const KIND = { servicio: 'Servicios', producto: 'Productos', club: 'Club (prepagos)', abono: 'Cobro de saldos' };

export function mount(el) {
  let range = '30';
  let from = dayKey(addDays(new Date(), -29)); let to = dayKey();
  let data = null;

  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Reportes</h1><p class="view-sub">Ingresos, servicios, barberos, horas pico, ocupación de sillas, clientes que vuelven e inasistencias.</p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="r-csv">${icon('download')} Excel</button><button class="btn btn-secondary" id="r-print">${icon('print')} Imprimir</button></div></div>
    <div class="card" style="margin-bottom:16px;padding:12px 14px"><div class="row row-wrap"><div class="chips" id="r-ranges"></div><div class="row" id="r-custom" hidden><input class="input input-sm" type="date" id="r-from" style="width:auto"><span class="muted">a</span><input class="input input-sm" type="date" id="r-to" style="width:auto"></div></div></div>
    <div id="r-body"><div class="empty"><div class="spinner"></div></div></div>`;
  const $ = (s) => el.querySelector(s);

  function setRange(k) {
    range = k; const now = new Date();
    if (k === 'hoy') { from = to = dayKey(); }
    if (k === '7') { from = dayKey(addDays(now, -6)); to = dayKey(); }
    if (k === '30') { from = dayKey(addDays(now, -29)); to = dayKey(); }
    if (k === 'mes') { from = dayKey(new Date(now.getFullYear(), now.getMonth(), 1)); to = dayKey(); }
    if (k === 'anio') { from = dayKey(new Date(now.getFullYear(), 0, 1)); to = dayKey(); }
    $('#r-ranges').innerHTML = Object.entries(RANGES).map(([v, l]) => `<button class="chip ${v === range ? 'on' : ''}" data-r="${v}">${l}</button>`).join('');
    el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => setRange(b.dataset.r));
    $('#r-custom').hidden = k !== 'custom';
    $('#r-from').value = from; $('#r-to').value = to;
    load();
  }

  async function load() {
    $('#r-body').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    const a = startOfDay(fromKey(from)).toISOString(), b = endOfDay(fromKey(to)).toISOString();
    try {
      const [sales, visits, appts, moves] = await Promise.all([
        store.salesBetween(a, b), store.listBetween('visits', 'dayKey', from, to), store.apptsBetween(from, to), store.listBetween('cash_movements', 'date', a, b)
      ]);
      data = { sales: sales.filter((s) => s.status !== 'voided'), visits, appts, moves };
    } catch (e) { if ($('#r-body')) $('#r-body').innerHTML = `<div class="card">${emptyState('alert', 'No se pudo cargar', esc(e.message))}</div>`; return; }
    if (!$('#r-body')) return;
    render();
  }

  const top = (map, n = 8) => Object.entries(map).sort((x, y) => y[1] - x[1]).slice(0, n);
  function hbars(rows, fmt = (v) => v, unit = '') {
    if (!rows.length) return emptyState('chart', 'Sin datos en el período');
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return rows.map(([k, v]) => `<div class="hbar" title="${esc(k)}: ${fmt(v)}${unit}"><span class="ellipsis">${esc(k)}</span><div class="track"><i style="width:${Math.max(2, v / max * 100)}%"></i></div><b class="num">${fmt(v)}${unit}</b></div>`).join('');
  }
  const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };

  function compute() {
    const { sales, visits, appts, moves } = data;
    const billed = sales.reduce((a, s) => a + (s.total || 0), 0);
    const cash = sales.reduce((a, s) => a + (s.received || 0), 0);
    const cost = sales.reduce((a, s) => a + (s.cost || 0), 0);
    const byKind = {}; sales.forEach((s) => add(byKind, KIND[s.kind] || s.kind, s.total || 0));
    const services = {}; const svcCount = {}; const products = {}; const tips = {}; let tipsTotal = 0; let credit = 0;
    const perBarber = {};
    store.settings.barbers.forEach((b) => { perBarber[b.id] = { name: b.name, color: b.color, services: 0, billed: 0, products: 0, tips: 0, clients: new Set(), minutes: 0, avail: 0 }; });
    sales.forEach((s) => {
      credit += Number(s.credit) || 0;
      (s.items || []).forEach((i) => {
        const amt = (i.price || 0) * (i.qty || 0); const pb = perBarber[i.barberId];
        if (i.kind === 'servicio') { add(services, i.name, i.club || i.reward ? (i.listPrice || 0) * (i.qty || 1) : amt); add(svcCount, i.name, i.qty || 1); if (pb) { pb.services += i.qty || 1; pb.billed += amt; if (s.memberId) pb.clients.add(s.memberId); } }
        else if (i.kind === 'producto') { add(products, i.name, amt); if (pb) pb.products += amt; }
        else if (i.kind === 'propina') { tipsTotal += amt; if (pb) pb.tips += amt; add(tips, perBarber[i.barberId]?.name || '—', amt); }
      });
    });
    const methods = {}; sales.forEach((s) => Object.entries(methodNet(s)).forEach(([k, v]) => add(methods, k, v)));
    // Visitas (cortes realizados)
    const clients = new Set(visits.map((v) => v.clientId).filter(Boolean));
    const ticket = visits.length ? visits.reduce((a, v) => a + (v.total || 0), 0) / visits.length : 0;
    const days = []; for (let d = fromKey(from); d <= fromKey(to); d = addDays(d, 1)) days.push(dayKey(d));
    const perDay = days.map((k) => [k, visits.filter((v) => v.dayKey === k).length]);
    const incomeDay = days.map((k) => [k, sales.filter((s) => s.dayKey === k).reduce((a, s) => a + (s.received || 0), 0)]);
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    visits.forEach((v) => { const d = new Date(v.date); heat[d.getDay()][d.getHours()]++; });
    // Clientes nuevos y que volvieron
    const a = startOfDay(fromKey(from)).toISOString(); const b = endOfDay(fromKey(to)).toISOString();
    const newClients = store.clients.filter((c) => (c.createdAt || '') >= a && (c.createdAt || '') <= b);
    const newIds = new Set(newClients.map((c) => c.id));
    const returning = [...clients].filter((id) => !newIds.has(id)).length;
    const newReturned = newClients.filter((c) => (Number(c.visits) || 0) >= 2).length;
    // Citas: origen, inasistencias, cancelaciones
    const citas = appts.filter((x) => x.kind !== 'turno');
    const turnos = appts.filter((x) => x.kind === 'turno');
    const noShow = citas.filter((x) => x.status === 'no_vino').length;
    const cancel = citas.filter((x) => x.status === 'cancelada').length;
    const online = appts.filter((x) => x.source === 'online').length;
    const origin = {}; appts.forEach((x) => add(origin, x.kind === 'turno' ? 'Llegó sin cita' : x.source === 'online' ? 'Reserva en línea' : 'Agendada en el local'));
    // Ocupación de sillas: minutos atendidos / minutos disponibles de cada barbero
    appts.filter((x) => x.status === 'terminada').forEach((x) => { const pb = perBarber[x.barberId]; if (pb) pb.minutes += Number(x.minutes) || 30; });
    for (const k of days) {
      const wd = fromKey(k).getDay();
      store.settings.barbers.forEach((br) => { const h = barberHours(br, store.settings.schedule, wd); if (h) perBarber[br.id].avail += h.close - h.open - (h.breakFrom != null && h.breakTo != null ? h.breakTo - h.breakFrom : 0); });
    }
    const barbers = Object.values(perBarber).filter((x) => x.services || x.billed || x.tips).map((x) => ({ ...x, clients: x.clients.size, occ: x.avail ? Math.min(100, x.minutes / x.avail * 100) : 0 })).sort((x, y) => y.billed - x.billed);
    const occAll = (() => { const m = barbers.reduce((s, x) => s + x.minutes, 0); const av = Object.values(perBarber).reduce((s, x) => s + x.avail, 0); return av ? m / av * 100 : 0; })();
    // Gastos
    const out = moves.filter((m) => m.direction === 'out');
    const expenses = out.reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const expCat = {}; out.forEach((m) => add(expCat, m.category || 'Otros', Number(m.amount) || 0));
    return { billed, cash, cost, byKind, services, svcCount, products, tipsTotal, tips, credit, methods, clients, ticket, perDay, incomeDay, heat, newClients, returning, newReturned, citas, turnos, noShow, cancel, online, origin, barbers, occAll, expenses, expCat };
  }

  function heatHTML(heat) {
    const tot = heat.flat().reduce((a, b) => a + b, 0);
    if (!tot) return emptyState('clock', 'Sin cortes en el período');
    const hrs = []; for (let h = 0; h < 24; h++) if (heat.some((r) => r[h])) hrs.push(h);
    const h0 = Math.min(...hrs); const h1 = Math.max(...hrs);
    const max = Math.max(...heat.flat());
    const order = [1, 2, 3, 4, 5, 6, 0];
    const cols = []; for (let h = h0; h <= h1; h++) cols.push(h);
    return `<div class="dh-wrap"><table class="dh"><thead><tr><th></th>${cols.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${order.map((d) => `<tr><th>${DAYS_SHORT[d]}</th>${cols.map((h) => { const v = heat[d][h]; return `<td title="${DAYS_SHORT[d]} ${h}:00 · ${v} corte(s)" style="--a:${v ? 0.12 + (v / max) * 0.88 : 0}">${v || ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted mt-xs">Más oscuro = más clientes. Pon más barberos en las horas pico y promociones en las horas valle.</p>`;
  }

  function render() {
    const c = compute();
    const max = Math.max(1, ...c.perDay.map((x) => x[1]));
    const maxI = Math.max(1, ...c.incomeDay.map((x) => x[1]));
    const showDays = c.perDay.length <= 31;
    const nDays = Math.max(1, c.perDay.length);
    const nsRate = c.citas.length ? c.noShow / c.citas.length * 100 : 0;
    $('#r-body').innerHTML = `
      <div class="kpis">
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Facturado</span><span class="kpi-icon tone-brand">${icon('dollar')}</span></div><div class="kpi-value">${usd(c.billed)}</div><div class="kpi-sub">Cobrado ${usd(c.cash)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Cortes realizados</span><span class="kpi-icon tone-success">${icon('scissors')}</span></div><div class="kpi-value">${data.visits.length}</div><div class="kpi-sub">${num(data.visits.length / nDays, 1)} por día · ticket ${usd(c.ticket)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Clientes atendidos</span><span class="kpi-icon tone-info">${icon('users')}</span></div><div class="kpi-value">${c.clients.size}</div><div class="kpi-sub">${c.newClients.length} nuevo(s) · ${c.returning} volvieron</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ocupación de sillas</span><span class="kpi-icon tone-violet">${icon('chair')}</span></div><div class="kpi-value">${num(c.occAll, 0)}%</div><div class="kpi-sub">del tiempo disponible de los barberos</div></div>
      </div>
      <div class="kpis kpis-sm">
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Gastos</span></div><div class="kpi-value">${usd(c.expenses)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Resultado (cobrado − gastos)</span></div><div class="kpi-value ${c.cash - c.expenses < 0 ? 'text-danger' : ''}">${usd(c.cash - c.expenses)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Propinas</span></div><div class="kpi-value">${usd(c.tipsTotal)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">No vinieron</span></div><div class="kpi-value ${nsRate > 15 ? 'text-danger' : ''}">${c.noShow}</div><div class="kpi-sub">${num(nsRate, 0)}% de ${c.citas.length} cita(s) · ${c.cancel} cancelada(s)</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Reservas en línea</span></div><div class="kpi-value">${c.online}</div><div class="kpi-sub">${c.turnos.length} llegaron sin cita</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Quedó a deber</span></div><div class="kpi-value">${usd(c.credit)}</div><div class="kpi-sub">Saldos hoy ${usd(store.totalDebt)}</div></div>
      </div>
      <div class="grid-2" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><div class="card-title">${icon('scissors')} Cortes por día</div></div>
          ${showDays ? `<div class="bars">${c.perDay.map(([k, v]) => `<div class="bar" title="${fmtDate(k)}: ${v}"><i style="height:${v / max * 100}%"></i><span>${c.perDay.length > 14 ? k.slice(8) : shortDate(k)}</span></div>`).join('')}</div>` : `<p class="muted small">Total del período: ${data.visits.length}</p>`}</div>
        <div class="card"><div class="card-head"><div class="card-title">${icon('dollar')} Cobrado por día</div></div>
          ${showDays ? `<div class="bars">${c.incomeDay.map(([k, v]) => `<div class="bar" title="${fmtDate(k)}: ${usd(v)}"><i style="height:${v / maxI * 100}%"></i><span>${c.incomeDay.length > 14 ? k.slice(8) : shortDate(k)}</span></div>`).join('')}</div>` : `<p class="muted small">Total del período: ${usd(c.cash)}</p>`}</div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-title" style="margin-bottom:10px">${icon('flame')} Horas pico: cortes por día y hora</div>${heatHTML(c.heat)}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-title" style="margin-bottom:10px">${icon('users')} Rendimiento por barbero</div>${c.barbers.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Barbero</th><th class="r">Servicios</th><th class="r">Clientes</th><th class="r">Facturó</th><th class="r hide-sm">Productos</th><th class="r hide-sm">Propinas</th><th class="r">Ocupación</th></tr></thead><tbody>${c.barbers.map((b) => `<tr><td><div class="row"><span class="bdot" style="--bc:${b.color}">${esc(b.name[0])}</span><b>${esc(b.name)}</b></div></td><td class="r num">${b.services}</td><td class="r num">${b.clients}</td><td class="r num"><b>${usd(b.billed)}</b></td><td class="r num hide-sm">${usd(b.products)}</td><td class="r num hide-sm">${usd(b.tips)}</td><td class="r"><div class="hbar" style="margin:0;min-width:110px"><div class="track"><i style="width:${Math.max(2, b.occ)}%"></i></div><b class="num">${num(b.occ, 0)}%</b></div></td></tr>`).join('')}</tbody></table></div><p class="small muted mt-xs">La liquidación de cada barbero (comisiones, alquiler, adelantos) está en Barberos y pagos.</p>` : emptyState('users', 'Sin servicios en el período')}</div>
      <div class="grid-2" style="margin-bottom:16px">
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('trophy')} Servicios más pedidos</div>${hbars(top(c.svcCount, 10))}</div>
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('dollar')} Ingresos por servicio</div>${hbars(top(c.services, 10), (v) => usd(v))}</div>
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('chart')} Ingresos por tipo</div>${hbars(top(c.byKind), (v) => usd(v))}</div>
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('wallet')} Formas de pago</div>${hbars(Object.entries(c.methods).filter(([, v]) => Math.abs(v) > 0.004).map(([k, v]) => [methodLabel(k), v]).sort((a, b) => b[1] - a[1]), (v) => usd(v))}</div>
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('calendar')} ¿Cómo llegan los clientes?</div>${hbars(top(c.origin))}</div>
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('refresh')} Retención</div>
          <div class="hbar"><span>Clientes nuevos</span><div class="track"><i style="width:100%"></i></div><b class="num">${c.newClients.length}</b></div>
          <div class="hbar"><span>Volvieron una 2ª vez</span><div class="track"><i style="width:${c.newClients.length ? c.newReturned / c.newClients.length * 100 : 0}%"></i></div><b class="num">${c.newReturned}</b></div>
          <p class="small muted mt-xs">${c.newClients.length ? `${num(c.newReturned / c.newClients.length * 100, 0)}% de los nuevos ya regresó.` : ''} Los que no vuelven aparecen en Fidelizar → Les toca corte.</p></div>
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('box')} Productos más vendidos</div>${hbars(top(c.products, 10), (v) => usd(v))}<p class="small muted mt-xs">Margen de productos: ${usd(Object.values(c.products).reduce((a, b) => a + b, 0) - c.cost)}</p></div>
        <div class="card"><div class="card-title" style="margin-bottom:10px">${icon('wallet')} Gastos por categoría</div>${hbars(top(c.expCat, 10), (v) => usd(v))}</div>
      </div>`;
  }

  $('#r-from').onchange = (e) => { from = e.target.value; load(); };
  $('#r-to').onchange = (e) => { to = e.target.value; load(); };
  $('#r-csv').onclick = () => {
    if (!data) return;
    download(`reporte-sanocortes-${from}-${to}.csv`, '﻿' + toCSV([
      ['Documento', 'Tipo', 'Fecha', 'Cliente', 'Detalle', 'Barbero', 'Total', 'Cobrado', 'Pago', 'Usuario'],
      ...data.sales.map((s) => [s.number, KIND[s.kind] || s.kind, s.date.slice(0, 16).replace('T', ' '), s.memberName || '', (s.items || []).map((i) => i.name).join(' + '), store.barber(s.barberId)?.name || '', (s.total || 0).toFixed(2), (s.received || 0).toFixed(2), (s.payments || []).map((p) => methodLabel(p.method)).join(' + '), s.by || '']),
      [], ['Corte', 'Fecha', 'Cliente', 'Barbero', 'Servicios', 'Total'],
      ...data.visits.map((v) => ['', (v.date || '').slice(0, 16).replace('T', ' '), v.clientName, v.barberName, (v.services || []).join(' + '), (v.total || 0).toFixed(2)]),
      [], ['Cita', 'Fecha', 'Hora', 'Cliente', 'Barbero', 'Servicios', 'Origen', 'Estado'],
      ...data.appts.map((x) => ['', x.date, x.time, x.clientName, x.barberName, x.serviceNames, x.kind === 'turno' ? 'Sin cita' : x.source === 'online' ? 'En línea' : 'Local', x.status])
    ]), 'text/csv;charset=utf-8');
  };
  $('#r-print').onclick = () => {
    if (!data) return;
    const c = compute();
    const tbl = (rows, f = (v) => v) => `<table><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${f(v)}</td></tr>`).join('') || '<tr><td>Sin datos</td></tr>'}</tbody></table>`;
    printDoc(`Reporte del ${fmtDate(from)} al ${fmtDate(to)}`, `
      <div class="kpis"><div class="kpi">Facturado<b>${usd(c.billed)}</b></div><div class="kpi">Cobrado<b>${usd(c.cash)}</b></div><div class="kpi">Gastos<b>${usd(c.expenses)}</b></div><div class="kpi">Cortes<b>${data.visits.length}</b></div><div class="kpi">Clientes<b>${c.clients.size}</b></div><div class="kpi">Ocupación<b>${num(c.occAll, 0)}%</b></div></div>
      <h2>Barberos</h2><table><tr><th>Barbero</th><th class="r">Servicios</th><th class="r">Facturó</th><th class="r">Propinas</th><th class="r">Ocupación</th></tr>${c.barbers.map((b) => `<tr><td>${esc(b.name)}</td><td class="r">${b.services}</td><td class="r">${usd(b.billed)}</td><td class="r">${usd(b.tips)}</td><td class="r">${num(b.occ, 0)}%</td></tr>`).join('')}</table>
      <h2>Servicios</h2>${tbl(top(c.services, 20), (v) => usd(v))}
      <h2>Ingresos por tipo</h2>${tbl(top(c.byKind), (v) => usd(v))}
      <h2>Formas de pago</h2>${tbl(Object.entries(c.methods).filter(([, v]) => Math.abs(v) > 0.004).map(([k, v]) => [methodLabel(k), v]), (v) => usd(v))}
      <h2>Gastos por categoría</h2>${tbl(top(c.expCat, 20), (v) => usd(v))}
      <h2>Productos</h2>${tbl(top(c.products, 15), (v) => usd(v))}`);
  };
  setRange('30');
  return null;
}
