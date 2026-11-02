// SanoCortes — Página pública de reservas: /reservar/SLUG (sin sesión)
// El cliente elige servicio, barbero (o el primero libre), día y hora libre; se crea una solicitud que llega a la agenda.
import { getBookingPage } from '../store.js';
import { db, collection, addDoc } from '../firebase.js';
import { esc, waLink, applyLocale, usd, dayKey, addDays, fromKey } from '../utils.js';
import { icon } from '../icons.js';
import { freeSlots, minToTime, toMin } from '../barber.js';

const LS = 'sc_book_me';
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export async function mount(root) {
  const slug = (/\/reservar\/([a-z0-9-]+)/i.exec(location.pathname)?.[1] || '').toLowerCase();
  root.innerHTML = '<div class="bk-page"><div class="empty"><div class="spinner"></div></div></div>';
  let B = null;
  try { B = slug ? await getBookingPage(slug) : null; } catch (e) { console.error(e); }
  if (!B) {
    document.title = 'Reservas · SanoCortes';
    root.innerHTML = `<div class="bk-page"><div class="mcard mcard-err"><img src="/assets/logo.svg" alt="" width="64"><h1>Página no encontrada</h1><p>El enlace de reservas <b>${esc(slug || '—')}</b> no existe o cambió. Pide el enlace actualizado a tu barbería.</p><a class="btn btn-primary" href="/">Ir a SanoCortes</a></div></div>`;
    return;
  }
  try { applyLocale(B.country || 'VE'); } catch (_) {}
  document.title = `Reserva tu corte · ${B.shop || 'Barbería'}`;
  const wa = (text) => (B.phone ? waLink(B.phone, text) : '');
  let me = {}; try { me = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) {}

  const st = { step: 1, services: [], barberId: '', date: '', time: '', name: me.name || '', phone: me.phone || '', note: '', sending: false, done: null, err: '' };
  const svcList = B.services || [];
  const sel = () => svcList.filter((s) => st.services.includes(s.id));
  const minutes = () => sel().reduce((a, s) => a + (Number(s.minutes) || 30), 0) || 30;
  const total = () => sel().reduce((a, s) => a + (Number(s.price) || 0), 0);
  const busyFor = (date, bid) => { const f = B.busy?.[date]?.[bid] || []; const out = []; for (let i = 0; i + 1 < f.length; i += 2) out.push([f[i], f[i + 1]]); return out; };
  const minFrom = (date) => {
    const now = new Date(); const t = dayKey(now);
    if (date !== t) return 0;
    return now.getHours() * 60 + now.getMinutes() + (Number(B.leadMinutes) || 0);
  };
  const leadDays = () => Math.floor((Number(B.leadMinutes) || 0) / 1440);
  /** Horarios libres de un día: { minuto: [barberos libres] } */
  function slotsOn(date) {
    const wd = fromKey(date).getDay();
    const map = new Map();
    const list = st.barberId && st.barberId !== 'any' ? (B.barbers || []).filter((b) => b.id === st.barberId) : (B.barbers || []);
    const mf = Math.max(minFrom(date), date === dayKey(new Date()) ? 0 : 0);
    for (const b of list) {
      for (const t of freeSlots({ barber: b, schedule: B.schedule, weekday: wd, busy: busyFor(date, b.id), minutes: minutes(), step: Number(B.step) || 15, minFrom: mf })) {
        if (!map.has(t)) map.set(t, []);
        map.get(t).push(b.id);
      }
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }
  const dates = () => { const out = []; for (let i = leadDays(); i <= (Number(B.daysAhead) || 14); i++) out.push(dayKey(addDays(new Date(), i))); return out; };

  function header() {
    return `<header class="bk-head"><img src="/assets/logo.svg" alt=""><div class="grow"><b>${esc(B.shop || 'Barbería')}</b><small>${B.address ? `${icon('pin')} ${esc(B.address)}` : 'Reserva tu corte en línea'}</small></div>${B.phone ? `<a class="btn btn-whatsapp btn-icon" href="${wa('Hola, quiero información para reservar un corte.')}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>` : ''}</header>`;
  }
  function steps() {
    const L = ['Servicio', 'Barbero', 'Día y hora', 'Tus datos'];
    return `<div class="bk-steps">${L.map((l, i) => `<button class="${st.step === i + 1 ? 'on' : st.step > i + 1 ? 'done' : ''}" data-go="${i + 1}" ${st.step > i + 1 ? '' : 'disabled'}><span>${st.step > i + 1 ? icon('check') : i + 1}</span>${l}</button>`).join('')}</div>`;
  }
  function summary() {
    const b = (B.barbers || []).find((x) => x.id === st.barberId);
    return sel().length ? `<div class="bk-sum">${icon('scissors')}<div class="grow"><b>${esc(sel().map((s) => s.name).join(' + '))}</b><small>${minutes()} min${st.barberId ? ' · ' + (b ? 'con ' + esc(b.name) : 'el primero libre') : ''}${st.date && st.time ? ` · ${niceDate(st.date)} ${st.time}` : ''}</small></div><b>${usd(total())}</b></div>` : '';
  }
  const niceDate = (d) => { const x = fromKey(d); const t = dayKey(new Date()); const tm = dayKey(addDays(new Date(), 1)); return d === t ? 'Hoy' : d === tm ? 'Mañana' : `${DOW[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]}`; };

  function draw() {
    if (B.enabled === false) {
      root.innerHTML = `<div class="bk-page">${header()}<div class="bk-card center"><h2>Reservas en línea pausadas</h2><p class="muted">Por ahora agenda tu cita por WhatsApp.</p>${B.phone ? `<a class="btn btn-whatsapp btn-lg" href="${wa('Hola, quiero agendar un corte.')}" target="_blank" rel="noopener">${icon('whatsapp')} Escribir por WhatsApp</a>` : ''}</div>${foot()}</div>`;
      return;
    }
    if (st.done) return drawDone();
    let body = '';
    if (st.step === 1) {
      const cats = [...new Set(svcList.map((s) => s.category || 'Servicios'))];
      body = `<h2>¿Qué te hacemos?</h2><p class="muted small">Puedes elegir más de uno (ej.: corte + barba).</p>
        ${cats.map((c) => `<div class="bk-cat">${esc(c)}</div><div class="bk-svcs">${svcList.filter((s) => (s.category || 'Servicios') === c).map((s) => `<button class="bk-svc ${st.services.includes(s.id) ? 'on' : ''}" data-s="${s.id}"><span class="bk-check">${icon('check')}</span><span class="grow"><b>${esc(s.name)}</b><small>${icon('clock')} ${s.minutes} min</small></span><b>${usd(s.price)}</b></button>`).join('')}</div>`).join('') || '<p class="muted">Esta barbería aún no publicó sus servicios.</p>'}
        <button class="btn btn-primary btn-lg btn-block bk-next" data-next ${st.services.length ? '' : 'disabled'}>Continuar ${icon('arrowRight')}</button>`;
    } else if (st.step === 2) {
      body = `<h2>¿Con quién?</h2><div class="bk-barbers">
        <button class="bk-barber ${st.barberId === 'any' ? 'on' : ''}" data-b="any"><span class="bdot">${icon('zap')}</span><span class="grow"><b>El primero disponible</b><small>Más horarios para elegir</small></span></button>
        ${(B.barbers || []).map((b) => `<button class="bk-barber ${st.barberId === b.id ? 'on' : ''}" data-b="${b.id}" style="--bc:${b.color || 'var(--brand)'}"><span class="bdot">${esc(b.name[0])}</span><span class="grow"><b>${esc(b.name)}</b><small>${esc(b.specialty || 'Barbero')}${b.days?.length ? ' · ' + b.days.slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => DOW[d]).join(' ') : ''}</small></span></button>`).join('')}
      </div>`;
    } else if (st.step === 3) {
      const ds = dates();
      if (!st.date) st.date = ds.find((d) => slotsOn(d).length) || ds[0];
      const slots = slotsOn(st.date);
      const parts = [['Mañana', 0, 12 * 60], ['Tarde', 12 * 60, 18 * 60], ['Noche', 18 * 60, 24 * 60]];
      body = `<h2>¿Cuándo?</h2><div class="bk-days">${ds.map((d) => { const n = slotsOn(d).length; const x = fromKey(d); return `<button class="bk-day ${st.date === d ? 'on' : ''}" data-d="${d}" ${n ? '' : 'disabled'}><small>${d === dayKey(new Date()) ? 'Hoy' : DOW[x.getDay()]}</small><b>${x.getDate()}</b><small>${MON[x.getMonth()]}</small></button>`; }).join('')}</div>
        ${slots.length ? parts.map(([l, a, z]) => { const s = slots.filter(([t]) => t >= a && t < z); return s.length ? `<div class="bk-cat">${l}</div><div class="bk-slots">${s.map(([t]) => `<button class="slot-btn ${st.time === minToTime(t) ? 'on' : ''}" data-t="${minToTime(t)}">${minToTime(t)}</button>`).join('')}</div>` : ''; }).join('')
          : `<div class="bk-empty">${icon('calendar')}<b>No hay horarios libres este día</b><span>Prueba otro día${st.barberId !== 'any' ? ' o elige “El primero disponible”' : ''}.</span></div>`}
        <button class="btn btn-primary btn-lg btn-block bk-next" data-next ${st.time ? '' : 'disabled'}>Continuar ${icon('arrowRight')}</button>`;
    } else if (st.step === 4) {
      body = `<h2>Tus datos</h2><form class="stack" data-f>
        <div class="field"><label>Nombre y apellido</label><input class="input input-lg" name="name" value="${esc(st.name)}" autocomplete="name" required maxlength="60"></div>
        <div class="field"><label>WhatsApp</label><input class="input input-lg" name="phone" value="${esc(st.phone)}" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="${B.dial ? '+' + esc(B.dial) + ' ' : ''}Tu número"><span class="hint">Te confirmamos la cita por aquí.</span></div>
        <div class="field"><label>Nota para el barbero (opcional)</label><input class="input" name="note" value="${esc(st.note)}" maxlength="140" placeholder="Ej.: quiero el mismo corte de la última vez"></div>
        ${B.rules ? `<div class="box small">${icon('info')} ${esc(B.rules)}</div>` : ''}
        <div class="error-msg">${esc(st.err)}</div>
        <button class="btn btn-success btn-lg btn-block" ${st.sending ? 'disabled' : ''}>${st.sending ? 'Enviando…' : `${icon('check')} Confirmar reserva`}</button></form>`;
    }
    root.innerHTML = `<div class="bk-page">${header()}${B.note ? `<div class="bk-note">${esc(B.note)}</div>` : ''}${steps()}<div class="bk-card">${summary()}${body}</div>${foot()}</div>`;
    bind();
  }
  const foot = () => `<p class="pcard-by">Reservas con <b>SanoCortes</b>${B.demo ? ' · <b>página de demostración</b>' : ''}</p>`;

  function bind() {
    root.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { st.step = +b.dataset.go; draw(); });
    root.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { const id = b.dataset.s; st.services = st.services.includes(id) ? st.services.filter((x) => x !== id) : [...st.services, id]; st.time = ''; draw(); });
    root.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { st.barberId = b.dataset.b; st.time = ''; st.date = ''; st.step = 3; draw(); scrollTop(); });
    root.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { st.date = b.dataset.d; st.time = ''; draw(); });
    root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { st.time = b.dataset.t; draw(); root.querySelector('[data-next]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    const nx = root.querySelector('[data-next]');
    if (nx) nx.onclick = () => { st.step += 1; draw(); scrollTop(); };
    const f = root.querySelector('[data-f]');
    if (f) f.onsubmit = (e) => { e.preventDefault(); send(f.elements); };
  }
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  async function send(F) {
    st.name = F.name.value.trim().replace(/\s+/g, ' '); st.phone = F.phone.value.trim(); st.note = F.note.value.trim(); st.err = '';
    if (st.name.length < 3) { st.err = 'Escribe tu nombre y apellido.'; return draw(); }
    if (st.phone.replace(/\D/g, '').length < 7) { st.err = 'Escribe un número de WhatsApp válido.'; return draw(); }
    // Revalida que el horario siga libre y elige un barbero si fue "el primero disponible"
    const free = slotsOn(st.date).find(([t]) => minToTime(t) === st.time);
    if (!free) { st.err = 'Ese horario se acaba de ocupar. Elige otro, por favor.'; st.step = 3; st.time = ''; return draw(); }
    const barberId = st.barberId === 'any' ? 'any' : st.barberId;
    st.sending = true; draw();
    try {
      await addDoc(collection(db, 'requests'), {
        tenantId: B.tenantId, slug, name: st.name.slice(0, 60), phone: st.phone.slice(0, 20), note: st.note.slice(0, 140),
        serviceIds: st.services.slice(0, 6), serviceNames: sel().map((s) => s.name).join(' + ').slice(0, 200), minutes: minutes(), estimate: total(),
        barberId, date: st.date, time: st.time, status: 'nueva', createdAt: new Date().toISOString()
      });
      try { localStorage.setItem(LS, JSON.stringify({ name: st.name, phone: st.phone })); } catch (_) {}
      const b = (B.barbers || []).find((x) => x.id === barberId);
      st.done = { barber: b?.name || 'el primer barbero disponible', start: toMin(st.time) };
    } catch (e) {
      console.error(e);
      st.err = 'No pudimos enviar tu reserva. Revisa tu conexión e intenta de nuevo' + (B.phone ? ', o escríbenos por WhatsApp.' : '.');
    }
    st.sending = false; draw();
  }

  function drawDone() {
    const text = `Hola, acabo de reservar en línea: ${sel().map((s) => s.name).join(' + ')} el ${niceDate(st.date)} a las ${st.time} con ${st.done.barber}. Mi nombre es ${st.name}.`;
    root.innerHTML = `<div class="bk-page">${header()}<div class="bk-card center bk-done">
      <div class="kpi-icon tone-success" style="width:72px;height:72px;border-radius:24px;margin:0 auto">${icon('check')}</div>
      <h2>¡Reserva enviada!</h2>
      <p><b>${esc(niceDate(st.date))} a las ${esc(st.time)}</b><br>${esc(sel().map((s) => s.name).join(' + '))}<br>con ${esc(st.done.barber)}</p>
      <p class="muted small">La barbería confirma tu cita y te escribe por WhatsApp. Si necesitas cambiarla, avísales.</p>
      ${B.phone ? `<a class="btn btn-whatsapp btn-lg btn-block" href="${wa(text)}" target="_blank" rel="noopener">${icon('whatsapp')} Avisar por WhatsApp</a>` : ''}
      <button class="btn btn-ghost btn-block mt" id="bk-again">Hacer otra reserva</button></div>${foot()}</div>`;
    root.querySelector('#bk-again').onclick = () => { Object.assign(st, { step: 1, services: [], barberId: '', date: '', time: '', note: '', done: null }); draw(); };
  }

  draw();
}
