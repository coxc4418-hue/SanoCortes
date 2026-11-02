// SanoCortes — Búsqueda global (Ctrl + K): clientes, citas de hoy y próximas, recibos y productos
import { store, clientBadge, apptBadge } from '../store.js';
import { openModal, esc, usd, normalize, debounce, qtyFmt, fmtDate, todayKey } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, hydratePhotos, clientLine } from '../client.js';

export function openSearch() {
  if (document.querySelector('.search-modal')) return;
  const m = openModal({
    size: 'lg',
    body: `<div class="search search-big">${icon('search')}<input data-q placeholder="Cliente, teléfono, N° de cliente (C-0012), código de tarjeta o recibo (R-000045)…" autofocus autocomplete="off"><kbd>Esc</kbd></div><div data-res class="search-results"></div>`
  });
  m.el.querySelector('.modal').classList.add('search-modal');
  const input = m.el.querySelector('[data-q]');
  const res = m.el.querySelector('[data-res]');
  let token = 0;

  async function run() {
    const raw = input.value.trim();
    const t = normalize(raw);
    const digits = raw.replace(/\D/g, '');
    const my = ++token;
    if (!t) { res.innerHTML = hint(); bind(); return; }
    const exact = store.findClient(raw);
    const cls = [...(exact ? [exact] : []), ...store.clients.filter((p) => p !== exact && (normalize(`${p.name} ${p.number} ${p.email || ''} ${p.cardCode || ''}`).includes(t)
      || (digits.length >= 3 && `${p.phone || ''}`.replace(/\D/g, '').includes(digits))))].slice(0, 8);
    const appts = store.appointments.filter((a) => a.date >= todayKey() && !['cancelada', 'no_vino'].includes(a.status) && normalize(`${a.clientName} ${a.barberName} ${a.serviceNames}`).includes(t)).slice(0, 5);
    const sales = store.recentSales.filter((s) => normalize(`${s.number} ${s.memberName || ''}`).includes(t)).slice(0, 5);
    const prods = store.products.filter((p) => normalize(`${p.name} ${p.sku || ''}`).includes(t)).slice(0, 5);
    draw(cls, appts, sales, prods);
    const up = raw.toUpperCase().replace(/\s/g, '');
    const pre = (store.settings.invoicePrefix || 'R').toUpperCase();
    let num = null;
    if (new RegExp(`^${pre}-?\\d+$`).test(up)) num = `${pre}-` + up.replace(/\D/g, '').padStart(6, '0');
    if (!num) return;
    let found = [];
    try { found = await store.listEq('sales', 'number', num); } catch (_) {}
    if (my !== token) return;
    const extra = found.filter((s) => !sales.some((x) => x.id === s.id));
    if (extra.length) draw(cls, appts, [...extra, ...sales], prods);
  }

  function draw(cls, appts, sales, prods) {
    res.innerHTML = (cls.length || appts.length || sales.length || prods.length) ? `
      ${cls.length ? `<div class="section-title">Clientes</div>${cls.map((p) => `<button class="sitem" data-m="${p.id}">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small>${esc(p.number)}${p.phone ? ' · ' + esc(p.phone) : ''} · ${clientLine(p)}</small></span>${clientBadge(store.clientStatus(p))}</button>`).join('')}` : ''}
      ${appts.length ? `<div class="section-title">Citas</div>${appts.map((a) => `<button class="sitem" data-a="${a.id}"><span class="appt-time" style="--bc:${a.barberColor}">${esc(a.time || '#' + (a.queueNo || ''))}</span><span class="grow"><b>${esc(a.clientName)}</b><small>${a.date === todayKey() ? 'Hoy' : fmtDate(a.date)} · ${esc(a.serviceNames)} · ${esc(a.barberName)}</small></span>${apptBadge(a.status)}</button>`).join('')}` : ''}
      ${sales.length ? `<div class="section-title">Recibos</div>${sales.map((s) => `<button class="sitem" data-s="${esc(s.number)}"><span class="kpi-icon tone-violet" style="width:36px;height:36px">${icon('file')}</span><span class="grow"><b>${esc(s.number)} · ${esc(s.memberName || 'Cliente de paso')}</b><small>${fmtDate(s.date)} · ${esc((s.items || []).map((i) => i.name).join(' + ')).slice(0, 80)}</small></span><b>${usd(s.total)}</b></button>`).join('')}` : ''}
      ${prods.length ? `<div class="section-title">Productos</div>${prods.map((p) => `<button class="sitem" data-p="${p.id}"><span class="kpi-icon tone-info" style="width:36px;height:36px">${icon('box')}</span><span class="grow"><b>${esc(p.name)}</b><small>${p.trackStock !== false ? `Existencia: ${qtyFmt(p.stock || 0)}` : 'Sin control de existencia'}</small></span><b>${usd(p.price)}</b></button>`).join('')}` : ''}`
      : `<div class="empty">${icon('search')}<b>Sin resultados</b><span>Para recibos antiguos escribe el número exacto (ej. R-000045).</span></div>`;
    bind();
  }

  function hint() {
    const list = store.clients.filter((p) => p.lastVisitAt).sort((a, b) => b.lastVisitAt.localeCompare(a.lastVisitAt)).slice(0, 6);
    return list.length ? `<div class="section-title">Atendidos recientemente</div>${list.map((p) => `<button class="sitem" data-m="${p.id}">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b><small>${clientLine(p)}</small></span>${clientBadge(store.clientStatus(p))}</button>`).join('')}`
      : `<div class="empty">${icon('search')}<b>Busca en toda la barbería</b><span>Clientes, citas, recibos y productos.</span></div>`;
  }

  function bind() {
    hydratePhotos(res, 14);
    res.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => { m.close(); (await import('../client.js')).openClient(b.dataset.m); });
    res.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => { m.close(); const a = store.appointments.find((x) => x.id === b.dataset.a); if (a) (await import('../appt.js')).openAppt(a); });
    res.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => { m.close(); (await import('../main.js')).navigate('facturas', { params: { q: b.dataset.s } }); });
    res.querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => { m.close(); (await import('../main.js')).navigate('inventario', { params: { q: store.product(b.dataset.p)?.name || '' } }); });
  }

  input.oninput = debounce(run, 140);
  input.onkeydown = (e) => { if (e.key === 'Enter') { const first = res.querySelector('.sitem'); if (first) first.click(); } };
  res.innerHTML = hint(); bind();
}
