// SanoCortes — Componentes compartidos: país y moneda, QR, WhatsApp al cliente e impresión
import { store } from './store.js';
import { openModal, toast, num, esc, fmtDateTime, fmtDate, setBusy, usd, bs, methodLabel, qtyFmt, printHTML, todayKey, waLink, COUNTRIES, loc, flagImg, fmtTime, fromKey, dayKey, addDays } from './utils.js';
import { icon } from './icons.js';
import { styleLine } from './barber.js';

export const APP_NAME = 'SanoCortes';
export const SALES_PHONE = '584221906045';
export const SALES_PHONE_FMT = '+58 422-190 6045';
export const salesWa = (msg = 'Hola, me interesa SanoCortes para mi barbería. ¿Me pueden dar más información?') =>
  `https://wa.me/${SALES_PHONE}?text=${encodeURIComponent(msg)}`;

// ======================================================================
// PAÍS DE TRABAJO (se elige una sola vez, al entrar por primera vez)
// ======================================================================
export function openCountryPicker({ force = false } = {}) {
  return new Promise((resolve) => {
    let picked = store.settings.country || '';
    let cur = store.settings.currency || '';
    const list = Object.entries(COUNTRIES).sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
    const m = openModal({
      title: force ? '¿En qué país está tu barbería?' : 'País y moneda', size: 'md', dismissible: !force,
      sub: 'Según el país, SanoCortes trabaja con su moneda, sus formas de pago y el código telefónico para WhatsApp.',
      body: `<div class="stack"><label class="search"><svg></svg><input data-q placeholder="Buscar país…" autocomplete="off"></label><div class="country-grid" data-l></div><div data-cur></div><div class="error-msg" data-err></div></div>`,
      footer: `${force ? '' : '<button class="btn btn-secondary" data-close>Cancelar</button>'}<button class="btn btn-primary btn-lg" data-ok disabled>Continuar</button>`,
      onClose: () => resolve(picked && store.settings.country === picked ? picked : null)
    });
    m.el.querySelector('.search svg').outerHTML = icon('search');
    const draw = (qv = '') => {
      const t = qv.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      m.el.querySelector('[data-l]').innerHTML = list.filter(([, c]) => !t || c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t)).map(([k, c]) =>
        `<button type="button" class="country ${picked === k ? 'on' : ''}" data-c="${k}"><span class="flag">${flagImg(k, 24)}</span><span class="grow"><b>${esc(c.name)}</b><small>${esc(c.curName)} · ${esc(c.sym)}</small></span></button>`).join('');
      m.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { picked = b.dataset.c; cur = COUNTRIES[picked].cur; draw(m.el.querySelector('[data-q]').value); });
      const c = COUNTRIES[picked];
      m.el.querySelector('[data-cur]').innerHTML = c ? `<div class="card stack" style="padding:12px 14px"><div class="row" style="gap:10px"><span class="flag">${flagImg(picked, 30)}</span><div class="grow"><b>${esc(c.name)}</b><div class="t-sub">Formas de pago: Efectivo, tarjetas, transferencia${(c.extra || []).length ? ' y otras locales' : ''} · WhatsApp +${esc(c.dial)}</div></div></div>
        ${c.alt ? `<div class="field"><label>Moneda con la que cobras</label><div class="seg seg-block">${[[c.cur, c.curName + ' (' + c.sym + ')'], [c.alt.cur, c.alt.curName + ' (' + c.alt.sym + ')']].map(([k, l]) => `<button type="button" data-mc="${k}" class="${cur === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>` : `<div class="small">Moneda: <b>${esc(c.curName)} (${esc(c.sym)})</b></div>`}
        ${store.settings.country && store.settings.country !== picked ? `<div class="vital-alert warning">Los montos ya registrados no se convierten: revisa los precios de los servicios después de cambiar de país.</div>` : ''}</div>` : '';
      m.el.querySelectorAll('[data-mc]').forEach((b) => b.onclick = () => { cur = b.dataset.mc; draw(m.el.querySelector('[data-q]').value); });
      m.el.querySelector('[data-ok]').disabled = !picked;
    };
    m.el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      if (!picked) return;
      setBusy(e.currentTarget, true, 'Guardando…');
      try { await store.setCountry(picked, cur); toast(`Listo: trabajarás en ${loc().curName} (${loc().sym})`); m.close(); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
    draw();
  });
}

// ======================================================================
// QR
// ======================================================================
let qrLoad = null;
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLoad ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/qrcode.js';
    s.onload = () => res(window.qrcode); s.onerror = rej;
    document.head.appendChild(s);
  });
  return qrLoad;
}
export async function qrDataURL(text, cell = 4) {
  try {
    const q = await loadQR();
    const qr = q(0, 'M'); qr.addData(text); qr.make();
    return qr.createDataURL(cell, 2);
  } catch (_) { return ''; }
}

// ======================================================================
// WHATSAPP AL CLIENTE
// ======================================================================
const BASE = 'https://sano-cortes.web.app';
export const CARD_URL = (c) => (c?.cardCode ? `${BASE}/tarjeta/${c.cardCode}` : '');
export const BOOK_URL = () => (store.settings.booking?.enabled && store.settings.booking.slug ? `${BASE}/reservar/${store.settings.booking.slug}` : '');
export function whenText(date, time) {
  const t = todayKey();
  const tomorrow = dayKey(addDays(new Date(), 1));
  const d = date === t ? '*hoy*' : date === tomorrow ? '*mañana*' : `el *${fromKey(date).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}*`;
  return `${d} a las *${time}*`;
}
export function clientMessage(kind, { client = {}, appt = null, extra = '' } = {}) {
  const name = String(client.name || appt?.clientName || '').split(' ')[0];
  const biz = store.businessName;
  const addr = store.settings.address ? `\n📍 ${store.settings.address}` : '';
  const card = CARD_URL(client);
  const book = BOOK_URL();
  const h = `Hola ${name} 👋, te escribimos de *${biz}* 💈.`;
  const L = store.loyalty;
  const left = L?.enabled ? Math.max(0, (Number(L.every) || 10) - (Number(client.stamps) || 0)) : 0;
  const T = {
    confirmar: () => `${h}\n\n✅ Tu cita quedó agendada ${whenText(appt.date, appt.time)} con *${appt.barberName}*.\n✂️ ${appt.serviceNames}${appt.estimate ? ` · ${usd(appt.estimate)}` : ''}${addr}\n\nSi no puedes venir, avísanos por aquí para darle el espacio a otro cliente. ¡Te esperamos!`,
    recordatorio: () => `${h}\n\n⏰ Te recordamos tu cita ${whenText(appt.date, appt.time)} con *${appt.barberName}* (${appt.serviceNames}).${addr}\n\n¿Nos confirmas tu asistencia? Responde *SÍ* o avísanos si necesitas cambiar la hora.`,
    turno: () => `${h}\n\n🪑 Tu turno es el *#${appt.queueNo}* con *${appt.barberName}*. ${extra ? `Te toca en aproximadamente *${extra}*.` : '¡Ya casi es tu turno!'}\n\nTe avisamos por aquí cuando estés por pasar.`,
    tu_turno: () => `${h}\n\n🔔 *¡Es tu turno!* Te espera *${appt.barberName}* en la silla. ✂️`,
    gracias: () => `¡Gracias por tu visita, ${name}! 🙌💈\n\nQuedaste impecable.${L?.enabled ? `\n⭐ Llevas *${client.stamps || 0}* de *${L.every}* sellos${client.rewards ? ` y tienes *${client.rewards}* ${L.reward.toLowerCase()} disponible(s)` : ` · te faltan ${left} para tu ${L.reward.toLowerCase()}`}.` : ''}${card ? `\n\n📲 Tu tarjeta: ${card}` : ''}${book ? `\n📅 Agenda tu próximo corte: ${book}` : ''}`,
    le_toca: () => `${h}\n\n✂️ Ya van *${extra || 'unas'}* semanas desde tu último corte: ¡te toca refrescar el look!${book ? `\n\n📅 Reserva en 30 segundos: ${book}` : '\n\n¿Te apartamos una hora? Dinos qué día te queda mejor.'}${client.barberId && store.barber(client.barberId) ? `\nTu barbero de siempre, *${store.barber(client.barberId).name}*, tiene espacios esta semana.` : ''}`,
    perdido: () => `${h}\n\n¡Te extrañamos en la barbería! 😅 Hace tiempo no te vemos.${extra ? `\n\n🎁 ${extra}` : '\n\n🎁 Esta semana tienes un *10 % de descuento* en tu corte.'}${book ? `\n📅 Reserva aquí: ${book}` : ''}`,
    cumple: () => `🎉 ¡Feliz cumpleaños, ${name}! 🎂\n\nTodo el equipo de *${biz}* te desea un gran día.${extra ? `\n\n🎁 ${extra}` : '\n\n🎁 Tu regalo: la barba gratis con tu próximo corte este mes.'}${book ? `\n📅 ${book}` : ''}`,
    premio: () => `${h}\n\n🏆 ¡Completaste tu tarjeta de sellos! Tienes *${client.rewards || 1}* ${L?.reward?.toLowerCase() || 'premio'} esperándote.${book ? `\n📅 Úsalo cuando quieras: ${book}` : ''}`,
    club: () => `${h}\n\n👑 Tu plan *${client.membership?.name || ''}* ${client.membership && client.membership.end < todayKey() ? `venció el ${fmtDate(client.membership.end)}` : `vence el *${fmtDate(client.membership?.end)}*`}${client.membership ? ` (te quedan ${client.membership.left} servicio(s))` : ''}.\n\nRenuévalo y sigue ahorrando en cada corte. ¿Te lo dejamos listo?`,
    deuda: () => `${h}\n\nTe recordamos que tienes un saldo pendiente de *${usd(client.balance || extra)}*. Puedes cancelarlo en tu próxima visita o por transferencia. ¡Gracias!`,
    tarjeta: () => `${h}\n\n📲 Esta es tu tarjeta de cliente: ${card}\n\nAhí ves tus sellos${L?.enabled ? ` (cada ${L.every} cortes, ${L.reward.toLowerCase()})` : ''}, tu próxima cita y el estilo de tu último corte.${book ? `\n📅 Reserva: ${book}` : ''}`,
    reservas: () => `${h}\n\n📅 Ahora puedes reservar tu corte en línea, eligiendo barbero y hora: ${book}\n\nSin esperas y sin llamar. ¡Te esperamos!`,
    libre: () => `${h}\n\n${extra || ''}`
  };
  return (T[kind] || T.libre)();
}
export function waClient(kind, ctx = {}) {
  const phone = ctx.client?.phone || ctx.appt?.clientPhone || '';
  const text = clientMessage(kind, ctx);
  window.open(phone ? waLink(phone, text) : 'https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

// ======================================================================
// IMPRESIÓN: recibos y documentos genéricos
// ======================================================================
export const PRINT_HEAD = '<meta charset="utf-8"><meta name="color-scheme" content="light"><style>:root{color-scheme:light}html,body{background:#fff;color:#000}</style>';
function ticketCSS(fmt) {
  const width = fmt === '58mm' ? '200px' : fmt === 'carta' ? '100%' : '290px';
  const font = fmt === 'carta' ? '13px' : fmt === '58mm' ? '10.5px' : '11.5px';
  return `@page { margin: ${fmt === 'carta' ? '12mm' : '2mm'}; }
    body { font-family: ${fmt === 'carta' ? 'Arial, Helvetica, sans-serif' : "'Courier New', monospace"}; font-size: ${font}; width: ${width}; margin: 0 auto; color: #000; }
    .c { text-align: center; } .b { font-weight: bold; } .hr { border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; } .r { text-align: right; white-space: nowrap; padding-left: 6px; }
    .big { font-size: 1.25em; font-weight: bold; } .sm { font-size: .85em; }`;
}
function headerHTML() {
  const s = store.settings;
  return `<div class="c b" style="font-size:1.3em">${esc(store.businessName)}</div>
    ${s.rif ? `<div class="c">${esc(loc().tax)}: ${esc(s.rif)}</div>` : ''}
    ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}
    ${s.phone ? `<div class="c">Tel: ${esc(s.phone)}</div>` : ''}
    ${s.instagram ? `<div class="c">${esc(s.instagram)}</div>` : ''}`;
}

/** Recibo de cobro (ticket o carta) */
export function receiptHTML(sale) {
  const s = store.settings;
  const ivaPct = Number(s.iva) || 0;
  const iva = ivaPct > 0 ? (sale.total - sale.total / (1 + ivaPct / 100)) : 0;
  const pays = (sale.payments || []).map((p) => `<tr><td colspan="2">${esc(methodLabel(p.method))}</td><td class="r">${usd(p.amount)}</td></tr>`).join('');
  const c = sale.memberId ? store.client(sale.memberId) : null;
  const L = store.loyalty;
  const barbers = [...new Set((sale.items || []).map((i) => i.barber).filter(Boolean))];
  return `<!DOCTYPE html><html><head>${PRINT_HEAD}<title>${esc(sale.number)}</title><style>${ticketCSS(s.receiptFormat)}</style></head><body>
    ${headerHTML()}
    <div class="hr"></div>
    <div class="c big">${esc(s.docTitle || 'RECIBO')}</div>
    <div class="c b">N° ${esc(sale.number)}</div>
    <div>Fecha: ${fmtDateTime(sale.date)}</div>
    <div>Cliente: ${esc(sale.memberName || 'Cliente de paso')}${sale.memberNumber ? ` (${esc(sale.memberNumber)})` : ''}</div>
    ${barbers.length ? `<div>Atendido por: ${esc(barbers.join(', '))}</div>` : ''}
    ${sale.status === 'voided' ? '<div class="c b">*** DOCUMENTO ANULADO ***</div>' : ''}
    <div class="hr"></div>
    <table>${(sale.items || []).map((it) => `<tr><td colspan="2" style="padding-top:3px">${qtyFmt(it.qty)} x ${esc(it.name)}${it.club ? ' (club)' : it.reward ? ' (premio)' : ''}</td><td class="r">${usd(it.total ?? it.price * it.qty)}</td></tr>`).join('')}</table>
    <div class="hr"></div>
    <table>
      <tr><td colspan="2">Subtotal</td><td class="r">${usd(sale.subtotal)}</td></tr>
      ${sale.discount > 0 ? `<tr><td colspan="2">Descuento</td><td class="r">-${usd(sale.discount)}</td></tr>` : ''}
      <tr class="big"><td colspan="2">TOTAL</td><td class="r">${usd(sale.total)}</td></tr>
      ${iva > 0.009 ? `<tr><td colspan="2">Impuesto ${num(ivaPct, 0)}% incluido</td><td class="r">${usd(iva)}</td></tr>` : ''}
    </table>
    ${pays ? `<div class="hr"></div><table>${pays}</table>` : ''}
    ${sale.changeUSD > 0.009 ? `<div>Vuelto: ${usd(sale.changeUSD)}</div>` : ''}
    ${sale.credit > 0.009 ? `<div class="b">Queda pendiente: ${usd(sale.credit)}</div>` : ''}
    ${c && L?.enabled && sale.kind === 'servicio' ? `<div class="hr"></div><div class="c">Sellos: ${'●'.repeat(Math.min(Number(c.stamps) || 0, L.every))}${'○'.repeat(Math.max(0, L.every - (Number(c.stamps) || 0)))}</div>${c.rewards ? `<div class="c b">Tienes ${c.rewards} ${esc(L.reward.toLowerCase())}</div>` : ''}` : ''}
    ${c?.membership && c.membership.status !== 'anulada' && (sale.kind === 'club' || sale.clubUsed) ? `<div class="hr"></div><div class="b">Club: ${esc(c.membership.name)}</div><div>Vigencia hasta ${fmtDate(c.membership.end)} · quedan ${c.membership.left} servicio(s)</div>` : ''}
    ${sale.note ? `<div>Nota: ${esc(sale.note)}</div>` : ''}
    <div class="hr"></div>
    <div class="c">${esc(s.receiptFooter || '¡Gracias por tu visita!')}</div>
    <div class="c sm" style="margin-top:4px">SanoCortes</div>
  </body></html>`;
}
export function printReceipt(sale) { printHTML(receiptHTML(sale)); }

/** Documento imprimible genérico (reportes, cierres, liquidaciones, listas) */
export function printDoc(title, inner, { accent = '#8a5a14' } = {}) {
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>${esc(title)}</title>
  <style>
    @page { margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 16px 0 6px; }
    .muted { color: #555; } table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th { background: ${accent}; color: #fff; text-align: left; padding: 6px; font-size: 11px; }
    td { padding: 5px 6px; border-bottom: 1px solid #ddd; } .r { text-align: right; } .c { text-align: center; }
    .kpis { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .kpi { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; min-width: 140px; }
    .kpi b { display: block; font-size: 15px; }
    .day { page-break-inside: avoid; } .sign { margin-top: 50px; display: flex; gap: 40px; } .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; }
  </style></head><body>
  <h1>${esc(store.businessName)}</h1>
  <div class="muted">${esc(title)} · Generado ${fmtDateTime(new Date().toISOString())}</div>
  ${inner}
  <p class="muted" style="margin-top:20px;font-size:10px">SanoCortes — Gestión profesional para barberías</p>
  </body></html>`);
}

export function notifyLowStock(list) {
  if (!list?.length) return;
  const names = list.slice(0, 3).map((i) => `${i.name} (${qtyFmt(i.stock)})`).join(', ');
  toast(`Productos por agotarse: ${names}${list.length > 3 ? ` y ${list.length - 3} más` : ''}`, 'warning', 6000);
}

export { usd, bs, fmtTime, styleLine };
