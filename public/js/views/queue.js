// SanoCortes — Sala de espera: quién está en cada silla, la fila con tiempos estimados y las citas que llegan
import { store, apptBadge } from '../store.js';
import { esc, toast, emptyState, fmtAgo } from '../utils.js';
import { icon } from '../icons.js';
import { walkinForm, openAppt, waitText, chooseBarber } from '../appt.js';
import { setApptStatus, reassignTurn } from '../ops.js';
import { waClient } from '../shared.js';
import { avatar, hydratePhotos, stampsHTML } from '../client.js';
import { nowMin, styleLine } from '../barber.js';

export function mount(el, { navigate }) {
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Sala de espera</h1><p class="view-sub">Turnos por orden de llegada con el tiempo estimado de cada barbero.</p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="q-tv">${icon('tv')} Pantalla de turnos</button><button class="btn btn-success" id="q-walk">${icon('chair')} Llegó sin cita</button></div></div>
    <div class="grid-2">
      <div class="card" data-tour="chairs"><div class="card-head"><div class="card-title">${icon('scissors')} En la silla</div></div><div id="q-chairs"></div></div>
      <div class="card" data-tour="waiting"><div class="card-head"><div class="card-title">${icon('clock')} En espera <span class="badge badge-warning" id="q-n"></span></div></div><div id="q-wait"></div></div>
    </div>
    <div class="card mt-lg"><div class="card-head"><div class="card-title">${icon('calendar')} Citas que llegan en la próxima hora</div></div><div id="q-soon"></div></div>`;
  const $ = (s) => el.querySelector(s);
  $('#q-walk').onclick = () => walkinForm();
  $('#q-tv').onclick = () => navigate('pantalla');

  function draw() {
    const nm = nowMin();
    const est = store.waitEstimate();
    // Sillas
    $('#q-chairs').innerHTML = store.activeBarbers.length ? `<div class="chairs">${store.activeBarbers.map((b) => {
      const a = store.inChair.find((x) => x.barberId === b.id);
      const c = a ? store.client(a.clientId) : null;
      const el2 = a ? Math.max(0, nm - (a.startedMin ?? nm)) : 0;
      const pct = a ? Math.min(100, (el2 / Math.max(1, a.minutes || 30)) * 100) : 0;
      return `<div class="chair ${a ? 'busy' : ''}" style="--bc:${b.color || 'var(--brand)'}"><div class="row" style="gap:8px"><span class="bdot">${esc(b.name[0])}</span><b class="grow ellipsis">${esc(b.name)}</b>${est[b.id] ? '' : '<span class="badge badge-neutral">fuera de turno</span>'}</div>
        ${a ? `<button class="chair-who" data-a="${a.id}">${avatar(c || { name: a.clientName })}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(a.clientName)}</b><div class="t-sub ellipsis">${esc(a.serviceNames)}</div>${c?.lastStyle ? `<div class="t-sub ellipsis">${icon('scissors')} ${esc(styleLine(c.lastStyle))}</div>` : ''}</div></button>
          <div class="progress"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--warning)' : 'var(--bc)'}"></i></div><div class="between small"><span>${el2} de ${a.minutes} min</span><button class="btn btn-success btn-sm" data-pay="${a.id}">${icon('cart')} Cobrar</button></div>`
          : `<div class="chair-free">${icon('chair')} Libre${store.waiting.find((x) => x.barberId === b.id) ? ' · tiene fila' : ''}</div>${store.waiting.find((x) => x.barberId === b.id) ? `<button class="btn btn-primary btn-sm btn-block" data-callnext="${b.id}">${icon('bell')} Llamar al siguiente</button>` : ''}`}
      </div>`;
    }).join('')}</div>` : emptyState('scissors', 'Sin barberos', 'Agrégalos en Barberos y pagos.');
    // Fila
    const w = store.waiting;
    $('#q-n').textContent = w.length || '';
    const pos = {};
    $('#q-wait').innerHTML = w.length ? `<div class="list">${w.map((a) => {
      pos[a.barberId] = (pos[a.barberId] || 0) + 1;
      const e = est[a.barberId];
      const chair = store.inChair.find((x) => x.barberId === a.barberId);
      const ahead = w.filter((x) => x.barberId === a.barberId && (x.arrivedAt || '') < (a.arrivedAt || ''));
      const wait = Math.max(0, (chair ? (chair.startedMin ?? nm) + chair.minutes - nm : 0) + ahead.reduce((s, x) => s + (x.minutes || 30), 0));
      const c = store.client(a.clientId);
      return `<div class="list-item wait-row"><span class="turn-chip">#${a.queueNo || '—'}</span><button class="grow linkish" style="min-width:0;text-align:left" data-a="${a.id}"><b class="ellipsis">${esc(a.clientName)}</b><div class="t-sub ellipsis">${esc(a.serviceNames)} · ${a.anyBarber ? 'el primero libre → ' : ''}<b style="color:${a.barberColor}">${esc(a.barberName)}</b> · llegó ${fmtAgo(a.arrivedAt)}${a.kind === 'cita' ? ' · <b>tenía cita ' + esc(a.time) + '</b>' : ''}</div></button>
        <span class="badge ${wait ? 'badge-warning' : 'badge-success'}">${wait ? '~' + waitText(wait) : 'le toca'}</span>
        <div class="row" style="gap:4px">${c?.phone || a.clientPhone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${a.id}" title="Avisar">${icon('whatsapp')}</button>` : ''}<button class="btn btn-ghost btn-icon btn-sm" data-swap="${a.id}" title="Otro barbero">${icon('refresh')}</button><button class="btn btn-primary btn-sm" data-sit="${a.id}">${icon('chair')} Silla</button></div></div>`;
    }).join('')}</div>` : emptyState('chair', 'Nadie esperando', 'Cuando llegue alguien sin cita, agrégalo con “Llegó sin cita” (F2).');
    // Próximas citas
    const soon = store.upcomingToday.filter((a) => a.start - nm <= 60);
    $('#q-soon').innerHTML = soon.length ? `<div class="list">${soon.map((a) => `<div class="list-item"><span class="appt-time" style="--bc:${a.barberColor}">${esc(a.time)}</span><button class="grow linkish" style="text-align:left;min-width:0" data-a="${a.id}"><b>${esc(a.clientName)}</b><div class="t-sub">${esc(a.serviceNames)} · ${esc(a.barberName)}${nm > a.start + 5 ? ' · <span class="text-danger">retrasado ' + (nm - a.start) + ' min</span>' : ''}</div></button>${apptBadge(a.status)}<button class="btn btn-success btn-sm" data-in="${a.id}">${icon('userCheck')} Llegó</button></div>`).join('')}</div>` : emptyState('calendar', 'Sin citas en la próxima hora');
    hydratePhotos(el, 20);
    const find = (id) => store.appointments.find((x) => x.id === id);
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => openAppt(find(b.dataset.a)));
    el.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => navigate('cobrar', { params: { apptId: b.dataset.pay }, force: true }));
    el.querySelectorAll('[data-sit]').forEach((b) => b.onclick = async () => { try { const a = find(b.dataset.sit); await setApptStatus(a, 'en_silla'); toast(`${a.clientName} a la silla de ${a.barberName}`); } catch (ex) { toast(ex.message, 'danger', 5000); } });
    el.querySelectorAll('[data-in]').forEach((b) => b.onclick = async () => { const a = find(b.dataset.in); await setApptStatus(a, 'espera'); toast(`${a.clientName} llegó`); });
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const a = find(b.dataset.wa); const e = store.waitEstimate()[a.barberId]; waClient(store.waiting[0]?.id === a.id ? 'tu_turno' : 'turno', { appt: a, client: store.client(a.clientId) || {}, extra: e ? waitText(e.wait) : '' }); });
    el.querySelectorAll('[data-swap]').forEach((b) => b.onclick = async () => { const a = find(b.dataset.swap); const id = await chooseBarber(a.barberId, 'Pasar a otro barbero'); if (id) { await reassignTurn(a, { barberId: id }); toast('Turno reasignado'); } });
    el.querySelectorAll('[data-callnext]').forEach((b) => b.onclick = async () => {
      const a = store.waiting.find((x) => x.barberId === b.dataset.callnext);
      if (!a) return;
      try { await setApptStatus(a, 'en_silla'); toast(`Turno #${a.queueNo}: ${a.clientName}`); if (a.clientPhone) waClient('tu_turno', { appt: a, client: store.client(a.clientId) || {} }); } catch (ex) { toast(ex.message, 'danger'); }
    });
  }
  draw();
  const tick = setInterval(draw, 30000);
  const off = store.on('*', (evt) => { if (['appointments', 'clients', 'settings'].includes(evt)) draw(); });
  return () => { off(); clearInterval(tick); };
}
