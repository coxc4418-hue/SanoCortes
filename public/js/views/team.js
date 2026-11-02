// SanoCortes — Barberos y pagos: equipo, horarios, esquema de pago y liquidación (comisión, alquiler de silla, sueldo, adelantos, propinas)
import { store, DAYS_SHORT } from '../store.js';
import { payroll, payBarber, listPayouts, cashMovement } from '../ops.js';
import { esc, usd, num, toast, emptyState, openModal, parseNum, round2, setBusy, todayKey, dayKey, addDays, fmtDate, fmtDateTime, confirmDialog, shortId } from '../utils.js';
import { icon } from '../icons.js';
import { requirePin } from '../auth.js';
import { printDoc } from '../shared.js';
import { BARBER_COLORS, PAY_MODES } from '../barber.js';

/** Días de trabajo en texto corto: "Todos los días", "Lun a Sáb" o la lista */
function daysText(days) {
  const d = [...new Set(days || [])].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
  if (d.length === 7) return 'Todos los días';
  const order = d.map((x) => (x + 6) % 7);
  if (d.length >= 3 && order.every((v, i) => i === 0 || v === order[i - 1] + 1)) return `${DAYS_SHORT[d[0]]} a ${DAYS_SHORT[d[d.length - 1]]}`;
  return d.map((x) => DAYS_SHORT[x]).join(' ') || '—';
}

const weekStart = () => { const d = new Date(); const wd = (d.getDay() + 6) % 7; return dayKey(addDays(d, -wd)); };
const PERIODS = {
  semana: ['Esta semana', () => [weekStart(), todayKey()]],
  pasada: ['Semana pasada', () => { const s = dayKey(addDays(new Date(weekStart() + 'T12:00'), -7)); return [s, dayKey(addDays(new Date(s + 'T12:00'), 6))]; }],
  quincena: ['Esta quincena', () => { const d = new Date(); const s = d.getDate() <= 15 ? 1 : 16; return [dayKey(new Date(d.getFullYear(), d.getMonth(), s)), todayKey()]; }],
  mes: ['Este mes', () => { const d = new Date(); return [dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), todayKey()]; }]
};

export function mount(el) {
  let tab = 'equipo'; let period = 'semana'; let range = PERIODS.semana[1](); let data = null; let loading = false;
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Barberos y pagos</h1><p class="view-sub">Tu equipo, sus horarios y cuánto le toca a cada uno, sin sacar cuentas a mano.</p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="t-adv">${icon('wallet')} Adelanto</button><button class="btn btn-primary" id="t-new">${icon('userPlus')} Nuevo barbero</button></div></div>
    <div class="tabs" id="t-tabs"></div><div id="t-body" class="mt-md"></div>`;
  const $ = (s) => el.querySelector(s);

  function tabs() {
    $('#t-tabs').innerHTML = [['equipo', 'Equipo', 'users'], ['pagos', 'Liquidación', 'cash'], ['historial', 'Pagos hechos', 'history']].map(([k, l, ic]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${icon(ic)} ${l}</button>`).join('');
    el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(); });
  }

  function draw() {
    tabs();
    if (tab === 'equipo') return drawTeam();
    if (tab === 'pagos') return drawPayroll();
    return drawHistory();
  }

  // ---------- Equipo ----------
  function drawTeam() {
    const all = store.settings.barbers;
    const today = new Date().getDay();
    $('#t-body').innerHTML = all.length ? `<div class="team-grid">${all.map((b) => {
      const appts = store.apptsFor(b.id, todayKey()).length;
      return `<div class="card team-card ${b.active === false ? 'is-off' : ''}" style="--bc:${b.color}">
        <div class="row" style="gap:10px"><span class="bdot bdot-lg">${esc(b.name[0])}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(b.name)}</b><div class="t-sub">${esc(b.specialty || PAY_MODES[b.mode || 'comision'].label)}</div></div>${b.active === false ? '<span class="badge badge-neutral">inactivo</span>' : ''}</div>
        <div class="team-meta">
          <div><span class="muted">Pago</span><b>${b.mode === 'alquiler' ? `Alquiler ${usd(b.rent || 0)}/sem` : b.mode === 'sueldo' ? `${usd(b.salary || 0)}/sem + ${b.commission || 0} %` : `${b.commission || 0} % servicios`}</b></div>
          <div><span class="muted">Productos</span><b>${b.productCommission || 0} %</b></div>
          <div><span class="muted">Días</span><b>${daysText(b.days?.length ? b.days : store.settings.schedule.days)}</b></div>
          <div><span class="muted">Horario</span><b>${esc(b.from || store.settings.schedule.open)}–${esc(b.to || store.settings.schedule.close)}${b.breakFrom ? ` · descanso ${esc(b.breakFrom)}` : ''}</b></div>
        </div>
        <div class="row small" style="gap:6px;flex-wrap:wrap">${b.online !== false ? `<span class="badge badge-info">${icon('globe')} reservas en línea</span>` : ''}${b.walkins !== false ? `<span class="badge badge-neutral">${icon('chair')} sin cita</span>` : ''}${b.active !== false && (b.days?.length ? b.days : store.settings.schedule.days).includes(today) ? `<span class="badge badge-success">hoy · ${appts} cita(s)</span>` : ''}</div>
        <div class="row" style="gap:6px"><button class="btn btn-secondary btn-sm grow" data-edit="${b.id}">${icon('edit')} Editar</button>${b.phone ? `<a class="btn btn-whatsapp btn-icon btn-sm" href="https://wa.me/${String(b.phone).replace(/\D/g, '')}" target="_blank" rel="noopener">${icon('whatsapp')}</a>` : ''}</div>
      </div>`;
    }).join('')}</div>` : `<div class="card">${emptyState('scissors', 'Aún no hay barberos', 'Agrega a tu equipo: cada barbero tiene su agenda, su color y su forma de pago.')}</div>`;
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => barberForm(store.barber(b.dataset.edit)));
  }

  // ---------- Liquidación ----------
  async function load() {
    loading = true; drawPayroll();
    try { data = await payroll(range[0], range[1]); } catch (e) { console.error(e); toast('No se pudo calcular la liquidación: ' + e.message, 'danger'); data = []; }
    loading = false; if (tab === 'pagos') drawPayroll();
  }
  function drawPayroll() {
    const body = $('#t-body');
    if (!data && !loading) { load(); return; }
    const tot = (k) => round2((data || []).reduce((a, r) => a + (r[k] || 0), 0));
    body.innerHTML = `<div class="card"><div class="between" style="flex-wrap:wrap;gap:8px"><div class="chips">${Object.entries(PERIODS).map(([k, [l]]) => `<button class="chip ${period === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><input type="date" class="input input-sm" id="p-from" value="${range[0]}" style="width:auto"><span class="muted">al</span><input type="date" class="input input-sm" id="p-to" value="${range[1]}" style="width:auto"><button class="btn btn-secondary btn-sm" id="p-print" ${!data?.length ? 'disabled' : ''}>${icon('print')} Imprimir</button></div></div>
      ${loading ? '<div class="skeleton" style="height:180px;margin-top:14px"></div>' : !data.length ? emptyState('cash', 'Sin movimientos', 'No hay servicios cobrados en este período.') : `
      <div class="kpis mt-md">
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Servicios</span><span class="kpi-icon tone-brand">${icon('scissors')}</span></div><div class="kpi-value">${tot('services')}</div><div class="kpi-sub">${usd(tot('gross'))} facturado</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ganado por barberos</span><span class="kpi-icon tone-warning">${icon('users')}</span></div><div class="kpi-value">${usd(tot('earned'))}</div><div class="kpi-sub">incluye ${usd(tot('tips'))} de propinas</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Queda para la barbería</span><span class="kpi-icon tone-success">${icon('building')}</span></div><div class="kpi-value">${usd(tot('shop'))}</div><div class="kpi-sub">servicios + productos + alquiler</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Por pagar</span><span class="kpi-icon tone-danger">${icon('wallet')}</span></div><div class="kpi-value">${usd(round2(data.filter((r) => r.net > 0).reduce((a, r) => a + r.net, 0)))}</div><div class="kpi-sub">${usd(tot('paid'))} ya pagado</div></div>
      </div>
      <div class="table-wrap mt-md"><table class="table table-cards"><thead><tr><th>Barbero</th><th class="r">Servicios</th><th class="r hide-sm">Facturó</th><th class="r">Comisión</th><th class="r hide-sm">Productos</th><th class="r hide-sm">Propinas</th><th class="r hide-sm">Sueldo / alquiler</th><th class="r hide-sm">Adelantos</th><th class="r">Saldo</th><th></th></tr></thead><tbody>
        ${data.map((r) => `<tr><td><div class="row"><span class="bdot" style="--bc:${r.barber.color}">${esc(r.barber.name[0])}</span><div><b>${esc(r.barber.name)}</b><div class="t-sub">${esc(PAY_MODES[r.barber.mode || 'comision'].label)} · ${r.clients} cliente(s)</div></div></div></td>
          <td class="r num">${r.services}${r.club ? `<div class="t-sub">${r.club} club/premio</div>` : ''}</td><td class="r num hide-sm">${usd(r.gross)}</td><td class="r num">${usd(r.serviceComm)}</td><td class="r num hide-sm">${usd(r.productComm)}</td><td class="r num hide-sm">${usd(r.tips)}</td>
          <td class="r num hide-sm">${r.salary ? '+' + usd(r.salary) : r.rent ? `<span class="text-danger">−${usd(r.rent)}</span>` : '—'}</td><td class="r num hide-sm">${r.advances ? `<span class="text-danger">−${usd(r.advances)}</span>` : '—'}${r.paid ? `<div class="t-sub">pagado ${usd(r.paid)}</div>` : ''}</td>
          <td class="r num"><b class="${r.net < 0 ? 'text-danger' : r.net > 0 ? 'text-success' : ''}">${usd(Math.abs(r.net))}</b><div class="t-sub">${r.net > 0.009 ? 'le debes' : r.net < -0.009 ? 'te debe' : 'al día'}</div></td>
          <td class="r"><div class="row" style="gap:4px;justify-content:flex-end"><button class="btn btn-ghost btn-icon btn-sm" data-pr="${r.barber.id}" title="Imprimir comprobante">${icon('print')}</button>${r.net > 0.009 ? `<button class="btn btn-primary btn-sm" data-pay="${r.barber.id}">${icon('cash')} Pagar</button>` : r.net < -0.009 ? `<button class="btn btn-secondary btn-sm" data-col="${r.barber.id}">${icon('download')} Cobrar</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted mt-sm">Los servicios del club y los premios se le pagan al barbero sobre el precio normal. Los adelantos se registran en Caja (categoría “Adelanto a barbero”) o con el botón Adelanto.</p>`}</div>`;
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { period = b.dataset.p; range = PERIODS[period][1](); data = null; load(); });
    const setRange = () => { const f = $('#p-from').value; const t = $('#p-to').value; if (f && t && f <= t) { period = ''; range = [f, t]; data = null; load(); } };
    $('#p-from').onchange = setRange; $('#p-to').onchange = setRange;
    if ($('#p-print')) $('#p-print').onclick = () => printAll();
    el.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => payModal(data.find((r) => r.barber.id === b.dataset.pay)));
    el.querySelectorAll('[data-col]').forEach((b) => b.onclick = () => collectRent(data.find((r) => r.barber.id === b.dataset.col)));
    el.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => printOne(data.find((r) => r.barber.id === b.dataset.pr)));
  }

  function payModal(r) {
    const m = openModal({
      title: `Pagar a ${esc(r.barber.name)}`, sub: `${fmtDate(range[0])} al ${fmtDate(range[1])}`, size: 'sm',
      body: `<div class="stack"><div class="box small"><div class="between"><span>Comisión servicios</span><b>${usd(r.serviceComm)}</b></div><div class="between"><span>Comisión productos</span><b>${usd(r.productComm)}</b></div><div class="between"><span>Propinas</span><b>${usd(r.tips)}</b></div>${r.salary ? `<div class="between"><span>Sueldo</span><b>${usd(r.salary)}</b></div>` : ''}${r.rent ? `<div class="between"><span>Alquiler de silla</span><b class="text-danger">−${usd(r.rent)}</b></div>` : ''}${r.advances ? `<div class="between"><span>Adelantos</span><b class="text-danger">−${usd(r.advances)}</b></div>` : ''}${r.paid ? `<div class="between"><span>Ya pagado</span><b class="text-danger">−${usd(r.paid)}</b></div>` : ''}<hr><div class="between"><b>A pagar</b><b>${usd(r.net)}</b></div></div>
        <div class="field"><label>Monto</label><input class="input" inputmode="decimal" data-amt value="${num(r.net)}"></div>
        <div class="field"><label>Forma de pago</label><select class="select" data-m><option value="efectivo">Efectivo (sale de la caja)</option><option value="transferencia">Transferencia</option><option value="pago_movil">Pago móvil</option><option value="otro">Otro</option></select></div>
        <div class="field"><label>Nota</label><input class="input" data-note placeholder="Opcional"></div><div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Registrar pago</button>`
    });
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      if (!(await requirePin('Pagar a un barbero'))) return;
      setBusy(e.currentTarget, true);
      try {
        const out = await payBarber({ barber: r.barber, from: range[0], to: range[1], amount: parseNum(m.el.querySelector('[data-amt]').value), method: m.el.querySelector('[data-m]').value, note: m.el.querySelector('[data-note]').value.trim(), summary: { services: r.services, gross: r.gross, serviceComm: r.serviceComm, productComm: r.productComm, tips: r.tips, salary: r.salary, rent: r.rent, advances: r.advances } });
        m.close(); toast(`Pago ${out.number} registrado`); printOne(r, out.number); data = null; load();
      } catch (err) { m.el.querySelector('[data-err]').textContent = err.message; setBusy(e.currentTarget, false); }
    };
  }

  async function collectRent(r) {
    const ok = await confirmDialog({ title: `Cobrar a ${esc(r.barber.name)}`, message: `El barbero le debe a la barbería ${usd(-r.net)} (alquiler de silla / adelantos). ¿Registrar el ingreso en la caja?`, confirmText: 'Registrar ingreso' });
    if (!ok) return;
    try { await cashMovement({ direction: 'in', currency: 'USD', amount: round2(-r.net), concept: `Alquiler de silla ${r.barber.name} (${fmtDate(range[0])} al ${fmtDate(range[1])})`, category: 'Alquiler de silla (pago del barbero)', barberId: r.barber.id }); toast('Ingreso registrado en la caja'); } catch (e) { toast(e.message, 'danger'); }
  }

  const rowHTML = (r) => `<tr><td>${esc(r.barber.name)}</td><td class="r">${r.services}</td><td class="r">${usd(r.gross)}</td><td class="r">${usd(r.serviceComm)}</td><td class="r">${usd(r.productComm)}</td><td class="r">${usd(r.tips)}</td><td class="r">${r.salary ? usd(r.salary) : r.rent ? '−' + usd(r.rent) : '—'}</td><td class="r">${r.advances ? '−' + usd(r.advances) : '—'}</td><td class="r">${r.paid ? '−' + usd(r.paid) : '—'}</td><td class="r"><b>${usd(r.net)}</b></td></tr>`;
  const HEAD = '<tr><th>Barbero</th><th class="r">Servicios</th><th class="r">Facturó</th><th class="r">Com. servicios</th><th class="r">Com. productos</th><th class="r">Propinas</th><th class="r">Sueldo/Alquiler</th><th class="r">Adelantos</th><th class="r">Pagado</th><th class="r">Saldo</th></tr>';
  function printAll() { printDoc(`Liquidación de barberos · ${fmtDate(range[0])} al ${fmtDate(range[1])}`, `<table>${HEAD}${data.map(rowHTML).join('')}</table>`); }
  function printOne(r, number = '') {
    printDoc(`Comprobante de pago${number ? ' ' + number : ''} · ${r.barber.name}`, `<p>Período: <b>${fmtDate(range[0])} al ${fmtDate(range[1])}</b> · Esquema: ${esc(PAY_MODES[r.barber.mode || 'comision'].label)}</p><table>${HEAD}${rowHTML(r)}</table>
      ${r.advList.length ? `<h2>Adelantos</h2><table><tr><th>Fecha</th><th>Concepto</th><th class="r">Monto</th></tr>${r.advList.map((a) => `<tr><td>${fmtDateTime(a.date)}</td><td>${esc(a.concept || '')}</td><td class="r">${usd(a.amount)}</td></tr>`).join('')}</table>` : ''}
      <div class="sign"><div>Entregado por</div><div>Recibido conforme · ${esc(r.barber.name)}</div></div>`);
  }

  // ---------- Historial de pagos ----------
  async function drawHistory() {
    $('#t-body').innerHTML = '<div class="card"><div class="skeleton" style="height:160px"></div></div>';
    let list = [];
    try { list = await listPayouts(60); } catch (e) { console.error(e); }
    if (tab !== 'historial') return;
    $('#t-body').innerHTML = `<div class="card card-flush">${list.length ? `<div class="table-wrap"><table class="table table-cards"><thead><tr><th>N°</th><th>Barbero</th><th class="hide-sm">Período</th><th class="hide-sm">Forma</th><th class="r">Monto</th><th class="hide-sm">Fecha</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><b>${esc(p.number)}</b></td><td>${esc(p.barberName)}</td><td class="hide-sm small">${fmtDate(p.from)} al ${fmtDate(p.to)}</td><td class="hide-sm small">${esc(p.method)}</td><td class="r num"><b>${usd(p.amount)}</b></td><td class="hide-sm small">${fmtDateTime(p.date)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div style="padding:16px">${emptyState('history', 'Aún no hay pagos registrados', 'Cuando liquides a un barbero, el comprobante queda aquí.')}</div>`}</div>`;
  }

  // ---------- Adelanto ----------
  function advanceModal() {
    if (!store.activeBarbers.length) return toast('Primero agrega barberos', 'warning');
    const m = openModal({
      title: 'Adelanto a barbero', sub: 'Sale de la caja y se descuenta en su próxima liquidación', size: 'sm',
      body: `<div class="stack"><div class="field"><label>Barbero</label><select class="select" data-b>${store.activeBarbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Monto</label><input class="input" inputmode="decimal" data-amt></div><div class="field"><label>Motivo</label><input class="input" data-c placeholder="Opcional"></div><div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Registrar</button>`
    });
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      const amt = round2(parseNum(m.el.querySelector('[data-amt]').value) || 0);
      if (!(amt > 0)) { m.el.querySelector('[data-err]').textContent = 'Indica el monto.'; return; }
      if (!(await requirePin('Adelanto a barbero'))) return;
      const b = store.barber(m.el.querySelector('[data-b]').value);
      setBusy(e.currentTarget, true);
      try { await cashMovement({ direction: 'out', currency: 'USD', amount: amt, concept: `Adelanto a ${b.name}${m.el.querySelector('[data-c]').value.trim() ? ' · ' + m.el.querySelector('[data-c]').value.trim() : ''}`, category: 'Adelanto a barbero', barberId: b.id }); m.close(); toast('Adelanto registrado'); data = null; if (tab === 'pagos') load(); }
      catch (err) { m.el.querySelector('[data-err]').textContent = err.message; setBusy(e.currentTarget, false); }
    };
  }

  $('#t-new').onclick = () => barberForm();
  $('#t-adv').onclick = advanceModal;
  draw();
  return store.on('settings', () => { if (tab === 'equipo') drawTeam(); });
}

/** Alta / edición de un barbero (vive dentro de los ajustes de la sede) */
export function barberForm(b0 = null) {
  const used = store.settings.barbers.map((x) => x.color);
  const b = { id: '', name: '', phone: '', specialty: '', color: BARBER_COLORS.find((c) => !used.includes(c)) || BARBER_COLORS[0], mode: 'comision', commission: 50, productCommission: 10, rent: 0, salary: 0, days: [...store.settings.schedule.days], from: '', to: '', breakFrom: '', breakTo: '', online: true, walkins: true, active: true, ...(b0 || {}) };
  return new Promise((resolve) => {
    let out = null;
    const m = openModal({
      title: b0 ? 'Editar barbero' : 'Nuevo barbero', size: 'lg',
      body: `<div class="stack">
        <div class="form-grid"><div class="field"><label>Nombre</label><input class="input" data-k="name" value="${esc(b.name)}" placeholder="Ej.: Carlos “El Maestro”"></div>
          <div class="field"><label>Teléfono / WhatsApp</label><input class="input" data-k="phone" value="${esc(b.phone)}" inputmode="tel"></div>
          <div class="field"><label>Especialidad (se ve en la reserva)</label><input class="input" data-k="specialty" value="${esc(b.specialty)}" placeholder="Ej.: Fades y diseños"></div>
          <div class="field"><label>Color en la agenda</label><div class="row" style="gap:6px;flex-wrap:wrap" data-colors>${BARBER_COLORS.map((c) => `<button type="button" class="color-dot ${b.color === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div></div>
        <div class="field"><label>¿Cómo se le paga?</label><div class="chips" data-modes>${Object.entries(PAY_MODES).map(([k, v]) => `<button type="button" class="chip ${b.mode === k ? 'on' : ''}" data-mode="${k}">${v.label}</button>`).join('')}</div><span class="hint" data-mhint></span></div>
        <div class="form-grid">
          <div class="field" data-show="comision sueldo"><label>% por servicio</label><input class="input" data-k="commission" inputmode="decimal" value="${num(b.commission, 0)}"></div>
          <div class="field" data-show="sueldo"><label>Sueldo semanal</label><input class="input" data-k="salary" inputmode="decimal" value="${num(b.salary)}"></div>
          <div class="field" data-show="alquiler"><label>Alquiler de silla por semana</label><input class="input" data-k="rent" inputmode="decimal" value="${num(b.rent)}"></div>
          <div class="field"><label>% por producto vendido</label><input class="input" data-k="productCommission" inputmode="decimal" value="${num(b.productCommission, 0)}"></div>
        </div>
        <div class="field"><label>Días que trabaja</label><div class="chips" data-days>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="chip ${b.days.includes(d) ? 'on' : ''}" data-d="${d}">${DAYS_SHORT[d]}</button>`).join('')}</div></div>
        <div class="form-grid">
          <div class="field"><label>Entra</label><input type="time" class="input" data-k="from" value="${esc(b.from)}"><span class="hint">Vacío = abre la barbería</span></div>
          <div class="field"><label>Sale</label><input type="time" class="input" data-k="to" value="${esc(b.to)}"><span class="hint">Vacío = cierra la barbería</span></div>
          <div class="field"><label>Descanso desde</label><input type="time" class="input" data-k="breakFrom" value="${esc(b.breakFrom)}"></div>
          <div class="field"><label>Descanso hasta</label><input type="time" class="input" data-k="breakTo" value="${esc(b.breakTo)}"></div>
        </div>
        <div class="row" style="gap:16px;flex-wrap:wrap"><label class="check"><input type="checkbox" data-b="online" ${b.online !== false ? 'checked' : ''}> Aparece en la reserva en línea</label><label class="check"><input type="checkbox" data-b="walkins" ${b.walkins !== false ? 'checked' : ''}> Atiende clientes sin cita</label>${b0 ? `<label class="check"><input type="checkbox" data-b="active" ${b.active !== false ? 'checked' : ''}> Activo</label>` : ''}</div>
        <div class="error-msg" data-err></div></div>`,
      footer: `${b0 ? `<button class="btn btn-ghost text-danger" data-del style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`,
      onClose: () => resolve(out)
    });
    const q = (s) => m.el.querySelector(s);
    const modeUI = () => {
      m.el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === b.mode));
      m.el.querySelectorAll('[data-show]').forEach((x) => { x.style.display = x.dataset.show.split(' ').includes(b.mode) ? '' : 'none'; });
      q('[data-mhint]').textContent = PAY_MODES[b.mode].hint;
    };
    m.el.querySelectorAll('[data-mode]').forEach((x) => x.onclick = () => { b.mode = x.dataset.mode; modeUI(); });
    m.el.querySelectorAll('[data-c]').forEach((x) => x.onclick = () => { b.color = x.dataset.c; m.el.querySelectorAll('[data-c]').forEach((y) => y.classList.toggle('on', y === x)); });
    m.el.querySelectorAll('[data-d]').forEach((x) => x.onclick = () => { const d = +x.dataset.d; b.days = b.days.includes(d) ? b.days.filter((y) => y !== d) : [...b.days, d]; x.classList.toggle('on'); });
    modeUI();
    const del = q('[data-del]');
    if (del) del.onclick = async () => {
      const ok = await confirmDialog({ title: 'Eliminar barbero', message: `¿Eliminar a ${esc(b.name)}? Su historial de ventas se conserva. Si solo dejó de trabajar, mejor desmarca “Activo”.`, confirmText: 'Eliminar', danger: true });
      if (!ok || !(await requirePin('Eliminar barbero'))) return;
      await store.saveSettings({ barbers: store.settings.barbers.filter((x) => x.id !== b.id) });
      toast('Barbero eliminado'); m.close();
    };
    q('[data-ok]').onclick = async (e) => {
      m.el.querySelectorAll('[data-k]').forEach((i) => { const k = i.dataset.k; b[k] = ['commission', 'productCommission', 'rent', 'salary'].includes(k) ? round2(parseNum(i.value) || 0) : i.value.trim(); });
      m.el.querySelectorAll('[data-b]').forEach((i) => { b[i.dataset.b] = i.checked; });
      if (!b.name) { q('[data-err]').textContent = 'Escribe el nombre.'; return; }
      if (b.commission > 100 || b.productCommission > 100) { q('[data-err]').textContent = 'Los porcentajes van de 0 a 100.'; return; }
      if (!b.days.length) { q('[data-err]').textContent = 'Elige al menos un día de trabajo.'; return; }
      if ((b.breakFrom && !b.breakTo) || (!b.breakFrom && b.breakTo)) { q('[data-err]').textContent = 'Completa el descanso (desde y hasta) o déjalo vacío.'; return; }
      setBusy(e.currentTarget, true);
      const list = [...store.settings.barbers];
      if (b0) list[list.findIndex((x) => x.id === b0.id)] = b; else { b.id = 'b' + shortId(6); list.push(b); }
      await store.saveSettings({ barbers: list });
      out = b; toast(b0 ? 'Barbero actualizado' : `${b.name} agregado al equipo`); m.close();
    };
  });
}
