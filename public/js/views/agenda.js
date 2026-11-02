// SanoCortes — Agenda por barbero: día en columnas, próximos 7 días, reservas en línea y recordatorios
import { store, apptBadge, DAYS, BUSY_STATUS } from '../store.js';
import { esc, usd, todayKey, dayKey, addDays, fromKey, fmtDate, shortDate, fmtLongDate, emptyState, fmtAgo } from '../utils.js';
import { icon } from '../icons.js';
import { apptForm, openAppt, requestModal, walkinForm } from '../appt.js';
import { waClient } from '../shared.js';
import { markReminded } from '../ops.js';
import { barberHours, hoursFor, minToTime, nowMin, toMin } from '../barber.js';

const PX = 1.5; // píxeles por minuto
export function mount(el, { params = {} } = {}) {
  let date = params.date || todayKey();
  let mode = 'dia';
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Agenda</h1><p class="view-sub" id="ag-sub"></p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="ag-rem">${icon('whatsapp')} Recordatorios</button><button class="btn btn-secondary" id="ag-walk">${icon('chair')} Sin cita</button><button class="btn btn-primary" id="ag-new">${icon('plus')} Nueva cita</button></div></div>
    <div id="ag-req"></div>
    <div class="card card-flush">
      <div class="toolbar ag-toolbar" data-tour="agnav">
        <div class="row" style="gap:6px"><button class="btn btn-secondary btn-icon btn-sm" id="ag-prev" aria-label="Día anterior">${icon('chevronLeft')}</button><button class="btn btn-secondary btn-sm" id="ag-today">Hoy</button><button class="btn btn-secondary btn-icon btn-sm" id="ag-next" aria-label="Día siguiente">${icon('chevronRight')}</button><input class="input input-sm" type="date" id="ag-date" style="width:auto"></div>
        <div class="seg" id="ag-mode"><button data-m="dia">Día</button><button data-m="semana">7 días</button></div>
      </div>
      <div id="ag-body"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  function reqs() {
    const list = store.pendingRequests;
    $('#ag-req').innerHTML = list.length ? `<div class="card req-card" data-tour="requests"><div class="card-head"><div class="card-title">${icon('globe')} Reservas en línea por confirmar <span class="badge badge-info">${list.length}</span></div></div><div class="list">${list.map((r) => `<button class="list-item" data-r="${r.id}"><span class="kpi-icon tone-info" style="width:38px;height:38px">${icon('calendar')}</span><div class="grow" style="min-width:0"><b>${esc(r.name)}</b><div class="t-sub">${fmtDate(r.date)} ${esc(r.time)} · ${esc(r.serviceNames || '')} · ${r.barberId && r.barberId !== 'any' ? esc(store.barber(r.barberId)?.name || '') : 'cualquier barbero'}</div></div><span class="t-sub">${fmtAgo(r.createdAt)}</span></button>`).join('')}</div></div>` : '';
    el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => requestModal(store.requests.find((r) => r.id === b.dataset.r)));
  }

  function draw() {
    $('#ag-date').value = date;
    el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    const appts = store.apptsOn(date).filter((a) => a.status !== 'cancelada');
    $('#ag-sub').textContent = `${fmtLongDate(fromKey(date))} · ${appts.filter((a) => BUSY_STATUS.includes(a.status)).length} cita(s)`;
    if (mode === 'semana') return week();
    const wd = fromKey(date).getDay();
    const shop = hoursFor(store.settings.schedule, wd);
    const barbers = store.activeBarbers;
    if (!barbers.length) { $('#ag-body').innerHTML = `<div style="padding:20px">${emptyState('scissors', 'Aún no hay barberos', 'Agrégalos en Barberos y pagos con su horario.')}</div>`; return; }
    const hrsList = barbers.map((b) => barberHours(b, store.settings.schedule, wd)).filter(Boolean);
    const open = Math.min(shop?.open ?? 9 * 60, ...hrsList.map((h) => h.open), ...appts.map((a) => a.start || 600));
    const close = Math.max(shop?.close ?? 19 * 60, ...hrsList.map((h) => h.close), ...appts.map((a) => a.end || 600));
    const from = Math.floor(open / 60) * 60; const to = Math.ceil(close / 60) * 60;
    const H = (to - from) * PX;
    const step = Number(store.settings.agenda.step) || 15;
    const nm = nowMin();
    const isToday = date === todayKey();
    const hours = []; for (let t = from; t < to; t += 60) hours.push(t);
    $('#ag-body').innerHTML = `${!shop ? `<div class="box small" style="margin:0 14px 10px">${icon('info')} La barbería no abre los ${DAYS[wd].toLowerCase()} según el horario general. Puedes agendar igual si algún barbero trabaja.</div>` : ''}
      <div class="agx-wrap" data-tour="agenda"><div class="agx" style="--cols:${barbers.length}">
        <div class="agx-head"><div class="agx-corner"></div>${barbers.map((b) => { const h = barberHours(b, store.settings.schedule, wd); const n = appts.filter((a) => a.barberId === b.id && BUSY_STATUS.includes(a.status)).length; return `<div class="agx-bh" style="--bc:${b.color || 'var(--brand)'}"><span class="bdot">${esc(b.name[0])}</span><div style="min-width:0"><b class="ellipsis">${esc(b.name)}</b><small>${h ? `${minToTime(h.open)}–${minToTime(h.close)} · ${n} cita(s)` : 'No trabaja'}</small></div></div>`; }).join('')}</div>
        <div class="agx-body" style="--h:${H}px">
          <div class="agx-times">${hours.map((t) => `<span style="top:${(t - from) * PX}px">${minToTime(t)}</span>`).join('')}</div>
          ${barbers.map((b) => {
            const h = barberHours(b, store.settings.schedule, wd);
            const mine = appts.filter((a) => a.barberId === b.id && !['cancelada'].includes(a.status));
            const off = [];
            if (!h) off.push([from, to]); else { if (h.open > from) off.push([from, h.open]); if (h.close < to) off.push([h.close, to]); if (h.breakFrom != null && h.breakTo != null) off.push([h.breakFrom, h.breakTo, 'Descanso']); }
            const slots = []; for (let t = from; t < to; t += step) slots.push(t);
            return `<div class="agx-col" data-b="${b.id}">
              ${hours.map((t) => `<i class="agx-line" style="top:${(t - from) * PX}px"></i>`).join('')}
              ${off.map(([s, e, l]) => `<div class="agx-off" style="top:${(s - from) * PX}px;height:${(e - s) * PX}px">${l ? `<span>${l}</span>` : ''}</div>`).join('')}
              ${slots.map((t) => `<button class="agx-slot" data-t="${minToTime(t)}" style="top:${(t - from) * PX}px;height:${step * PX}px" title="${minToTime(t)} · agendar con ${esc(b.name)}"></button>`).join('')}
              ${mine.map((a) => { const s = a.start ?? toMin(a.time); const e = Math.max(s + 15, a.end ?? s + 30); return `<button class="agx-appt st-${a.status} ${a.kind === 'turno' ? 'is-turn' : ''}" data-a="${a.id}" style="top:${(s - from) * PX}px;height:${Math.max(22, (e - s) * PX - 2)}px;--bc:${b.color || 'var(--brand)'}"><b class="ellipsis">${esc(a.time)} ${esc(a.clientName)}</b><span class="ellipsis">${esc(a.serviceNames)}</span>${a.source === 'online' ? `<em>${icon('globe')}</em>` : ''}</button>`; }).join('')}
              ${isToday && nm >= from && nm <= to ? `<i class="agx-now" style="top:${(nm - from) * PX}px"></i>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div></div>
      <div class="ag-legend small muted">${['reservada', 'confirmada', 'espera', 'en_silla', 'terminada', 'no_vino'].map((s) => `<span>${apptBadge(s)}</span>`).join('')} <span>Toca un espacio libre para agendar.</span></div>`;
    el.querySelectorAll('.agx-col').forEach((col) => col.querySelectorAll('[data-t]').forEach((s) => s.onclick = () => apptForm({ date, time: s.dataset.t, barberId: col.dataset.b })));
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openAppt(store.appointments.find((x) => x.id === b.dataset.a)); });
    if (isToday && !draw._scrolled) { draw._scrolled = true; const wrap = el.querySelector('.agx-body'); const y = Math.max(0, (nm - from - 60) * PX); el.querySelector('.agx-wrap').scrollTop = y; void wrap; }
  }

  function week() {
    const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(fromKey(date), i)));
    $('#ag-body').innerHTML = `<div class="wk">${days.map((d) => {
      const list = store.apptsOn(d).filter((a) => !['cancelada'].includes(a.status));
      return `<div class="wk-day ${d === todayKey() ? 'today' : ''}"><button class="wk-h" data-d="${d}"><b>${DAYS[fromKey(d).getDay()]}</b><span>${shortDate(d)} · ${list.length} cita(s)</span></button>
        <div class="list">${list.map((a) => `<button class="list-item wk-item" data-a="${a.id}" style="--bc:${a.barberColor || 'var(--brand)'}"><span class="appt-time" style="--bc:${a.barberColor || 'var(--brand)'}">${esc(a.time)}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(a.clientName)}</b><div class="t-sub ellipsis">${esc(a.serviceNames)} · ${esc(a.barberName)}</div></div>${apptBadge(a.status)}</button>`).join('') || '<div class="small muted" style="padding:8px">Sin citas</div>'}</div></div>`;
    }).join('')}</div>`;
    el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { date = b.dataset.d; mode = 'dia'; draw(); });
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => openAppt(store.appointments.find((x) => x.id === b.dataset.a)));
  }

  /** Recordatorios: citas de mañana (y de hoy) sin recordar, una por una por WhatsApp */
  function reminders() {
    import('../utils.js').then(({ openModal }) => {
      const t = todayKey(); const tm = dayKey(addDays(new Date(), 1));
      const list = store.appointments.filter((a) => [t, tm].includes(a.date) && ['reservada', 'confirmada'].includes(a.status) && (a.clientPhone || store.client(a.clientId)?.phone) && (a.date === tm || a.start > nowMin()));
      const m = openModal({
        title: 'Recordatorios por WhatsApp', sub: 'Las citas de hoy y mañana: toca cada una para enviar el mensaje listo', size: 'md',
        body: list.length ? `<div class="list">${list.map((a) => `<div class="list-item"><span class="appt-time" style="--bc:${a.barberColor}">${a.date === t ? 'Hoy' : 'Mañ.'}<br>${esc(a.time)}</span><div class="grow" style="min-width:0"><b>${esc(a.clientName)}</b><div class="t-sub">${esc(a.serviceNames)} · ${esc(a.barberName)}</div></div>${a.remindedAt ? `<span class="badge badge-success">${icon('check')} Enviado</span>` : ''}<button class="btn btn-whatsapp btn-sm" data-w="${a.id}">${icon('whatsapp')} ${a.remindedAt ? 'Otra vez' : 'Enviar'}</button></div>`).join('')}</div>` : emptyState('checkCircle', 'Nada por recordar', 'No hay citas próximas con teléfono.'),
        footer: '<button class="btn btn-primary" data-close>Listo</button>'
      });
      m.el.querySelectorAll('[data-w]').forEach((b) => b.onclick = async () => {
        const a = store.appointments.find((x) => x.id === b.dataset.w);
        waClient('recordatorio', { appt: a, client: store.client(a.clientId) || {} });
        await markReminded(a); b.closest('.list-item').style.opacity = '.55'; b.innerHTML = `${icon('check')} Enviado`;
      });
    });
  }

  $('#ag-prev').onclick = () => { date = dayKey(addDays(fromKey(date), mode === 'semana' ? -7 : -1)); draw(); };
  $('#ag-next').onclick = () => { date = dayKey(addDays(fromKey(date), mode === 'semana' ? 7 : 1)); draw(); };
  $('#ag-today').onclick = () => { date = todayKey(); draw._scrolled = false; draw(); };
  $('#ag-date').onchange = (e) => { date = e.target.value || todayKey(); draw(); };
  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; draw(); });
  $('#ag-new').onclick = () => apptForm({ date: date < todayKey() ? todayKey() : date });
  $('#ag-walk').onclick = () => walkinForm();
  $('#ag-rem').onclick = reminders;
  reqs(); draw();
  const tick = setInterval(() => { if (date === todayKey() && mode === 'dia') draw(); }, 60000);
  const off = store.on('*', (evt) => { if (evt === 'appointments' || evt === 'settings') draw(); if (evt === 'requests') reqs(); });
  return () => { off(); clearInterval(tick); };
}
