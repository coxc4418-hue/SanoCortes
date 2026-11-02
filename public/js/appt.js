// SanoCortes — Citas y turnos: agendar con horarios libres, cliente sin cita, acciones de la cita y reservas en línea
import { store, apptBadge, APPT_STATUS, DAYS } from './store.js';
import { saveAppointment, addWalkin, setApptStatus, reassignTurn, markReminded, pickServices, conflictOf, scheduleWarnings, acceptRequest, rejectRequest, barberForRequest } from './ops.js';
import { freeSlots, barberHours, toMin, minToTime, nowMin } from './barber.js';
import { openModal, esc, usd, toast, setBusy, fmtDate, todayKey, dayKey, addDays, fromKey, confirmDialog, emptyState, fmtAgo, waLink } from './utils.js';
import { icon } from './icons.js';
import { pickClient, avatar, hydratePhotos, openClient, clientLine, stampsHTML } from './client.js';
import { waClient, clientMessage, whenText } from './shared.js';
import { styleLine } from './barber.js';

const nav = async (route, params = {}) => { const { navigate } = await import('./main.js'); navigate(route, { params, force: true }); };
const svcChips = (sel) => store.activeServices.map((s) => `<button type="button" class="svc-chip ${sel.has(s.id) ? 'on' : ''}" data-sv="${s.id}" style="--sc:${s.color || 'var(--brand)'}"><b>${esc(s.name)}</b><small>${s.minutes} min · ${usd(s.price)}</small></button>`).join('');
const barberChip = (b, on, extra = '') => `<button type="button" class="barber-chip ${on ? 'on' : ''}" data-br="${b.id}" style="--bc:${b.color || 'var(--brand)'}"><span class="bdot">${esc((b.name || '?')[0])}</span><span><b>${esc(b.name.split(' ')[0])}</b>${extra ? `<small>${extra}</small>` : ''}</span></button>`;
export const waitText = (min) => (min <= 2 ? 'ya' : min < 60 ? `${Math.round(min / 5) * 5 || 5} min` : `${Math.floor(min / 60)} h ${String(Math.round((min % 60) / 5) * 5).padStart(2, '0')} min`);

// ======================================================================
// AGENDAR / EDITAR CITA
// ======================================================================
export function apptForm({ appt = null, client = null, date = null, time = null, barberId = null, serviceIds = null } = {}) {
  return new Promise((resolve) => {
    let cl = client || (appt?.clientId ? store.client(appt.clientId) : null);
    const st = {
      date: date || appt?.date || todayKey(), time: time || appt?.time || '', barberId: barberId || appt?.barberId || cl?.barberId || store.activeBarbers[0]?.id || '',
      services: new Set(serviceIds || appt?.serviceIds || (cl?.lastServiceIds || []).filter((id) => store.service(id)))
    };
    if (!st.services.size && store.activeServices[0]) st.services.add(store.activeServices[0].id);
    let done = null;
    const m = openModal({
      title: appt ? 'Mover o editar la cita' : 'Agendar cita', sub: appt ? `${esc(appt.clientName)} · ${fmtDate(appt.date)} ${esc(appt.time)}` : 'Elige servicio, barbero y una hora libre', size: 'lg',
      body: `<div class="stack">
        <div data-cl></div>
        <div><div class="section-title">${icon('scissors')} Servicios</div><div class="svc-grid mt" data-svcs>${svcChips(st.services)}</div><div class="small muted mt-xs" data-sum></div></div>
        <div><div class="section-title">${icon('user')} Barbero</div><div class="barber-row mt" data-brs></div></div>
        <div class="row row-wrap" style="gap:8px"><div class="field" style="min-width:170px"><label>Fecha</label><input class="input" type="date" data-date value="${st.date}" min="${appt ? '' : todayKey()}"></div>
          <div class="chips" data-qd>${[0, 1, 2].map((i) => { const d = dayKey(addDays(new Date(), i)); return `<button type="button" class="chip" data-d="${d}">${i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : DAYS[fromKey(d).getDay()]}</button>`; }).join('')}</div></div>
        <div><div class="section-title">${icon('clock')} Horarios libres <span class="faint small" data-hrs></span></div><div class="slots mt" data-slots></div>
          <div class="row mt-xs" style="gap:8px"><span class="small muted">u otra hora:</span><input class="input input-sm" type="time" data-time value="${esc(st.time)}" step="300" style="width:auto"></div></div>
        <div class="field"><label>Nota</label><input class="input" data-note value="${esc(appt?.note || '')}" placeholder="Ej.: viene con su hijo · quiere probar un diseño"></div>
        <div class="error-msg" data-err></div>
      </div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${appt ? 'Guardar cambios' : 'Agendar'}</button>`,
      onClose: () => resolve(done)
    });
    const $ = (q) => m.el.querySelector(q);
    const drawClient = () => {
      $('[data-cl]').innerHTML = cl
        ? `<div class="list-item cust-pick">${avatar(cl)}<div class="grow" style="min-width:0"><b>${esc(cl.name)}</b><div class="t-sub">${esc(cl.phone || '')} · ${clientLine(cl)}${cl.lastStyle ? ` · ${esc(styleLine(cl.lastStyle))}` : ''}</div></div>${appt ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-chg>Cambiar</button>`}</div>`
        : `<div class="form-grid"><div class="field"><label>Cliente</label><div class="row" style="gap:6px"><input class="input" data-nm placeholder="Nombre" autofocus><button type="button" class="btn btn-secondary btn-icon" data-find title="Buscar cliente">${icon('search')}</button></div></div><div class="field"><label>Teléfono / WhatsApp</label><input class="input" data-ph inputmode="tel" placeholder="Para confirmar la cita"></div></div>`;
      hydratePhotos($('[data-cl]'));
      $('[data-chg]')?.addEventListener('click', () => { cl = null; drawClient(); });
      $('[data-find]')?.addEventListener('click', async () => { const c = await pickClient(); if (c) { cl = c; if (c.barberId && store.barber(c.barberId)) st.barberId = c.barberId; drawClient(); drawBarbers(); drawSlots(); } });
      $('[data-ph]')?.addEventListener('change', (e) => { const f = store.findByPhone(e.target.value); if (f) { cl = f; drawClient(); toast(`Ya es cliente: ${f.name}`, 'info'); } });
    };
    const sv = () => pickServices([...st.services]);
    const drawSum = () => { const s = sv(); $('[data-sum]').textContent = s.services.length ? `${s.minutes} min · ${usd(s.total)}` : 'Elige al menos un servicio'; };
    const drawBarbers = () => {
      const wd = fromKey(st.date).getDay();
      $('[data-brs]').innerHTML = store.activeBarbers.map((b) => { const h = barberHours(b, store.settings.schedule, wd); return barberChip(b, b.id === st.barberId, h ? `${minToTime(h.open)}–${minToTime(h.close)}` : 'no trabaja'); }).join('') || emptyState('user', 'Sin barberos', 'Agrégalos en Barberos.');
      m.el.querySelectorAll('[data-br]').forEach((b) => b.onclick = () => { st.barberId = b.dataset.br; drawBarbers(); drawSlots(); });
    };
    const drawSlots = () => {
      const b = store.barber(st.barberId);
      const wd = fromKey(st.date).getDay();
      const h = barberHours(b, store.settings.schedule, wd);
      $('[data-hrs]').textContent = b ? (h ? `· ${b.name.split(' ')[0]} ${minToTime(h.open)} a ${minToTime(h.close)}` : `· ${b.name.split(' ')[0]} no trabaja el ${DAYS[wd].toLowerCase()}`) : '';
      m.el.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x.dataset.d === st.date));
      const s = sv();
      const list = b ? freeSlots({ barber: b, schedule: store.settings.schedule, weekday: wd, busy: store.busyOf(b.id, st.date, appt?.id), minutes: s.minutes, step: Number(store.settings.agenda.step) || 15, minFrom: st.date === todayKey() ? nowMin() : 0 }) : [];
      $('[data-slots]').innerHTML = list.length ? list.map((t) => { const tt = minToTime(t); return `<button type="button" class="slot-btn ${tt === st.time ? 'on' : ''}" data-t="${tt}">${tt}</button>`; }).join('')
        : `<div class="small muted">${b && h ? 'No quedan horarios libres para esa duración. Prueba otro barbero u otro día.' : 'Elige un barbero que trabaje ese día.'}</div>`;
      m.el.querySelectorAll('[data-t]').forEach((x) => x.onclick = () => { st.time = x.dataset.t; $('[data-time]').value = st.time; drawSlots(); });
    };
    m.el.querySelectorAll('[data-sv]').forEach((b) => b.onclick = () => { const id = b.dataset.sv; st.services.has(id) ? st.services.delete(id) : st.services.add(id); b.classList.toggle('on', st.services.has(id)); drawSum(); drawSlots(); });
    $('[data-date]').onchange = (e) => { st.date = e.target.value || todayKey(); st.time = ''; $('[data-time]').value = ''; drawBarbers(); drawSlots(); };
    m.el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { st.date = b.dataset.d; $('[data-date]').value = st.date; st.time = ''; drawBarbers(); drawSlots(); });
    $('[data-time]').onchange = (e) => { st.time = e.target.value; drawSlots(); };
    const submit = async (force = false) => {
      const err = $('[data-err]'); err.textContent = '';
      const client = cl ? { id: cl.id } : { name: $('[data-nm]')?.value.trim(), phone: $('[data-ph]')?.value.trim() };
      if (!cl && !client.name) { err.textContent = 'Escribe el nombre del cliente o búscalo.'; return; }
      if (!st.time) { err.textContent = 'Elige una hora.'; return; }
      const btn = $('[data-ok]'); setBusy(btn, true, 'Guardando…');
      try {
        done = await saveAppointment({ id: appt?.id || null, client, date: st.date, time: st.time, barberId: st.barberId, serviceIds: [...st.services], note: $('[data-note]').value, force });
        m.close();
        toast(appt ? 'Cita actualizada' : `Cita agendada: ${fmtDate(done.date)} ${done.time} con ${done.barberName}`);
        if (done.clientPhone) offerWa(done, appt ? 'Avísale el cambio' : 'Envíale la confirmación');
      } catch (ex) {
        setBusy(btn, false);
        if (['conflict', 'schedule'].includes(ex.code)) {
          if (await confirmDialog({ title: ex.code === 'conflict' ? 'Ese horario está ocupado' : 'Fuera del horario', message: `${esc(ex.message)}<br><br>¿Agendar de todas formas?`, confirmText: 'Agendar igual' })) submit(true);
        } else err.textContent = ex.message;
      }
    };
    $('[data-ok]').onclick = () => submit(false);
    drawClient(); drawSum(); drawBarbers(); drawSlots();
  });
}
/** Ofrece enviar el WhatsApp de confirmación */
function offerWa(a, title) {
  const m = openModal({
    size: 'sm',
    body: `<div class="center stack" style="align-items:center;padding:10px 0"><div class="kpi-icon tone-success" style="width:56px;height:56px">${icon('calendar')}</div><b>${esc(a.clientName)}</b><div class="small muted">${fmtDate(a.date)} · ${esc(a.time)} · ${esc(a.barberName)}<br>${esc(a.serviceNames)}</div></div>`,
    footer: `<button class="btn btn-secondary" data-close>Ahora no</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} ${esc(title)}</button>`
  });
  m.el.querySelector('[data-wa]').onclick = () => { m.close(); waClient('confirmar', { appt: a, client: store.client(a.clientId) || {} }); };
}

// ======================================================================
// CLIENTE SIN CITA (turno)
// ======================================================================
export function walkinForm({ client = null, via = 'recepcion' } = {}) {
  return new Promise((resolve) => {
    let cl = client;
    const st = { barberId: cl?.barberId && store.barber(cl.barberId) ? cl.barberId : 'any', services: new Set((cl?.lastServiceIds || []).filter((id) => store.service(id)).length ? cl.lastServiceIds.filter((id) => store.service(id)) : [store.activeServices[0]?.id].filter(Boolean)) };
    let done = null;
    const m = openModal({
      title: 'Llegó sin cita', sub: 'Entra a la fila de espera con el tiempo estimado', size: 'lg',
      body: `<div class="stack"><div data-cl></div>
        <div><div class="section-title">${icon('scissors')} ¿Qué se va a hacer?</div><div class="svc-grid mt" data-svcs>${svcChips(st.services)}</div></div>
        <div><div class="section-title">${icon('clock')} Barbero y espera</div><div class="barber-row mt" data-brs></div></div>
        <div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-success" data-ok>${icon('chair')} Agregar a la fila</button>`,
      onClose: () => resolve(done)
    });
    const $ = (q) => m.el.querySelector(q);
    const drawClient = () => {
      $('[data-cl]').innerHTML = cl
        ? `<div class="list-item cust-pick">${avatar(cl)}<div class="grow"><b>${esc(cl.name)}</b><div class="t-sub">${clientLine(cl)}${cl.lastStyle ? ` · ${esc(styleLine(cl.lastStyle))}` : ''}</div></div><button type="button" class="btn btn-ghost btn-sm" data-chg>Cambiar</button></div>`
        : `<div class="form-grid"><div class="field"><label>Nombre</label><div class="row" style="gap:6px"><input class="input" data-nm placeholder="Nombre del cliente" autofocus><button type="button" class="btn btn-secondary btn-icon" data-find title="Buscar cliente">${icon('search')}</button></div></div><div class="field"><label>WhatsApp (opcional)</label><input class="input" data-ph inputmode="tel" placeholder="Para avisarle cuando sea su turno"></div></div>`;
      hydratePhotos($('[data-cl]'));
      $('[data-chg]')?.addEventListener('click', () => { cl = null; drawClient(); });
      $('[data-find]')?.addEventListener('click', async () => { const c = await pickClient(); if (c) { cl = c; if (c.barberId && store.barber(c.barberId)) st.barberId = c.barberId; drawClient(); drawBarbers(); } });
    };
    const drawBarbers = () => {
      const est = store.waitEstimate();
      const first = store.firstFree();
      $('[data-brs]').innerHTML = `<button type="button" class="barber-chip ${st.barberId === 'any' ? 'on' : ''}" data-br="any" style="--bc:var(--brand)"><span class="bdot">${icon('zap')}</span><span><b>El primero libre</b><small>${first ? `${esc(first.barber.name.split(' ')[0])} · ${waitText(first.wait)}` : 'nadie trabajando'}</small></span></button>`
        + store.activeBarbers.map((b) => { const e = est[b.id]; return barberChip(b, st.barberId === b.id, e ? `espera ${waitText(e.wait)}${e.queue ? ` · ${e.queue} en fila` : ''}` : 'no está'); }).join('');
      m.el.querySelectorAll('[data-br]').forEach((b) => b.onclick = () => { st.barberId = b.dataset.br; drawBarbers(); });
    };
    m.el.querySelectorAll('[data-sv]').forEach((b) => b.onclick = () => { const id = b.dataset.sv; st.services.has(id) ? st.services.delete(id) : st.services.add(id); b.classList.toggle('on', st.services.has(id)); });
    $('[data-ok]').onclick = async (e) => {
      const err = $('[data-err]'); err.textContent = '';
      const client = cl ? { id: cl.id } : { name: $('[data-nm]')?.value.trim() || 'Cliente', phone: $('[data-ph]')?.value.trim() };
      setBusy(e.currentTarget, true, 'Agregando…');
      try {
        done = await addWalkin({ client, serviceIds: [...st.services], barberId: st.barberId, via });
        m.close();
        turnTicket(done);
      } catch (ex) { err.textContent = ex.message; setBusy(e.currentTarget, false); }
    };
    drawClient(); drawBarbers();
  });
}
/** Comprobante del turno: número, barbero y espera */
export function turnTicket(a) {
  const m = openModal({
    size: 'sm',
    body: `<div class="center stack" style="align-items:center;padding:12px 0"><div class="small muted">Turno</div><div class="turn-no">#${a.queueNo}</div><b>${esc(a.clientName)}</b><div class="small muted">${esc(a.serviceNames)} · con ${esc(a.barberName)}</div><div class="badge badge-warning" style="height:28px;font-size:13px">${icon('clock')} Espera aprox. ${waitText(a.wait || 0)}</div></div>`,
    footer: `${a.clientPhone ? `<button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Avisarle por WhatsApp</button>` : ''}<button class="btn btn-primary" data-close autofocus>Listo</button>`
  });
  m.el.querySelector('[data-wa]')?.addEventListener('click', () => waClient('turno', { appt: a, extra: waitText(a.wait || 0) }));
}

// ======================================================================
// ACCIONES DE UNA CITA / TURNO
// ======================================================================
export function openAppt(a0) {
  let a = store.appointments.find((x) => x.id === a0.id) || a0;
  const m = openModal({ title: '', size: 'md', body: '<div data-r></div>' });
  const off = store.on('appointments', () => { const n = store.appointments.find((x) => x.id === a.id); if (n) { a = n; draw(); } });
  const close0 = m.close; m.close = () => { off(); close0(); };
  function draw() {
    const cl = a.clientId ? store.client(a.clientId) : null;
    const late = ['reservada', 'confirmada'].includes(a.status) && a.date === todayKey() && nowMin() > a.start + 5;
    const S = a.status;
    const btn = (k, ic, label, cls = 'btn-secondary') => `<button class="btn ${cls}" data-act="${k}">${icon(ic)} ${label}</button>`;
    m.el.querySelector('[data-r]').innerHTML = `<div class="stack">
      <div class="between"><div class="row" style="gap:10px"><span class="bdot bdot-lg" style="--bc:${a.barberColor || 'var(--brand)'}">${esc((a.barberName || '?')[0])}</span><div><div class="modal-title">${esc(a.clientName)}</div><div class="modal-sub">${a.kind === 'turno' ? `Turno #${a.queueNo} · llegó ${fmtAgo(a.arrivedAt)}` : `${fmtDate(a.date)} · ${esc(a.time)}–${minToTime(a.end)}`} · ${esc(a.barberName)}</div></div></div><button class="x-btn" data-close>${icon('x')}</button></div>
      <div class="row row-wrap" style="gap:6px">${apptBadge(S)}${a.source === 'online' ? '<span class="badge badge-info">Reservó en línea</span>' : ''}${late ? '<span class="badge badge-danger">Retrasado</span>' : ''}${a.remindedAt ? `<span class="badge badge-neutral">${icon('whatsapp')} recordado</span>` : ''}</div>
      <div class="summary-box">${(a.services || []).map((s) => `<div class="summary-row"><span>${esc(s.name)} <span class="t-sub">${s.minutes} min</span></span><b>${usd(s.price)}</b></div>`).join('')}<div class="summary-row total"><span>Estimado</span><span>${usd(a.estimate || 0)}</span></div></div>
      ${cl ? `<button class="list-item" data-cl>${avatar(cl)}<div class="grow" style="min-width:0"><b>${esc(cl.name)}</b><div class="t-sub">${clientLine(cl)}${cl.noShows ? ` · <span class="text-danger">${cl.noShows} vez(es) no vino</span>` : ''}</div>${cl.lastStyle ? `<div class="small">${icon('scissors')} ${esc(styleLine(cl.lastStyle))}</div>` : ''}${cl.allergies ? `<div class="small text-warning">${icon('alert')} ${esc(cl.allergies)}</div>` : ''}</div>${stampsHTML(cl)}</button>` : a.clientPhone ? `<div class="small">${icon('phone')} ${esc(a.clientPhone)}</div>` : ''}
      ${a.note ? `<div class="box small">${icon('info')} ${esc(a.note)}</div>` : ''}
      <div class="row row-wrap" style="gap:8px">
        ${S === 'reservada' ? btn('confirmar', 'checkCircle', 'Confirmar') : ''}
        ${['reservada', 'confirmada'].includes(S) ? btn('llego', 'userCheck', 'Llegó', 'btn-success') + btn('silla', 'chair', 'A la silla', 'btn-primary') : ''}
        ${S === 'espera' ? btn('silla', 'chair', 'Pasar a la silla', 'btn-primary') + btn('otro', 'refresh', 'Otro barbero') : ''}
        ${S === 'en_silla' ? btn('cobrar', 'cart', 'Terminar y cobrar', 'btn-success') : ''}
        ${['reservada', 'confirmada', 'espera'].includes(S) && (a.clientPhone || cl?.phone) ? btn(S === 'espera' ? 'wa_turno' : 'wa_rec', 'whatsapp', S === 'espera' ? 'Avisar turno' : 'Recordar', 'btn-whatsapp') : ''}
        ${['reservada', 'confirmada'].includes(S) ? btn('mover', 'edit', 'Mover') : ''}
        ${['reservada', 'confirmada'].includes(S) ? btn('novino', 'x', 'No vino', 'btn-ghost') : ''}
        ${OPENISH(S) ? btn('cancelar', 'trash', a.kind === 'turno' ? 'Se fue' : 'Cancelar', 'btn-ghost') : ''}
        ${['no_vino', 'cancelada'].includes(S) ? btn('reabrir', 'refresh', 'Reabrir') : ''}
        ${S === 'terminada' && a.saleNumber ? `<span class="small muted">Cobrado · ${esc(a.saleNumber)}</span>` : ''}
      </div></div>`;
    hydratePhotos(m.el);
    m.el.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => m.close());
    m.el.querySelector('[data-cl]')?.addEventListener('click', () => { m.close(); openClient(cl.id); });
    m.el.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => act(b.dataset.act, b));
  }
  async function act(k, b) {
    const cl = a.clientId ? store.client(a.clientId) : null;
    try {
      if (k === 'confirmar') { await setApptStatus(a, 'confirmada'); toast('Cita confirmada'); }
      if (k === 'llego') { await setApptStatus(a, 'espera'); toast(`${a.clientName} está en la sala de espera`); }
      if (k === 'silla') { await setApptStatus(a, 'en_silla'); toast(`${a.clientName} pasó a la silla de ${a.barberName}`); }
      if (k === 'otro') { const id = await chooseBarber(a.barberId); if (id) { await reassignTurn(a, { barberId: id }); toast('Turno reasignado'); } }
      if (k === 'cobrar') { m.close(); nav('cobrar', { apptId: a.id }); return; }
      if (k === 'wa_rec') { waClient('recordatorio', { appt: a, client: cl || {} }); await markReminded(a); }
      if (k === 'wa_turno') waClient('tu_turno', { appt: a, client: cl || {} });
      if (k === 'mover') { m.close(); await apptForm({ appt: a }); return; }
      if (k === 'novino') { if (await confirmDialog({ title: 'No vino', message: `Se marca que <b>${esc(a.clientName)}</b> no llegó a su cita. Queda en su historial.`, confirmText: 'Marcar', danger: true })) { await setApptStatus(a, 'no_vino'); toast('Marcado como no vino', 'warning'); } }
      if (k === 'cancelar') { if (await confirmDialog({ title: a.kind === 'turno' ? 'Se fue sin atenderse' : 'Cancelar cita', message: 'El horario queda libre para otro cliente.', confirmText: a.kind === 'turno' ? 'Quitar de la fila' : 'Cancelar cita', danger: true })) { await setApptStatus(a, 'cancelada', { reason: a.kind === 'turno' ? 'Se fue' : 'Cancelada en el local' }); m.close(); toast('Listo'); } }
      if (k === 'reabrir') { await setApptStatus(a, a.kind === 'turno' ? 'espera' : 'reservada'); }
    } catch (ex) { toast(ex.message, 'danger', 5000); }
  }
  draw();
}
const OPENISH = (s) => ['reservada', 'confirmada', 'espera'].includes(s);
export function chooseBarber(current = null, title = 'Elegir barbero') {
  return new Promise((resolve) => {
    let pick = null;
    const est = store.waitEstimate();
    const m = openModal({
      title, size: 'sm',
      body: `<div class="list">${store.activeBarbers.map((b) => `<button class="list-item" data-b="${b.id}" ${b.id === current ? 'disabled style="opacity:.5"' : ''}><span class="bdot" style="background:${b.color}">${esc(b.name[0])}</span><div class="grow"><b>${esc(b.name)}</b><div class="t-sub">${est[b.id] ? `libre en ${waitText(est[b.id].wait)}` : 'no está trabajando'}</div></div></button>`).join('')}</div>`,
      footer: '<button class="btn btn-secondary" data-close>Cancelar</button>', onClose: () => resolve(pick)
    });
    m.el.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { pick = b.dataset.b; m.close(); });
  });
}

// ======================================================================
// SOLICITUDES DE LA RESERVA EN LÍNEA
// ======================================================================
export function requestModal(r) {
  return new Promise((resolve) => {
    let barberId = barberForRequest(r);
    let time = r.time; let date = r.date;
    let done = null;
    const sv = pickServices(r.serviceIds);
    const known = store.findByPhone(r.phone);
    const m = openModal({
      title: 'Reserva en línea', sub: `Recibida ${fmtAgo(r.createdAt)}`, size: 'md',
      body: `<div class="stack">
        <div class="list-item">${avatar(known || { name: r.name })}<div class="grow"><b>${esc(r.name)}</b><div class="t-sub">${esc(r.phone)} · ${known ? `ya es cliente (${esc(known.number)})` : 'cliente nuevo'}</div></div></div>
        <div class="summary-box"><div class="summary-row"><span>Pidió</span><b>${esc(sv.names || r.serviceNames || '')}</b></div><div class="summary-row"><span>Cuándo</span><b>${fmtDate(r.date)} · ${esc(r.time)}</b></div><div class="summary-row"><span>Con</span><b>${r.barberId && r.barberId !== 'any' ? esc(store.barber(r.barberId)?.name || '—') : 'El que esté libre'}</b></div>${r.note ? `<div class="summary-row"><span>Nota</span><b>${esc(r.note)}</b></div>` : ''}</div>
        <div data-check></div>
        <div class="form-grid"><div class="field"><label>Barbero</label><select class="select" data-b>${store.activeBarbers.map((b) => `<option value="${b.id}" ${b.id === barberId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Fecha y hora</label><div class="row" style="gap:6px"><input class="input" type="date" data-d value="${date}"><input class="input" type="time" data-t value="${time}" step="300"></div></div></div>
        <div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-danger-soft" data-no style="margin-right:auto">${icon('x')} Rechazar</button><button class="btn btn-secondary" data-close>Luego</button><button class="btn btn-primary" data-ok>${icon('check')} Aceptar y confirmar</button>`,
      onClose: () => resolve(done)
    });
    const $ = (q) => m.el.querySelector(q);
    const check = () => {
      const c = conflictOf(barberId, date, toMin(time), sv.minutes);
      const w = scheduleWarnings(barberId, date, toMin(time), sv.minutes);
      $('[data-check]').innerHTML = c ? `<div class="vital-alert danger">${icon('alert')} Choca con ${esc(c.clientName)} (${esc(c.time)}). Cambia la hora o el barbero.</div>` : w.length ? `<div class="vital-alert warning">${icon('alert')} ${esc(w.join(' '))}</div>` : `<div class="vital-alert success">${icon('checkCircle')} Horario libre.</div>`;
    };
    $('[data-b]').onchange = (e) => { barberId = e.target.value; check(); };
    $('[data-d]').onchange = (e) => { date = e.target.value; check(); };
    $('[data-t]').onchange = (e) => { time = e.target.value; check(); };
    $('[data-no]').onclick = async () => {
      if (!(await confirmDialog({ title: 'Rechazar la reserva', message: 'Se borra la solicitud. Puedes escribirle para proponerle otra hora.', confirmText: 'Rechazar', danger: true }))) return;
      await rejectRequest(r); done = 'rejected'; m.close();
      const text = clientMessage('libre', { client: { name: r.name }, extra: `Recibimos tu reserva para el ${fmtDate(r.date)} a las ${r.time}, pero ese horario ya no está disponible 😔. ¿Te sirve otra hora? Dinos y te la apartamos.` });
      window.open(waLink(r.phone, text), '_blank', 'noopener');
    };
    $('[data-ok]').onclick = async (e) => {
      setBusy(e.currentTarget, true, 'Confirmando…');
      try {
        const appt = await acceptRequest(r, { barberId, time, date, force: true });
        done = appt; m.close();
        toast('Reserva aceptada');
        waClient('confirmar', { appt, client: store.client(appt.clientId) || {} });
      } catch (ex) { $('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
    check();
  });
}

export { APPT_STATUS };
