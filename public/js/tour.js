// SanoCortes — Recorrido guiado: ilumina zonas de la pantalla y explica para qué sirven
import { esc, openModal, closeAllModals } from './utils.js';
import { icon } from './icons.js';

// Cada paso: { route, sel: [selectores alternativos], title, text }. Sin elemento visible → tarjeta centrada.
export const TOURS = {
  general: {
    name: 'Recorrido general', desc: 'Lo esencial del sistema en 1 minuto', icon: 'sparkle',
    steps: [
      { route: 'inicio', title: '¡Bienvenido a SanoCortes! 💈', text: 'En un minuto te mostramos cómo manejar tu barbería aquí: agenda por barbero, sala de espera, clientes con la ficha de su corte, fidelización, cobros y pagos a barberos. Usa “Siguiente” para avanzar o “Salir” cuando quieras. Puedes repetirlo desde el menú › Ayuda.' },
      { route: 'inicio', sel: ['.sb-nav', '.bottom-nav'], title: 'Menú principal', text: 'Agenda, sala de espera, clientes, fidelizar, cobrar, barberos y pagos, recibos, caja, productos, reportes y ajustes. Los números de colores son avisos: reservas en línea nuevas, clientes esperando y clientes a los que les toca corte.' },
      { route: 'inicio', sel: ['#sb-search', '#tb-search'], title: 'Búsqueda rápida', text: 'Encuentra a cualquier cliente por nombre, teléfono, N° de cliente (C-0012) o código de su tarjeta; una cita o un recibo (R-000045). En la computadora: Ctrl + K.' },
      { route: 'inicio', sel: ['[data-tour="quick"]'], title: 'Accesos rápidos', text: 'Agenda una cita, anota a quien llegó sin cita o cobra con un toque. Atajos: F1 agenda, F2 llegó sin cita, F3 clientes, F4 cobrar.' },
      { route: 'inicio', sel: ['[data-tour="board"]'], title: 'Tus barberos en vivo', text: 'Quién está cortando y a quién, cuánto le falta, quién está libre y su próxima cita. Así sabes al instante a quién mandar al cliente que entra.' },
      { route: 'agenda', sel: ['[data-tour="agenda"]', '#ag-body'], title: 'Agenda por barbero', text: 'Una columna por barbero con sus horas, descansos y citas por color de estado. Toca un espacio vacío para agendar ahí mismo; el sistema no deja cruzar citas y respeta el horario de cada uno.' },
      { route: 'agenda', sel: ['#ag-rem'], title: 'Recordatorios', text: 'Con un toque le escribes por WhatsApp a cada cliente con cita mañana, con el mensaje listo. Menos clientes que no vienen.' },
      { route: 'turnos', sel: ['[data-tour="waiting"]'], title: 'Sala de espera', text: 'Los que llegan sin cita toman un número de turno con el barbero que quieran o “el primero libre”, y el sistema calcula cuánto les toca esperar. Llama al siguiente y avísale por WhatsApp.' },
      { route: 'turnos', sel: ['#q-tv'], title: 'Pantalla de turnos', text: 'Pon la sala en un televisor: muestra quién está en cada silla, la fila con tiempos y llama al siguiente con sonido. En una tablet, el cliente toma su turno solo.' },
      { route: 'clientes', sel: ['[data-tour="filters"]'], title: 'Clientes y la ficha del corte', text: 'Cada cliente guarda la receta de su corte (degradado, máquina, estilo, barba, productos y foto), su barbero, su bebida favorita y sus alergias. Cualquier barbero lo repite igual.' },
      { route: 'fidelizar', sel: ['#l-tabs', '#view'], title: 'Fidelizar', text: 'El sistema aprende cada cuántos días viene cada cliente y te avisa cuándo le toca corte. También perdidos, cumpleaños, club por vencer, premios y saldos, con el WhatsApp ya escrito.' },
      { route: 'cobrar', sel: ['[data-tour="pos-barber"]', '#pos-grid'], title: 'Cobrar', text: 'Elige el barbero y toca los servicios. Se aplica solo el club del cliente o su premio de sellos, se agregan propinas por barbero y productos, y se guarda la ficha del corte.' },
      { route: 'cobrar', sel: ['#c-pay', '#cart-fab'], title: 'Formas de pago', text: 'Varias formas de pago a la vez con cálculo del vuelto, o deja parte a deber. Todo en la moneda del país que elegiste.' },
      { route: 'barberos', sel: ['#t-tabs', '#view'], title: 'Barberos y pagos', text: 'Comisión por servicio, alquiler de silla o sueldo + comisión. La liquidación suma servicios, productos y propinas, descuenta adelantos y alquiler, y te dice cuánto pagarle a cada uno.' },
      { route: 'inicio', title: '¡A cortar! 🎉', text: 'Prueba ahora: en la Sala de espera llama al siguiente turno, o cobra a José (tiene club) desde Inicio. La reserva en línea de Rafael te espera en la Agenda. Más recorridos en el menú › Ayuda.', final: true }
    ]
  },
  agenda: {
    name: 'Agenda y reservas en línea', desc: 'Citas por barbero, recordatorios y tu página de reservas', icon: 'calendar',
    steps: [
      { route: 'agenda', sel: ['#ag-new'], title: 'Nueva cita', text: 'Elige al cliente, los servicios (la duración se suma sola), el barbero y una de sus horas libres. Al guardar te ofrece enviarle la confirmación por WhatsApp.' },
      { route: 'agenda', sel: ['#ag-mode'], title: 'Día o semana', text: 'Ve el día con una columna por barbero, o los próximos 7 días para planificar.' },
      { route: 'agenda', sel: ['[data-tour="requests"]', '#ag-req', '#view'], title: 'Reservas en línea', text: 'Tus clientes reservan desde su teléfono en tu página propia, eligiendo barbero y hora libre. Te llega aquí para aceptarla con un toque (o se acepta sola si lo activas en Ajustes).' },
      { route: 'ajustes', sel: ['#view'], title: 'Tu enlace y QR', text: 'En Configuración › Reserva en línea tienes tu enlace y un código QR para el espejo, Instagram y WhatsApp.', final: true }
    ]
  },
  fidelidad: {
    name: 'Fidelización y club', desc: 'Sellos, premios, club prepagado y tarjeta digital', icon: 'crown',
    steps: [
      { route: 'fidelizar', sel: ['#l-tabs'], title: 'A quién escribirle hoy', text: 'Les toca corte, perdidos, cumpleaños, club por vencer, premios y saldos. Cada uno con su botón de WhatsApp y el mensaje listo; el sistema marca a quién ya avisaste.' },
      { route: 'fidelizar', title: 'Tarjeta de sellos', text: 'Cada visita pagada suma un sello. Al completar la tarjeta (10 por defecto) gana su premio, que se aplica al cobrar con un toque.' },
      { route: 'fidelizar', title: 'Club prepagado', text: 'Vende paquetes como “4 cortes al mes”: cobras por adelantado y el cliente vuelve seguro. Al cobrar, el servicio se descuenta solo de su club.' },
      { route: 'clientes', title: 'Tarjeta digital del cliente', text: 'Cada cliente tiene su tarjeta en el teléfono: sus sellos, su club, su próxima cita, el estilo de su último corte y el botón para reservar.', final: true }
    ]
  },
  caja: {
    name: 'Caja, productos y reportes', desc: 'Apertura, gastos, cierre, inventario y reportes', icon: 'wallet',
    steps: [
      { route: 'caja', sel: ['#view'], title: 'Caja', text: 'Abre la caja con el fondo inicial; cada cobro suma por forma de pago. Registra gastos y adelantos a barberos, y al cerrar compara lo contado con lo esperado.' },
      { route: 'inventario', sel: ['#view'], title: 'Productos e inventario', text: 'Ceras, aceites, shampoo y bebidas para vender, y los insumos internos (cuchillas, capas). Te avisa de lo que se está agotando.' },
      { route: 'facturas', sel: ['#view'], title: 'Recibos', text: 'Todos los recibos de la barbería. Reimprime o anula con PIN: al anular, se devuelven los sellos, el club y la caja.' },
      { route: 'caja', sel: ['.sb-nav [data-nav="reportes"]', '#view'], title: 'Reportes', text: 'Ingresos, cortes por día, horas pico, ocupación de cada silla, servicios más pedidos, clientes que vuelven e inasistencias. Protegidos con el PIN (en la demo: 1234).', final: true }
    ]
  }
};
let state = null;

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
async function findTarget(sels = [], timeout = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const s of sels) { const el = [...document.querySelectorAll(s)].find(visible); if (el) return el; }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

/** Inicia un recorrido (por defecto el general). */
export async function startTour(id = 'general') {
  stopTour();
  const tour = TOURS[id];
  if (!tour) return;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  state = { id, tour, i: 0, root, target: null };
  const onKey = (e) => {
    if (!state) return;
    if (e.key === 'Escape') { e.stopPropagation(); stopTour(); }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  const onResize = () => place();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  state.cleanup = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); };
  await show();
}

export function stopTour() {
  if (!state) return;
  state.cleanup?.();
  state.root.remove();
  state = null;
  try { localStorage.setItem('sg_tour_done', '1'); } catch (_) {}
}
export const tourActive = () => !!state;

async function go(d) {
  if (!state) return;
  const n = state.i + d;
  if (n < 0) return;
  if (n >= state.tour.steps.length) { stopTour(); return; }
  state.i = n;
  await show();
}

async function show() {
  const s = state.tour.steps[state.i];
  const tip = state.root.querySelector('.tour-tip');
  tip.classList.add('busy');
  const { navigate } = await import('./main.js');
  if (s.route && location.hash.replace(/^#\/?/, '') !== s.route) {
    await navigate(s.route);
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!state) return;
  closeAllModals();
  state.target = s.sel ? await findTarget(s.sel) : null;
  if (!state) return;
  if (state.target) state.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const total = state.tour.steps.length;
  tip.innerHTML = `
    <div class="tour-step">${state.i + 1} de ${total}</div>
    <div class="tour-title">${esc(s.title)}</div>
    <div class="tour-text">${esc(s.text)}</div>
    <div class="tour-dots">${Array.from({ length: total }, (_, k) => `<i class="${k === state.i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="tour-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-t="stop">${s.final ? 'Cerrar' : 'Salir'}</button>
      <span class="grow"></span>
      ${state.i > 0 ? `<button type="button" class="btn btn-secondary btn-sm" data-t="prev">${icon('arrowLeft')}</button>` : ''}
      ${s.final && videoOk ? `<button type="button" class="btn btn-secondary btn-sm" data-t="video">${icon('eye')} Ver video</button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" data-t="next">${state.i === total - 1 ? 'Terminar' : 'Siguiente'} ${state.i === total - 1 ? '' : icon('arrowRight')}</button>
    </div>`;
  tip.querySelector('[data-t="stop"]').onclick = stopTour;
  tip.querySelector('[data-t="next"]').onclick = () => go(1);
  const pv = tip.querySelector('[data-t="prev"]'); if (pv) pv.onclick = () => go(-1);
  const vd = tip.querySelector('[data-t="video"]'); if (vd) vd.onclick = () => { stopTour(); openVideo(); };
  tip.classList.remove('busy');
  place();
  tip.querySelector('[data-t="next"]').focus({ preventScroll: true });
}

function place() {
  if (!state) return;
  const spot = state.root.querySelector('.tour-spot');
  const tip = state.root.querySelector('.tour-tip');
  const vw = innerWidth, vh = innerHeight, pad = 8;
  const el = state.target;
  if (!el || !document.contains(el)) {
    spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;`;
    tip.className = 'tour-tip center';
    tip.style.left = `${Math.max(12, (vw - tip.offsetWidth) / 2)}px`;
    tip.style.top = `${Math.max(12, (vh - tip.offsetHeight) / 2)}px`;
    return;
  }
  const r = el.getBoundingClientRect();
  const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
  const w = Math.min(vw - x - 4, r.width + pad * 2), h = Math.min(vh - y - 4, r.height + pad * 2);
  spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
  let left, top, side;
  if (y + h + gap + th <= vh - 8) { side = 'bottom'; top = y + h + gap; left = x + w / 2 - tw / 2; }
  else if (y - gap - th >= 8) { side = 'top'; top = y - gap - th; left = x + w / 2 - tw / 2; }
  else if (x + w + gap + tw <= vw - 8) { side = 'right'; left = x + w + gap; top = y + h / 2 - th / 2; }
  else if (x - gap - tw >= 8) { side = 'left'; left = x - gap - tw; top = y + h / 2 - th / 2; }
  else { side = 'inside'; left = vw / 2 - tw / 2; top = vh - th - 16; }
  left = Math.max(10, Math.min(vw - tw - 10, left));
  top = Math.max(10, Math.min(vh - th - 10, top));
  tip.className = `tour-tip side-${side}`;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// ======================================================================
// Ayuda: lista de recorridos y video tutorial
// ======================================================================
export const VIDEO_URL = '/tutorial/sano-cortes-tutorial.mp4';

export function openVideo() {
  const m = openModal({
    title: 'Video tutorial', sub: 'Cómo usar SanoCortes, paso a paso', size: 'xl',
    body: `<video class="tutorial-video" src="${VIDEO_URL}" poster="/tutorial/portada.jpg" controls autoplay playsinline preload="metadata"></video>`,
    footer: '<a class="btn btn-secondary" href="' + VIDEO_URL + '" download>' + icon('download') + ' Descargar</a><button class="btn btn-primary" data-close>Cerrar</button>'
  });
  return m;
}

let videoOk = null;
async function hasVideo() {
  if (videoOk != null) return videoOk;
  try { const r = await fetch(VIDEO_URL, { method: 'HEAD' }); videoOk = r.ok && /video/.test(r.headers.get('content-type') || ''); } catch (_) { videoOk = false; }
  return videoOk;
}

export async function openHelp() {
  const video = await hasVideo();
  const m = openModal({
    title: 'Ayuda', sub: video ? 'Elige un recorrido guiado o mira el video tutorial' : 'Elige un recorrido guiado', size: 'md',
    body: `<div class="stack">
      ${video ? `<button type="button" class="help-video" data-video><span class="help-play">${icon('arrowRight')}</span><span><b>Video tutorial</b><small>Las funciones principales explicadas con voz</small></span></button>` : ''}
      <div class="section-title">Recorridos guiados</div>
      <div class="help-list">${Object.entries(TOURS).map(([k, t]) => `<button type="button" class="help-item" data-tour-id="${k}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(t.icon)}</span><span class="grow"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span>${icon('arrowRight')}</button>`).join('')}</div>
    </div>`,
    footer: '<button class="btn btn-primary" data-close>Cerrar</button>'
  });
  const vb = m.el.querySelector('[data-video]'); if (vb) vb.onclick = () => { m.close(); openVideo(); };
  m.el.querySelectorAll('[data-tour-id]').forEach((b) => b.onclick = () => { m.close(); startTour(b.dataset.tourId); });
}
