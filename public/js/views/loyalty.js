// SanoCortes — Fidelizar: a quién escribirle hoy para que vuelva (les toca, perdidos, cumpleaños, club, premios, saldos)
import { store } from '../store.js';
import { esc, usd, fmtDate, toast, emptyState, nowISO, todayKey } from '../utils.js';
import { icon } from '../icons.js';
import { waClient, BOOK_URL, qrDataURL } from '../shared.js';
import { avatar, hydratePhotos, openClient, clientLine, clubModal, payDebtModal } from '../client.js';
import { apptForm } from '../appt.js';

const TABS = {
  toca: ['Les toca corte', 'scissors'],
  perdidos: ['Perdidos', 'userX'],
  cumple: ['Cumpleaños', 'gift'],
  club: ['Club por vencer', 'crown'],
  premios: ['Premios', 'star'],
  saldos: ['Saldos', 'wallet'],
  reservas: ['Reserva en línea', 'calendar']
};

const contactedToday = (c, kind) => (c.contacted?.[kind] || '').slice(0, 10) === todayKey();
const contactedRecently = (c, kind, days) => c.contacted?.[kind] && (Date.now() - new Date(c.contacted[kind]).getTime()) < days * 864e5;

export function mount(el, { navigate }) {
  let tab = 'toca'; let hideDone = true;
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Fidelizar</h1><p class="view-sub">Un mensaje a tiempo llena la agenda: el sistema te dice a quién escribirle hoy y el texto ya va listo.</p></div></div>
    <div class="kpis" id="l-kpis"></div>
    <div class="card card-flush mt-lg"><div class="tabs" id="l-tabs" style="padding:8px 12px 0"></div><div id="l-body" style="padding:14px"></div></div>`;
  const $ = (s) => el.querySelector(s);

  const lists = () => {
    const t = todayKey();
    return {
      toca: store.dueClients,
      perdidos: store.lostClients,
      cumple: store.birthdaysWithin(7),
      club: store.clubExpiring(5),
      premios: store.liveClients.filter((c) => Number(c.rewards) > 0 || (store.loyalty.enabled && (Number(c.stamps) || 0) >= store.loyalty.every - 1)).sort((a, b) => (b.rewards || 0) - (a.rewards || 0) || (b.stamps || 0) - (a.stamps || 0)),
      saldos: store.debtors,
      _t: t
    };
  };

  function kpis(L) {
    $('#l-kpis').innerHTML = [
      ['scissors', 'Les toca corte', L.toca.length, 'sin cita agendada', 'warning'],
      ['userX', 'Perdidos', L.perdidos.length, 'más de 3 ciclos sin venir', 'danger'],
      ['gift', 'Cumpleaños', L.cumple.filter((c) => c.inDays === 0).length, `${L.cumple.length} esta semana`, 'violet'],
      ['crown', 'Club por vencer', L.club.length, 'renovar a tiempo', 'info'],
      ['wallet', 'Por cobrar', usd(store.totalDebt), `${L.saldos.length} cliente(s)`, 'neutral']
    ].map(([ic, l, v, s, tone]) => `<div class="card kpi"><div class="kpi-top"><span class="kpi-label">${l}</span><span class="kpi-icon tone-${tone}">${icon(ic)}</span></div><div class="kpi-value">${v}</div><div class="kpi-sub">${s}</div></div>`).join('');
  }

  const row = (c, { kind, text, extraBtns = '', done }) => `<div class="list-item ${done ? 'is-done' : ''}">${avatar(c)}
    <button class="grow linkish" data-open="${c.id}" style="min-width:0;text-align:left"><b class="ellipsis">${esc(c.name)}</b><div class="t-sub ellipsis">${text}</div></button>
    ${done ? `<span class="badge badge-success">${icon('check')} avisado</span>` : ''}
    <div class="row" style="gap:4px;flex-wrap:nowrap">${extraBtns}${c.phone ? `<button class="btn btn-whatsapp btn-sm" data-wa="${c.id}" data-kind="${kind}">${icon('whatsapp')} Escribir</button>` : '<span class="badge badge-neutral">sin teléfono</span>'}</div></div>`;

  function draw() {
    const L = lists();
    kpis(L);
    const counts = { toca: L.toca.length, perdidos: L.perdidos.length, cumple: L.cumple.length, club: L.club.length, premios: L.premios.length, saldos: L.saldos.length, reservas: '' };
    $('#l-tabs').innerHTML = Object.entries(TABS).map(([k, [l, ic]]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${icon(ic)} ${l}${counts[k] !== '' && counts[k] ? ` <span class="count">${counts[k]}</span>` : ''}</button>`).join('');
    el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(); });
    const body = $('#l-body');

    if (tab === 'reservas') return drawBooking(body);

    let items = []; let intro = ''; let kind = tab;
    const toggle = `<label class="check small"><input type="checkbox" id="l-hide" ${hideDone ? 'checked' : ''}> Ocultar a los que ya avisé</label>`;
    if (tab === 'toca') {
      kind = 'le_toca';
      intro = `Clientes que ya pasaron su ciclo de corte (su promedio real o ${store.settings.cycleDays} días) y <b>no tienen cita</b>. Escríbeles con el enlace de reserva.`;
      items = L.toca.filter((c) => !hideDone || !contactedRecently(c, kind, 5)).map((c) => {
        const d = store.daysSince(c);
        return row(c, { kind, text: `${clientLine(c)} · ${d - store.cycleOf(c) > 0 ? `<b class="text-danger">${d - store.cycleOf(c)} día${d - store.cycleOf(c) === 1 ? "" : "s"} tarde</b>` : '<b class="text-warning">le toca ya</b>'}${c.barberId && store.barber(c.barberId) ? ' · con ' + esc(store.barber(c.barberId).name) : ''}`, done: contactedRecently(c, kind, 5), extraBtns: `<button class="btn btn-secondary btn-sm" data-appt="${c.id}">${icon('calendar')} Agendar</button>` });
      });
    } else if (tab === 'perdidos') {
      kind = 'perdido';
      intro = 'Hace mucho no vienen. Un mensaje con una promoción de regreso recupera a muchos. Edita la oferta abajo.';
      items = L.perdidos.filter((c) => !hideDone || !contactedRecently(c, kind, 30)).map((c) => row(c, { kind, text: `${clientLine(c)} · ${c.visits || 0} visita(s) · gastó ${usd(c.totalSpent || 0)}`, done: contactedRecently(c, kind, 30) }));
    } else if (tab === 'cumple') {
      kind = 'cumple';
      intro = 'Cumpleaños de hoy y los próximos 7 días. El saludo con un regalo trae al cliente esa misma semana.';
      items = L.cumple.filter((c) => !hideDone || !contactedRecently(c, kind, 20)).map((c) => row(c, { kind, text: `${c.inDays === 0 ? '<b class="text-success">¡Hoy!</b>' : c.inDays === 1 ? 'Mañana' : `En ${c.inDays} días`} · ${c.birthDate.slice(8, 10)}/${c.birthDate.slice(5, 7)}`, done: contactedRecently(c, kind, 20) }));
    } else if (tab === 'club') {
      kind = 'club';
      intro = 'Planes prepagados que vencen en 5 días, que ya vencieron o a los que les queda 1 servicio.';
      items = L.club.filter((c) => !hideDone || !contactedRecently(c, kind, 5)).map((c) => row(c, { kind, text: `${esc(c.membership.name)} · ${c._expired ? `<b class="text-danger">venció ${fmtDate(c.membership.end)}</b>` : `vence ${fmtDate(c.membership.end)}`} · le quedan ${c.membership.left}`, done: contactedRecently(c, kind, 5), extraBtns: `<button class="btn btn-secondary btn-sm" data-club="${c.id}">${icon('refresh')} Renovar</button>` }));
    } else if (tab === 'premios') {
      kind = 'premio';
      intro = store.loyalty.enabled ? `Cada ${store.loyalty.every} servicios pagados el cliente gana <b>${esc(store.loyalty.reward)}</b>. Aquí están los que ya lo ganaron y los que están a 1 sello.` : 'La tarjeta de sellos está desactivada. Actívala en Ajustes → Fidelidad.';
      items = L.premios.filter((c) => !hideDone || !contactedRecently(c, kind, 7)).map((c) => row(c, { kind: Number(c.rewards) > 0 ? 'premio' : 'tarjeta', text: Number(c.rewards) > 0 ? `<b class="text-success">${c.rewards} premio(s) disponible(s)</b>` : `${c.stamps} de ${store.loyalty.every} sellos · le falta 1`, done: contactedRecently(c, kind, 7) }));
    } else if (tab === 'saldos') {
      kind = 'deuda';
      intro = `Clientes con saldo pendiente: total ${usd(store.totalDebt)}.`;
      items = L.saldos.filter((c) => !hideDone || !contactedRecently(c, kind, 3)).map((c) => row(c, { kind, text: `Debe <b class="text-danger">${usd(c.balance)}</b> · ${clientLine(c)}`, done: contactedRecently(c, kind, 3), extraBtns: `<button class="btn btn-secondary btn-sm" data-debt="${c.id}">${icon('cash')} Abonar</button>` }));
    }

    const offer = tab === 'perdidos' || tab === 'cumple'
      ? `<div class="field mt-sm"><label class="label">Oferta que va en el mensaje</label><input class="input" id="l-offer" value="${esc(store.settings[tab === 'cumple' ? 'birthdayOffer' : 'comebackOffer'] || (tab === 'cumple' ? 'Tu regalo: la barba gratis con tu próximo corte este mes.' : 'Esta semana tienes un 10 % de descuento en tu corte.'))}"></div>` : '';
    body.innerHTML = `<div class="between" style="gap:10px;flex-wrap:wrap"><p class="small muted" style="margin:0;max-width:720px">${intro}</p>${toggle}</div>${offer}
      <div class="list mt-md">${items.join('') || emptyState('check', 'Nada pendiente aquí', 'Buen trabajo: no hay clientes por avisar en esta lista.')}</div>`;
    $('#l-hide').onchange = (e) => { hideDone = e.target.checked; draw(); };
    const offerIn = $('#l-offer');
    if (offerIn) offerIn.onchange = () => store.save('config', 'settings', { [tab === 'cumple' ? 'birthdayOffer' : 'comebackOffer']: offerIn.value.trim() });
    body.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openClient(b.dataset.open));
    body.querySelectorAll('[data-appt]').forEach((b) => b.onclick = () => apptForm({ client: store.client(b.dataset.appt) }));
    body.querySelectorAll('[data-club]').forEach((b) => b.onclick = () => clubModal(store.client(b.dataset.club)));
    body.querySelectorAll('[data-debt]').forEach((b) => b.onclick = () => payDebtModal(store.client(b.dataset.debt)));
    body.querySelectorAll('[data-wa]').forEach((b) => b.onclick = async () => {
      const c = store.client(b.dataset.wa); const k = b.dataset.kind;
      let extra = '';
      if (k === 'le_toca') extra = String(Math.max(1, Math.round((store.daysSince(c) || 21) / 7)));
      if (k === 'perdido' || k === 'cumple') extra = offerIn?.value.trim() || '';
      waClient(k, { client: c, extra });
      await store.save('clients', c.id, { contacted: { ...(c.contacted || {}), [kind]: nowISO() } });
    });
    hydratePhotos(body, 60);
  }

  async function drawBooking(body) {
    const url = BOOK_URL();
    const bk = store.settings.booking;
    body.innerHTML = `<div class="grid-2"><div>
      <h3 style="margin:0 0 6px">Tu página de reservas</h3>
      <p class="small muted">Tus clientes eligen el servicio, el barbero y la hora libre desde el teléfono. Las solicitudes llegan a la Agenda${bk.autoAccept ? ' y se aceptan solas si el espacio está libre' : ' para que las aceptes con un toque'}.</p>
      ${url ? `<div class="box"><div class="small muted">Enlace</div><div class="row" style="gap:6px"><input class="input input-sm grow" readonly value="${esc(url)}" id="l-url"><button class="btn btn-secondary btn-sm" id="l-copy">${icon('copy')} Copiar</button><a class="btn btn-secondary btn-sm" href="${esc(url)}" target="_blank" rel="noopener">${icon('external')} Abrir</a></div></div>
        <div class="row mt-md" style="gap:8px;flex-wrap:wrap"><button class="btn btn-whatsapp" id="l-share">${icon('whatsapp')} Compartir por WhatsApp</button><button class="btn btn-secondary" id="l-bulk">${icon('users')} Enviar a mis clientes</button></div>
        <p class="small muted mt-md">Pon el código QR en el espejo, en la recepción o en tus redes: quien lo escanee reserva al instante.</p>`
        : `<div class="box">${emptyState('calendar', 'La reserva en línea está apagada', 'Actívala en Ajustes → Reserva en línea.')}<button class="btn btn-primary btn-block mt-sm" id="l-go">${icon('settings')} Ir a Ajustes</button></div>`}
    </div><div class="center" id="l-qr"></div></div>`;
    const go = body.querySelector('#l-go');
    if (go) go.onclick = () => navigate('ajustes', { params: { tab: 'reserva' } });
    if (!url) return;
    body.querySelector('#l-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { body.querySelector('#l-url').select(); } };
    body.querySelector('#l-share').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(`💈 Reserva tu corte en *${store.businessName}* eligiendo barbero y hora: ${url}`), '_blank', 'noopener');
    body.querySelector('#l-bulk').onclick = () => bulkSend();
    const qr = await qrDataURL(url, 6);
    const box = body.querySelector('#l-qr');
    if (box) box.innerHTML = `<div class="qr-box"><img src="${qr}" alt="QR de reservas" style="width:220px;height:220px;image-rendering:pixelated"><div class="small mt-sm"><b>${esc(store.businessName)}</b><br>Escanea y reserva tu corte</div><a class="btn btn-secondary btn-sm mt-sm" download="qr-reservas.png" href="${qr}">${icon('download')} Descargar QR</a></div>`;
  }

  function bulkSend() {
    const list = store.liveClients.filter((c) => c.phone && !contactedRecently(c, 'reservas', 60));
    if (!list.length) return toast('Todos tus clientes con teléfono ya recibieron el enlace', 'info');
    let i = 0;
    const next = async () => {
      const c = list[i++];
      if (!c) return toast('Listo: enviaste el enlace a todos');
      waClient('reservas', { client: c });
      await store.save('clients', c.id, { contacted: { ...(c.contacted || {}), reservas: nowISO() } });
      if (i < list.length) toast(`Enviado a ${c.name}. Toca de nuevo “Enviar a mis clientes” para el siguiente (${list.length - i} restantes).`, 'info', 4000);
    };
    next();
  }

  draw();
  const off = store.on('*', (evt) => { if (['clients', 'appointments', 'settings'].includes(evt)) { if (tab !== 'reservas') draw(); } });
  return off;
}
