// SanoCortes — Pantalla de turnos: modo TV (sala de espera) y modo autoservicio (tablet en la entrada: "toma tu turno")
import { store } from '../store.js';
import { addWalkin, setApptStatus } from '../ops.js';
import { esc, todayKey } from '../utils.js';
import { icon } from '../icons.js';
import { requirePin } from '../auth.js';
import { waitText } from '../appt.js';
import { nowMin } from '../barber.js';

const MODE_KEY = 'sc_kiosk_mode';
const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'Cliente';
const masked = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Cliente'; };

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1320, 0.18]].forEach(([f, t]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.65);
    });
  } catch (_) {}
}

export function mount(el, { navigate }) {
  let mode = (() => { try { return localStorage.getItem(MODE_KEY) || 'tv'; } catch { return 'tv'; } })();
  let seenChair = new Set(store.inChair.map((a) => a.id));
  let flashT = null; let resetT = null;
  let form = null; // estado del autoservicio

  el.innerHTML = `<div class="tvk">
    <button class="kiosk-exit" id="k-exit" title="Salir">${icon('lock')}</button>
    <header class="tvk-head"><div class="tvk-brand"><img src="/assets/logo.svg" alt=""><div><b>${esc(store.businessName)}</b><span id="k-sub"></span></div></div>
      <div class="tvk-modes"><button data-mode="tv">${icon('tv')} Sala</button><button data-mode="self">${icon('tablet')} Toma tu turno</button></div>
      <div class="tvk-clock"><b id="k-clock"></b><span id="k-date"></span></div></header>
    <main class="tvk-main" id="k-main"></main>
    <div class="tvk-flash" id="k-flash" hidden></div>
  </div>`;
  const $ = (s) => el.querySelector(s);

  function setMode(m) {
    mode = m; try { localStorage.setItem(MODE_KEY, m); } catch (_) {}
    el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#k-sub').textContent = m === 'tv' ? 'Turnos en vivo' : 'Autoservicio';
    form = null; draw();
  }

  // ---------- Modo sala (TV) ----------
  function drawTV() {
    const nm = nowMin(); const est = store.waitEstimate();
    const barbers = store.activeBarbers.filter((b) => est[b.id] || store.inChair.some((a) => a.barberId === b.id));
    const w = store.waiting;
    const soon = store.upcomingToday.filter((a) => a.start - nm <= 90).slice(0, 6);
    $('#k-main').innerHTML = `<div class="tvk-grid">
      <section class="tvk-chairs">${barbers.length ? barbers.map((b) => {
        const a = store.inChair.find((x) => x.barberId === b.id);
        const e = est[b.id];
        const next = w.find((x) => x.barberId === b.id);
        return `<div class="tvk-chair ${a ? 'busy' : ''}" style="--bc:${b.color || 'var(--brand)'}"><div class="tvk-chair-b"><span class="bdot">${esc(b.name[0])}</span>${esc(b.name)}</div>
          ${a ? `<div class="tvk-chair-who">${a.queueNo ? `<span class="tvk-no">#${a.queueNo}</span>` : ''}${esc(masked(a.clientName))}</div><div class="tvk-chair-st">${icon('scissors')} en la silla${e ? ` · libre en ~${waitText(Math.max(0, (a.startedMin ?? nm) + (a.minutes || 30) - nm))}` : ''}</div>`
            : `<div class="tvk-chair-who free">Disponible</div><div class="tvk-chair-st">${next ? `Sigue: #${next.queueNo} ${esc(first(next.clientName))}` : e ? '¡Pasa sin esperar!' : 'Fuera de turno'}</div>`}
        </div>`;
      }).join('') : '<div class="tvk-empty">No hay barberos en turno en este momento.</div>'}</section>
      <section class="tvk-queue"><h2>${icon('clock')} En espera <span>${w.length}</span></h2>
        ${w.length ? `<ol>${w.slice(0, 9).map((a) => { const chair = store.inChair.find((x) => x.barberId === a.barberId); const ahead = w.filter((x) => x.barberId === a.barberId && (x.arrivedAt || '') < (a.arrivedAt || '')); const wait = Math.max(0, (chair ? (chair.startedMin ?? nm) + chair.minutes - nm : 0) + ahead.reduce((s, x) => s + (x.minutes || 30), 0)); return `<li><span class="tvk-no">#${a.queueNo || '—'}</span><b>${esc(masked(a.clientName))}</b><small style="color:${a.barberColor}">${esc(first(a.barberName))}</small><em>${wait ? '~' + waitText(wait) : '¡ya!'}</em></li>`; }).join('')}</ol>${w.length > 9 ? `<p class="tvk-more">y ${w.length - 9} más…</p>` : ''}` : '<div class="tvk-empty">Nadie en espera. ¡Pasa directo!</div>'}
        ${soon.length ? `<h3>${icon('calendar')} Próximas citas</h3><ul class="tvk-soon">${soon.map((a) => `<li><b>${esc(a.time)}</b> ${esc(masked(a.clientName))} <small style="color:${a.barberColor}">${esc(first(a.barberName))}</small></li>`).join('')}</ul>` : ''}
      </section></div>
      <footer class="tvk-foot">${store.settings.booking?.enabled && store.settings.booking.slug ? `${icon('globe')} Reserva tu próximo corte en <b>${esc(location.host)}/reservar/${esc(store.settings.booking.slug)}</b>` : `${icon('scissors')} Gracias por tu paciencia`}</footer>`;
  }

  // ---------- Modo autoservicio (tablet) ----------
  function drawSelf() {
    const est = store.waitEstimate();
    const any = store.firstFree();
    if (!form) form = { step: 'phone', phone: '', name: '', client: null, appt: null, services: [], barberId: 'any', result: null };
    const f = form; const main = $('#k-main');
    if (f.step === 'phone') {
      main.innerHTML = `<div class="tvk-self"><h1>¡Bienvenido! 💈</h1><p>Escribe tu número de teléfono para tomar tu turno${any ? ` · espera aprox. <b>${waitText(any.wait)}</b>` : ''}.</p>
        <div class="kiosk-display" id="k-disp">${esc(f.phone) || '&nbsp;'}</div>
        <div class="kiosk-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => `<button data-k="${k}" class="${k === 'ok' ? 'ok' : k === 'del' ? 'del' : ''}">${k === 'del' ? icon('chevronLeft') : k === 'ok' ? icon('check') : k}</button>`).join('')}</div>
        <button class="btn btn-ghost btn-lg mt" id="k-nophone">Continuar sin teléfono</button></div>`;
      main.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
        const k = b.dataset.k;
        if (k === 'del') f.phone = f.phone.slice(0, -1);
        else if (k === 'ok') return afterPhone();
        else if (f.phone.length < 14) f.phone += k;
        $('#k-disp').innerHTML = esc(f.phone) || '&nbsp;';
      });
      $('#k-nophone').onclick = () => { f.phone = ''; f.step = 'name'; draw(); };
      return;
    }
    if (f.step === 'appt') {
      const a = f.appt;
      main.innerHTML = `<div class="tvk-self"><h1>¡Hola, ${esc(first(a.clientName))}! 👋</h1><p>Tienes cita hoy a las <b>${esc(a.time)}</b> con <b>${esc(a.barberName)}</b> (${esc(a.serviceNames)}).</p>
        <button class="btn btn-success btn-xl" id="k-arrive">${icon('userCheck')} Ya llegué</button><button class="btn btn-ghost btn-lg mt" id="k-back">Volver</button></div>`;
      $('#k-arrive').onclick = async () => { try { await setApptStatus(a, 'espera'); f.result = { ...a, arrived: true }; f.step = 'done'; draw(); } catch (e) { alertMsg(e.message); } };
      $('#k-back').onclick = () => { form = null; draw(); };
      return;
    }
    if (f.step === 'name') {
      main.innerHTML = `<div class="tvk-self"><h1>¿Cómo te llamas?</h1><input class="input input-lg center" id="k-name" value="${esc(f.name)}" placeholder="Nombre y apellido" autocomplete="off" style="max-width:460px;font-size:24px">
        <div class="row mt" style="gap:10px;justify-content:center"><button class="btn btn-ghost btn-lg" id="k-back">Volver</button><button class="btn btn-primary btn-lg" id="k-next">Continuar ${icon('arrowRight')}</button></div></div>`;
      const inp = $('#k-name'); setTimeout(() => inp.focus(), 50);
      const go = () => { const v = inp.value.trim(); if (v.length < 2) { inp.classList.add('shake'); return; } f.name = v; f.step = 'service'; draw(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      $('#k-next').onclick = go; $('#k-back').onclick = () => { form = null; draw(); };
      return;
    }
    if (f.step === 'service') {
      const svcs = store.activeServices;
      main.innerHTML = `<div class="tvk-self"><h1>${f.client ? `¡Hola de nuevo, ${esc(first(f.client.name))}!` : `¡Hola, ${esc(first(f.name))}!`} ¿Qué te hacemos hoy?</h1>
        <div class="tvk-svcs">${svcs.map((s) => `<button class="tvk-svc ${f.services.includes(s.id) ? 'on' : ''}" data-s="${s.id}" style="--sc:${s.color || 'var(--brand)'}"><b>${esc(s.name)}</b><small>${s.minutes} min</small></button>`).join('')}</div>
        <div class="row mt" style="gap:10px;justify-content:center"><button class="btn btn-ghost btn-lg" id="k-back">Volver</button><button class="btn btn-primary btn-lg" id="k-next" ${f.services.length ? '' : 'disabled'}>Continuar ${icon('arrowRight')}</button></div></div>`;
      main.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { const id = b.dataset.s; f.services = f.services.includes(id) ? f.services.filter((x) => x !== id) : [...f.services, id]; draw(); });
      $('#k-next').onclick = () => { f.step = 'barber'; draw(); };
      $('#k-back').onclick = () => { form = null; draw(); };
      return;
    }
    if (f.step === 'barber') {
      const list = store.activeBarbers.filter((b) => b.walkins !== false && est[b.id]);
      main.innerHTML = `<div class="tvk-self"><h1>¿Con quién?</h1>
        <div class="tvk-barbers">
          ${any ? `<button class="tvk-barber any" data-b="any"><span class="bdot">${icon('zap')}</span><b>El primero libre</b><small>~${waitText(any.wait)}</small></button>` : ''}
          ${list.map((b) => `<button class="tvk-barber" data-b="${b.id}" style="--bc:${b.color}"><span class="bdot">${esc(b.name[0])}</span><b>${esc(b.name)}</b><small>${est[b.id].wait ? '~' + waitText(est[b.id].wait) : '¡libre ya!'}${est[b.id].queue ? ` · ${est[b.id].queue} en fila` : ''}</small>${f.client?.barberId === b.id ? '<span class="badge badge-warning">tu barbero</span>' : ''}</button>`).join('')}
        </div>${!list.length ? '<p class="tvk-empty">En este momento no hay barberos atendiendo sin cita. Pide ayuda en la recepción.</p>' : ''}
        <button class="btn btn-ghost btn-lg mt" id="k-back">Volver</button></div>`;
      main.querySelectorAll('[data-b]').forEach((b) => b.onclick = async () => {
        main.querySelectorAll('[data-b]').forEach((x) => { x.disabled = true; });
        try {
          const r = await addWalkin({ client: f.client || { name: f.name, phone: f.phone }, serviceIds: f.services, barberId: b.dataset.b, via: 'kiosco' });
          f.result = r; f.step = 'done'; draw();
        } catch (e) { alertMsg(e.message); main.querySelectorAll('[data-b]').forEach((x) => { x.disabled = false; }); }
      });
      $('#k-back').onclick = () => { f.step = 'service'; draw(); };
      return;
    }
    if (f.step === 'done') {
      const r = f.result;
      main.innerHTML = `<div class="tvk-self tvk-done">${r.arrived ? `<div class="kiosk-res-ic">${icon('check')}</div><h1>¡Listo, ${esc(first(r.clientName))}!</h1><p>Avisamos a <b>${esc(r.barberName)}</b> que llegaste. Toma asiento ☕</p>`
        : `<p>Tu turno es el</p><div class="turn-no">#${r.queueNo}</div><h2>con <b style="color:${r.barberColor}">${esc(r.barberName)}</b></h2><p>${r.wait ? `Espera aproximada: <b>${waitText(r.wait)}</b>` : '¡Pasa en un momento!'} · Toma asiento, te llamamos en la pantalla.</p>`}</div>`;
      clearTimeout(resetT); resetT = setTimeout(() => { form = null; draw(); }, 9000);
    }
  }
  async function afterPhone() {
    const f = form; const d = f.phone.replace(/\D/g, '');
    if (d.length < 7) { $('#k-disp').classList.add('shake'); setTimeout(() => $('#k-disp')?.classList.remove('shake'), 500); return; }
    const c = store.findByPhone(f.phone);
    if (c) {
      f.client = c; f.name = c.name;
      const t = todayKey();
      const a = store.appointments.find((x) => x.clientId === c.id && x.date === t && ['reservada', 'confirmada'].includes(x.status));
      if (a) { f.appt = a; f.step = 'appt'; draw(); return; }
      f.services = (c.lastServiceIds || []).filter((id) => store.service(id));
      f.step = 'service';
    } else f.step = 'name';
    draw();
  }
  function alertMsg(msg) {
    const fl = $('#k-flash'); fl.hidden = false; fl.className = 'tvk-flash err'; fl.innerHTML = `<div>${icon('alert')}<b>${esc(msg)}</b></div>`;
    clearTimeout(flashT); flashT = setTimeout(() => { fl.hidden = true; }, 3500);
  }

  // ---------- Llamado: alguien pasa a la silla ----------
  function checkCalls() {
    const now = store.inChair;
    const fresh = now.filter((a) => !seenChair.has(a.id));
    seenChair = new Set(now.map((a) => a.id));
    if (!fresh.length || mode !== 'tv') return;
    const a = fresh[0];
    const fl = $('#k-flash'); fl.hidden = false; fl.className = 'tvk-flash';
    fl.innerHTML = `<div style="--bc:${a.barberColor}"><span>${a.queueNo ? `Turno #${a.queueNo}` : 'Cita de las ' + esc(a.time)}</span><b>${esc(masked(a.clientName))}</b><em>${icon('scissors')} pasa con ${esc(a.barberName)}</em></div>`;
    chime();
    clearTimeout(flashT); flashT = setTimeout(() => { fl.hidden = true; }, 7000);
  }

  function draw() { if (mode === 'tv') drawTV(); else drawSelf(); }
  const clock = () => {
    const d = new Date();
    $('#k-clock').textContent = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    $('#k-date').textContent = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $('#k-exit').onclick = async () => { if (await requirePin('Salir de la pantalla de turnos', { always: true })) navigate('turnos'); };
  clock(); setMode(mode);
  const tick = setInterval(() => { clock(); if (mode === 'tv') drawTV(); }, 20000);
  const off = store.on('*', (evt) => { if (evt === 'appointments') { checkCalls(); if (mode === 'tv') drawTV(); } if (evt === 'settings' && mode === 'tv') drawTV(); });
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch (_) {}
  return () => { off(); clearInterval(tick); clearTimeout(flashT); clearTimeout(resetT); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {} };
}
