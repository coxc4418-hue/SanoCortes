// SanoCortes — Inicio: el día de la barbería de un vistazo
import { store, apptBadge } from '../store.js';
import { esc, usd, fmtLongDate, todayKey, emptyState, fmtAgo, fmtDate, shortDate } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, hydratePhotos, openClient } from '../client.js';
import { walkinForm, apptForm, openAppt, requestModal, waitText } from '../appt.js';
import { waClient } from '../shared.js';
import { minToTime, nowMin, barberHours } from '../barber.js';

export function mount(el, { navigate }) {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">${hello} ${h < 12 ? '☀️' : h < 19 ? '💈' : '🌙'}</h1><p class="view-sub">${fmtLongDate()} · ${esc(store.businessName)}</p></div>
      <div class="view-actions" data-tour="quick">
        <button class="btn btn-success" data-q="walk">${icon('chair')} Llegó sin cita</button>
        <button class="btn btn-secondary" data-q="appt">${icon('calendar')} Agendar cita</button>
        <button class="btn btn-primary" data-q="pay">${icon('cart')} Cobrar</button>
      </div></div>
    <div id="d-req"></div>
    <div class="kpis" data-tour="kpis" id="d-kpis"></div>
    <div class="card" data-tour="board"><div class="card-head"><div class="card-title">${icon('scissors')} Los barberos ahora</div><button class="btn btn-ghost btn-sm" data-go="turnos">Sala de espera</button></div><div class="bboard" id="d-board"></div></div>
    <div class="grid-2 mt-lg">
      <div class="card card-flush" data-tour="next"><div class="card-head" style="padding:16px 18px 0"><div class="card-title">${icon('calendar')} Próximas citas de hoy</div><button class="btn btn-ghost btn-sm" data-go="agenda">Agenda</button></div><div id="d-next"></div></div>
      <div class="card" data-tour="follow"><div class="card-head"><div class="card-title">${icon('heart')} Para escribir hoy</div><button class="btn btn-ghost btn-sm" data-go="fidelizar">Ver todo</button></div><div id="d-follow"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => navigate(b.dataset.go));
  $('[data-q="walk"]').onclick = () => walkinForm();
  $('[data-q="appt"]').onclick = () => apptForm();
  $('[data-q="pay"]').onclick = () => navigate('cobrar');

  function requests() {
    const list = store.pendingRequests;
    $('#d-req').innerHTML = list.length ? `<div class="banner req-banner"><span>${icon('globe')} <b>${list.length} reserva(s) en línea</b> por confirmar: ${list.slice(0, 3).map((r) => `${esc(r.name.split(' ')[0])} (${shortDate(r.date)} ${esc(r.time)})`).join(', ')}</span><button class="btn btn-sm btn-primary" id="d-req-go">Revisar</button></div>` : '';
    $('#d-req-go')?.addEventListener('click', () => requestModal(list[0]));
  }

  function kpis() {
    const t = todayKey();
    const appts = store.todayAppts.filter((a) => !['cancelada'].includes(a.status));
    const done = appts.filter((a) => a.status === 'terminada').length;
    const noShow = appts.filter((a) => a.status === 'no_vino').length;
    const online = appts.filter((a) => a.source === 'online').length;
    const sales = store.recentSales.filter((s) => s.dayKey === t && s.status !== 'voided');
    const cash = sales.reduce((a, s) => a + (s.received || 0), 0);
    const svcSales = sales.filter((s) => s.kind === 'servicio');
    const avg = svcSales.length ? svcSales.reduce((a, s) => a + s.total, 0) / svcSales.length : 0;
    const tips = sales.reduce((a, s) => a + (s.items || []).filter((i) => i.kind === 'propina').reduce((x, i) => x + i.price * i.qty, 0), 0);
    const due = store.dueClients.length;
    $('#d-kpis').innerHTML = `
      <div class="card kpi kpi-link" data-go2="agenda"><div class="kpi-top"><span class="kpi-label">Citas hoy</span><span class="kpi-icon tone-brand">${icon('calendar')}</span></div><div class="kpi-value">${appts.filter((a) => a.kind !== 'turno').length}</div><div class="kpi-sub">${done} atendido(s)${online ? ` · ${online} en línea` : ''}${noShow ? ` · <span class="text-danger">${noShow} no vino</span>` : ''}</div></div>
      <div class="card kpi kpi-link" data-go2="turnos"><div class="kpi-top"><span class="kpi-label">En silla / esperando</span><span class="kpi-icon tone-violet">${icon('chair')}</span></div><div class="kpi-value">${store.inChair.length}<small> / ${store.waiting.length}</small></div><div class="kpi-sub">${store.waiting.length ? `el primero espera ${fmtAgo(store.waiting[0].arrivedAt).replace('hace ', '')}` : 'sala de espera vacía'}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Cobrado hoy</span><span class="kpi-icon tone-success">${icon('dollar')}</span></div><div class="kpi-value">${usd(cash)}</div><div class="kpi-sub">${sales.length} cobro(s)${tips ? ` · ${usd(tips)} en propinas` : ''}${store.openShift ? '' : ' · <span class="text-warning">caja cerrada</span>'}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ticket promedio</span><span class="kpi-icon tone-info">${icon('receipt')}</span></div><div class="kpi-value">${usd(avg)}</div><div class="kpi-sub">por cliente atendido</div></div>
      <div class="card kpi kpi-link" data-go2="fidelizar"><div class="kpi-top"><span class="kpi-label">Les toca corte</span><span class="kpi-icon tone-warning">${icon('refresh')}</span></div><div class="kpi-value">${due}</div><div class="kpi-sub">sin cita · escríbeles hoy</div></div>`;
    el.querySelectorAll('[data-go2]').forEach((b) => b.onclick = () => navigate(b.dataset.go2));
  }

  function board() {
    const est = store.waitEstimate();
    const t = todayKey(); const nm = nowMin(); const wd = new Date().getDay();
    const sales = store.recentSales.filter((s) => s.dayKey === t && s.status !== 'voided');
    $('#d-board').innerHTML = store.activeBarbers.length ? store.activeBarbers.map((b) => {
      const e = est[b.id];
      const hrs = barberHours(b, store.settings.schedule, wd);
      const chair = store.inChair.find((a) => a.barberId === b.id);
      const next = store.upcomingToday.find((a) => a.barberId === b.id);
      const queue = store.waiting.filter((a) => a.barberId === b.id);
      const doneN = store.todayAppts.filter((a) => a.barberId === b.id && a.status === 'terminada').length;
      const earned = sales.reduce((a, s) => a + (s.items || []).filter((i) => i.barberId === b.id && i.kind === 'servicio').reduce((x, i) => x + i.price * i.qty, 0), 0);
      const off = !hrs || nm >= hrs.close || nm < hrs.open - 30;
      const left = chair ? Math.max(0, (chair.startedMin ?? nm) + (chair.minutes || 30) - nm) : 0;
      return `<div class="bcard ${chair ? 'busy' : off ? 'off' : 'free'}" style="--bc:${b.color || 'var(--brand)'}">
        <div class="bcard-top"><span class="bdot">${esc(b.name[0])}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(b.name)}</b><div class="t-sub">${off ? (hrs ? `Turno ${minToTime(hrs.open)}–${minToTime(hrs.close)}` : 'Hoy no trabaja') : chair ? 'Atendiendo' : 'Libre ahora'}</div></div><span class="bstate"></span></div>
        ${chair ? `<button class="bcard-now" data-a="${chair.id}"><b>${esc(chair.clientName)}</b><span>${esc(chair.serviceNames)} · ${left ? `termina en ~${left} min` : 'por terminar'}</span></button>` : ''}
        <div class="bcard-foot"><span>${icon('clock')} ${e ? (e.wait ? `libre en ${waitText(e.wait)}` : 'disponible') : '—'}</span><span>${queue.length ? `${queue.length} en fila` : ''}</span></div>
        ${next ? `<button class="bcard-next" data-a="${next.id}">Sigue: <b>${esc(next.time)} ${esc(next.clientName.split(' ')[0])}</b></button>` : ''}
        <div class="bcard-stats"><span><b>${doneN}</b> atendidos</span><span><b>${usd(earned)}</b> en servicios</span></div>
      </div>`;
    }).join('') : emptyState('scissors', 'Agrega a tus barberos', 'Ve a Barberos y pagos para registrarlos con su horario y comisión.');
    el.querySelectorAll('#d-board [data-a]').forEach((b) => b.onclick = () => { const a = store.appointments.find((x) => x.id === b.dataset.a); if (a) openAppt(a); });
  }

  function next() {
    const list = store.upcomingToday.slice(0, 8);
    const nm = nowMin();
    $('#d-next').innerHTML = list.length ? `<div class="list" style="padding:6px 10px 10px">${list.map((a) => {
      const c = store.client(a.clientId);
      const late = nm > a.start + 5;
      return `<div class="list-item"><span class="appt-time" style="--bc:${a.barberColor || 'var(--brand)'}">${esc(a.time)}</span><button class="grow linkish" style="min-width:0;text-align:left" data-a="${a.id}"><b class="ellipsis">${esc(a.clientName)}</b><div class="t-sub">${esc(a.serviceNames)} · ${esc(a.barberName)}${late ? ' · <span class="text-danger">retrasado</span>' : ''}</div></button>${apptBadge(a.status)}${(c?.phone || a.clientPhone) && !a.remindedAt ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-rem="${a.id}" title="Recordar por WhatsApp">${icon('whatsapp')}</button>` : ''}</div>`;
    }).join('')}</div>` : `<div style="padding:12px">${emptyState('calendar', 'No quedan citas hoy', 'Comparte tu enlace de reservas para llenar la agenda.')}</div>`;
    el.querySelectorAll('#d-next [data-a]').forEach((b) => b.onclick = () => openAppt(store.appointments.find((x) => x.id === b.dataset.a)));
    el.querySelectorAll('#d-next [data-rem]').forEach((b) => b.onclick = async () => {
      const a = store.appointments.find((x) => x.id === b.dataset.rem);
      waClient('recordatorio', { appt: a, client: store.client(a.clientId) || {} });
      const { markReminded } = await import('../ops.js'); markReminded(a);
    });
  }

  function follow() {
    const bdays = store.birthdaysToday;
    const due = store.dueClients.slice(0, 5);
    const club = store.clubExpiring(5).slice(0, 3);
    const row = (c, sub, kind, extra = '') => `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${sub}</div></div><button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${c.id}" data-k="${kind}" data-x="${extra}" title="WhatsApp">${icon('whatsapp')}</button></div>`;
    $('#d-follow').innerHTML = `
      <div class="follow-sums"><div><b>${store.dueClients.length}</b><span>les toca</span></div><div><b>${store.lostClients.length}</b><span>perdidos</span></div><div><b>${store.clubExpiring(5).length}</b><span>club por vencer</span></div><div><b>${store.birthdaysWithin(7).length}</b><span>cumpleaños (7 d)</span></div></div>
      ${bdays.length ? `<div class="section-title mt">${icon('cake')} Cumpleaños hoy</div><div class="list">${bdays.map((c) => row(c, 'Felicítalo con un regalo', 'cumple')).join('')}</div>` : ''}
      ${due.length ? `<div class="section-title mt">${icon('scissors')} Les toca corte</div><div class="list">${due.map((c) => { const d = store.daysSince(c); return row(c, `hace ${d} días · suele venir cada ${store.cycleOf(c)}`, 'le_toca', Math.max(1, Math.round(d / 7))); }).join('')}</div>` : ''}
      ${club.length ? `<div class="section-title mt">${icon('crown')} Club por vencer</div><div class="list">${club.map((c) => row(c, `${esc(c.membership.name)} · ${c._expired ? 'vencido' : 'vence ' + fmtDate(c.membership.end)}`, 'club')).join('')}</div>` : ''}
      ${!due.length && !bdays.length && !club.length ? emptyState('checkCircle', 'Todo al día', 'Ningún cliente atrasado.') : ''}`;
    el.querySelectorAll('#d-follow [data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('#d-follow [data-wa]').forEach((b) => b.onclick = () => waClient(b.dataset.k, { client: store.client(b.dataset.wa), extra: b.dataset.x }));
    hydratePhotos($('#d-follow'), 12);
  }

  const all = () => { requests(); kpis(); board(); next(); follow(); };
  all();
  const tick = setInterval(() => { kpis(); board(); next(); }, 30000);
  const off = store.on('*', (evt) => {
    if (evt === 'appointments') { kpis(); board(); next(); }
    if (evt === 'clients') { kpis(); follow(); }
    if (evt === 'requests') requests();
    if (evt === 'settings') all();
    if (evt === 'sales' || evt === 'shift' || evt === 'rate') { kpis(); board(); }
  });
  return () => { off(); clearInterval(tick); };
}
