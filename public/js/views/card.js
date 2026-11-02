// SanoCortes — Tarjeta digital pública del cliente: /tarjeta/CODIGO (sin sesión)
import { getCard } from '../store.js';
import { esc, fmtDate, todayKey, fromKey, waLink, applyLocale } from '../utils.js';
import { icon } from '../icons.js';
import { qrDataURL } from '../shared.js';

const days = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);

export async function mount(root) {
  document.title = 'Mi tarjeta · SanoCortes';
  const code = (/\/tarjeta\/([A-Z0-9]+)/i.exec(location.pathname)?.[1] || '').toUpperCase();
  root.innerHTML = '<div class="pcard-page"><div class="empty"><div class="spinner"></div></div></div>';
  let c = null;
  try { c = code ? await getCard(code) : null; } catch (e) { console.error(e); }
  if (!c) {
    root.innerHTML = `<div class="pcard-page"><div class="mcard mcard-err"><img src="/assets/logo.svg" alt="" width="64"><h1>Tarjeta no encontrada</h1><p>El código <b>${esc(code || '—')}</b> no existe o fue renovado. Pide tu tarjeta actualizada en tu barbería.</p><a class="btn btn-primary" href="/">Ir a SanoCortes</a></div></div>`;
    return;
  }
  try { applyLocale(c.country || 'VE'); } catch (_) {}
  const qr = await qrDataURL(location.origin + '/tarjeta/' + code, 6);
  const t = todayKey();
  const L = c.loyalty;
  const n = L ? Math.min(Number(c.stamps) || 0, L.every) : 0;
  const club = c.club && c.club.end >= t ? c.club : null;
  const since = c.lastVisitAt ? days(c.lastVisitAt.slice(0, 10), t) : null;
  const due = since != null && c.avgDays ? since >= c.avgDays - 2 : false;
  const book = c.bookingSlug ? `/reservar/${encodeURIComponent(c.bookingSlug)}` : '';
  const wa = c.shopPhone ? waLink(c.shopPhone, `Hola, soy ${c.name} (${c.number}). Quiero agendar un corte.`) : '';

  root.innerHTML = `<div class="pcard-page">
    <div class="mcard">
      <div class="mcard-top"><img src="/assets/logo.svg" alt=""><div class="grow"><b>${esc(c.shop || 'Mi barbería')}</b><small>Tarjeta de cliente</small></div>${c.active ? (club ? `<span class="mcard-badge tone-violet">${icon('crown')} Club</span>` : '') : '<span class="mcard-badge tone-neutral">Inactiva</span>'}</div>
      <div class="mcard-name">${esc(c.name)}</div>
      <div class="mcard-num">${esc(c.number)} · ${esc(code)}</div>
      ${c.next ? `<div class="mcard-next">${icon('calendar')}<div><small>Tu próxima cita</small><b>${c.next.date === t ? 'Hoy' : fmtDate(c.next.date)} a las ${esc(c.next.time)}</b><span>${esc(c.next.services)}${c.next.barber ? ' · con ' + esc(c.next.barber) : ''}</span></div></div>`
        : due ? `<div class="mcard-next due">${icon('scissors')}<div><small>¡Te toca corte!</small><b>Han pasado ${since} días</b><span>Sueles venir cada ${c.avgDays} días.</span></div></div>` : ''}
      ${L ? `<div class="mcard-stamps"><div class="between"><b>Tus sellos</b><span>${n} de ${L.every}</span></div>
        <div class="stamps stamps-lg">${Array.from({ length: L.every }, (_, i) => `<i class="${i < n ? 'on' : ''}">${i < n ? icon('scissors') : ''}</i>`).join('')}</div>
        <p>${c.rewards > 0 ? `🏆 Tienes <b>${c.rewards}</b> ${esc(L.reward.toLowerCase())} disponible(s). ¡Úsalo en tu próxima visita!` : `Te falta${L.every - n === 1 ? '' : 'n'} <b>${L.every - n}</b> para tu <b>${esc(L.reward.toLowerCase())}</b>.`}</p></div>` : ''}
      ${club ? `<div class="mcard-plan"><div><small>Club</small><b>${esc(club.name)}</b></div><div><small>Te quedan</small><b>${club.left} de ${club.visits}</b></div><div><small>Vence</small><b>${fmtDate(club.end)}</b></div></div>` : ''}
      ${c.style ? `<div class="mcard-style">${icon('scissors')}<div><small>Tu último corte</small><b>${esc(c.style)}</b></div></div>` : ''}
      <div class="mcard-stats"><div><b>${c.visits || 0}</b><small>visitas</small></div><div><b>${c.lastVisitAt ? fmtDate(c.lastVisitAt.slice(0, 10)) : '—'}</b><small>último corte</small></div>${c.barber ? `<div><b>${esc(c.barber)}</b><small>tu barbero</small></div>` : ''}</div>
      <div class="mcard-qr"><img src="${qr}" alt="QR de la tarjeta"></div>
      <p class="mcard-hint">Muestra este código al pagar para sumar tus sellos.</p>
      <div class="mcard-foot">${book ? `<a class="btn btn-primary btn-sm" href="${book}">${icon('calendar')} Reservar mi corte</a>` : ''}${wa ? `<a class="btn btn-whatsapp btn-sm" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} Escribir</a>` : ''}${c.instagram ? `<a class="btn btn-secondary btn-sm" href="https://instagram.com/${esc(c.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(c.instagram)}</a>` : ''}${c.shopAddress ? `<small>${icon('pin')} ${esc(c.shopAddress)}</small>` : ''}</div>
    </div>
    <p class="pcard-by">Hecho con <b>SanoCortes</b> · Agrega esta página a tu pantalla de inicio para tenerla siempre a mano.</p>
  </div>`;
}
