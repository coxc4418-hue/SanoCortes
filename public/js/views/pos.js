// SanoCortes — Cobrar: servicios con su barbero, productos, club, premios, propinas, saldo y la ficha del corte
import { store } from '../store.js';
import { chargeTicket, cartTotals } from '../ops.js';
import { esc, usd, num, toast, normalize, debounce, emptyState, qtyFmt, parseNum, round2, promptDialog, openModal } from '../utils.js';
import { icon } from '../icons.js';
import { printReceipt, notifyLowStock, waClient } from '../shared.js';
import { openPay, showPaid } from '../pay.js';
import { pickClient, styleForm, clubModal, savePhoto, avatar, hydratePhotos, stampsHTML, clientLine } from '../client.js';
import { SERVICE_CATEGORIES, styleLine } from '../barber.js';

const PROD_ICON = (c = '') => /cera|pomad|fija|gel/i.test(c) ? 'sparkle' : /barba|after|loci/i.test(c) ? 'droplet' : /shamp/i.test(c) ? 'droplet' : /bebid/i.test(c) ? 'droplet' : 'box';
const SVC_ICON = (cat = '') => /barba/i.test(cat) ? 'razor' : /combo/i.test(cat) ? 'star' : /color|quím/i.test(cat) ? 'droplet' : /trata/i.test(cat) ? 'sparkle' : /niñ/i.test(cat) ? 'smile' : 'scissors';

export function mount(el, { params = {}, navigate }) {
  let tab = 'servicios'; let search = '';
  let cart = []; let client = null; let appt = null; let style = null; let photo = null;
  let barberId = store.activeBarbers[0]?.id || null;
  let tips = {};

  el.innerHTML = `<div class="pos">
    <div class="pos-main">
      <div class="pos-head">
        <div class="row" style="gap:8px;flex-wrap:wrap"><label class="search" style="flex:1;min-width:220px">${icon('search')}<input id="pos-search" placeholder="Buscar servicio, producto o código de barras…" autocomplete="off"></label><button class="btn btn-secondary" id="pos-club">${icon('crown')} Vender club</button></div>
        <div class="barber-row" id="pos-barbers" data-tour="pos-barber"></div>
        <div class="chips" id="pos-tabs"></div>
      </div>
      <div class="pos-grid-wrap"><div class="pgrid" id="pos-grid"></div></div>
    </div>
    <div class="cart-backdrop" id="cart-bd"></div>
    <aside class="cart" id="cart">
      <div class="cart-head"><div class="between"><b style="font-size:16px">Cobro</b><button class="btn btn-ghost btn-sm" id="c-clear">${icon('trash')} Vaciar</button></div>
        <div class="cart-ctx" id="c-ctx"></div></div>
      <div class="cart-list" id="c-list"></div>
      <div class="cart-foot">
        <div class="cart-extra" id="c-extra"></div>
        <div class="cart-grand"><span class="lbl">Total</span><div class="val"><b id="c-total">${usd(0)}</b></div></div>
        <button class="btn btn-success btn-xl btn-block" id="c-pay" data-tour="pos-pay">${icon('check')} Cobrar</button>
      </div>
    </aside>
    <button class="cart-fab" id="cart-fab"><span><span class="cnt" id="fab-n">0</span>Ver cobro</span><b id="fab-t">$ 0,00</b></button>
  </div>`;
  const $ = (s) => el.querySelector(s);
  const sellable = () => store.products.filter((p) => p.active !== false && p.sellable !== false && p.category !== 'Insumos internos');

  // ---------- Barbero activo (a quién se le asignan los servicios que se tocan) ----------
  function renderBarbers() {
    $('#pos-barbers').innerHTML = `<span class="small muted" style="align-self:center">Barbero:</span>${store.activeBarbers.map((b) => `<button class="barber-chip ${barberId === b.id ? 'on' : ''}" data-b="${b.id}" style="--bc:${b.color}"><span class="bdot">${esc(b.name[0])}</span>${esc(b.name.split(' ')[0])}</button>`).join('') || '<span class="small muted">Agrega barberos en Barberos y pagos.</span>'}`;
    el.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { barberId = b.dataset.b; renderBarbers(); });
  }

  function renderTabs() {
    const cats = [...new Set(store.activeServices.map((s) => s.category).filter(Boolean))];
    const pcats = [...new Set(sellable().map((p) => p.category).filter(Boolean))];
    $('#pos-tabs').innerHTML = [['servicios', 'Todos los servicios'], ...SERVICE_CATEGORIES.filter((c) => cats.includes(c)).map((c) => ['s:' + c, c]), ['productos', 'Productos'], ...pcats.map((c) => ['p:' + c, c])]
      .map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab="${esc(k)}">${esc(l)}</button>`).join('');
    el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; renderTabs(); renderGrid(); });
  }

  const inCart = (key) => cart.filter((l) => l.key === key).reduce((a, l) => a + l.qty, 0);
  function renderGrid() {
    const t = normalize(search);
    const svcMode = t || tab === 'servicios' || tab.startsWith('s:');
    const prodMode = t || tab === 'productos' || tab.startsWith('p:');
    const svcs = svcMode ? store.activeServices.filter((s) => (!tab.startsWith('s:') || s.category === tab.slice(2)) && (!t || normalize(`${s.name} ${s.category}`).includes(t))) : [];
    const prods = prodMode ? sellable().filter((p) => (!tab.startsWith('p:') || p.category === tab.slice(2)) && (!t || normalize(`${p.name} ${p.sku || ''} ${p.category}`).includes(t))) : [];
    const svcHTML = svcs.map((s) => {
      const club = client && store.clubCovers(client, s.id);
      return `<button class="pcard" data-s="${s.id}">${inCart('s:' + s.id) ? `<span class="pcard-qty">${qtyFmt(inCart('s:' + s.id))}</span>` : ''}${club ? `<span class="pcard-flag badge badge-violet">${icon('crown')} club</span>` : ''}
      <div class="pcard-media" style="--pc:${s.color || 'var(--surface-2)'}22"><span class="pcard-ic" style="color:${s.color || 'var(--brand)'}">${icon(SVC_ICON(s.category))}</span></div>
      <div class="pcard-name">${esc(s.name)}</div><div class="t-sub">${s.minutes} min</div><div class="pcard-price"><b>${usd(s.price)}</b></div></button>`;
    }).join('');
    const prodHTML = prods.map((p) => {
      const stock = Number(p.stock) || 0; const tracked = p.trackStock !== false;
      const out = tracked && stock - inCart('p:' + p.id) <= 0;
      return `<button class="pcard" data-p="${p.id}" ${out ? 'disabled' : ''}>${inCart('p:' + p.id) ? `<span class="pcard-qty">${qtyFmt(inCart('p:' + p.id))}</span>` : ''}
        ${tracked ? `<span class="pcard-flag badge ${stock <= 0 ? 'badge-danger' : stock <= (p.minStock || 0) ? 'badge-warning' : 'badge-neutral'}">${stock <= 0 ? 'Agotado' : qtyFmt(stock)}</span>` : ''}
        <div class="pcard-media" style="--pc:${p.color || 'var(--surface-2)'}">${p.image ? `<img src="${p.image}" alt="">` : `<span class="pcard-ic">${icon(PROD_ICON(p.category))}</span>`}</div>
        <div class="pcard-name">${esc(p.name)}</div><div class="pcard-price"><b>${usd(p.price)}</b></div></button>`;
    }).join('');
    $('#pos-grid').innerHTML = svcHTML + prodHTML || `<div style="grid-column:1/-1">${prodMode && !svcMode ? emptyState('box', 'Sin productos para vender', 'Agrega ceras, aceites y bebidas en Productos e inventario.') : emptyState('scissors', 'Sin servicios', 'Crea tus servicios y precios en Ajustes → Servicios.')}</div>`;
    el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => addService(store.service(b.dataset.s)));
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { const p = store.product(b.dataset.p); if (p) addProduct(p); });
  }

  function addService(s, bid = barberId, { silent = false } = {}) {
    if (!s) return;
    const line = { key: 's:' + s.id, kind: 'servicio', serviceId: s.id, name: s.name, price: round2(Number(s.price) || 0), listPrice: round2(Number(s.price) || 0), qty: 1, barberId: bid, club: false, reward: false };
    // Aplica el club automáticamente si lo cubre y quedan servicios
    if (client && store.clubCovers(client, s.id) && clubLeft() > 0) { line.club = true; line.price = 0; if (!silent) toast(`Cubierto por su club (${client.membership.name})`, 'info'); }
    cart.push(line);
    renderCart(); renderGrid();
  }
  function addProduct(p) {
    const have = inCart('p:' + p.id) + 1;
    if (p.trackStock !== false && have > (Number(p.stock) || 0)) { toast(`Solo quedan ${qtyFmt(p.stock || 0)} de ${p.name}`, 'warning'); return; }
    const line = cart.find((l) => l.key === 'p:' + p.id);
    if (line) line.qty = have; else cart.push({ key: 'p:' + p.id, kind: 'producto', productId: p.id, name: p.name, price: Number(p.price) || 0, cost: Number(p.cost) || 0, qty: 1, barberId });
    renderCart(); renderGrid();
  }
  const clubLeft = () => (Number(client?.membership?.left) || 0) - cart.filter((l) => l.club).length;
  const rewardsLeft = () => (Number(client?.rewards) || 0) - cart.filter((l) => l.reward).length;
  const lineBarbers = () => [...new Set(cart.filter((l) => l.kind === 'servicio' && l.barberId).map((l) => l.barberId))];

  function renderCtx() {
    const c = client;
    $('#c-ctx').innerHTML = c ? `<div class="cart-client">${avatar(c)}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(c.name)}</b><div class="t-sub ellipsis">${esc(c.number)} · ${clientLine(c)}</div></div><button class="btn btn-ghost btn-icon btn-sm" id="c-unpick" title="Quitar cliente">${icon('x')}</button></div>
      ${stampsHTML(c)}
      <div class="row" style="gap:4px;flex-wrap:wrap">${Number(c.rewards) > 0 ? `<span class="badge badge-success">${icon('gift')} ${c.rewards} premio(s)</span>` : ''}${c.membership && c.membership.status !== 'anulada' && c.membership.end >= new Date().toISOString().slice(0, 10) ? `<span class="badge badge-violet">${icon('crown')} ${esc(c.membership.name)} · quedan ${c.membership.left}</span>` : ''}${(Number(c.balance) || 0) > 0.009 ? `<span class="badge badge-danger">debe ${usd(c.balance)}</span>` : ''}${c.allergies ? `<span class="badge badge-warning">${icon('alert')} ${esc(c.allergies)}</span>` : ''}</div>
      ${c.lastStyle ? `<button class="style-card mt-xs" id="c-last">${icon('scissors')} <span class="ellipsis"><b>Último corte:</b> ${esc(styleLine(c.lastStyle))}</span></button>` : ''}`
      : `<button class="btn btn-secondary btn-sm btn-block" id="c-pt">${icon('user')} Elegir cliente (suma sellos y guarda su corte)</button>`;
    if ($('#c-pt')) $('#c-pt').onclick = pick;
    if ($('#c-unpick')) $('#c-unpick').onclick = () => { client = null; cart.forEach((l) => { if (l.club || l.reward) { l.club = l.reward = false; l.price = l.listPrice; } }); renderAll(); };
    if ($('#c-last')) $('#c-last').onclick = editStyle;
    hydratePhotos($('#c-ctx'), 2);
  }

  function renderCart() {
    renderCtx();
    const t = cartTotals(cart);
    const tipsTotal = Object.values(tips).reduce((a, v) => a + (Number(v) || 0), 0);
    const bOpts = (sel) => store.activeBarbers.map((b) => `<option value="${b.id}" ${sel === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
    $('#c-list').innerHTML = cart.length ? cart.map((l, i) => `<div class="cline">
      <div class="cline-name">${esc(l.name)}${l.club ? ` <span class="badge badge-violet">${icon('crown')} club</span>` : ''}${l.reward ? ` <span class="badge badge-success">${icon('gift')} premio</span>` : ''}</div><div class="cline-total">${usd(l.price * l.qty)}</div>
      <div class="cline-meta">${l.club || l.reward ? `<span class="t-sub">precio normal ${usd(l.listPrice)}</span>` : `<button class="linkish" data-price="${i}">${usd(l.price)}${l.kind === 'producto' ? ' c/u' : ''} ${icon('edit')}</button>`}
        <select class="select select-xs" data-lb="${i}" title="Barbero">${l.kind === 'producto' ? '<option value="">Sin comisión</option>' : ''}${bOpts(l.barberId)}</select></div>
      <div class="cline-actions">${l.kind === 'producto' ? `<div class="stepper"><button data-dec="${i}" aria-label="Menos">${icon('minus')}</button><span>${qtyFmt(l.qty)}</span><button data-inc="${i}" aria-label="Más">${icon('plus')}</button></div>`
        : `${client && (l.club || (store.clubCovers(client, l.serviceId) && clubLeft() > 0)) ? `<button class="btn btn-ghost btn-sm ${l.club ? 'on' : ''}" data-club="${i}" title="Usar el club">${icon('crown')}</button>` : ''}${client && (l.reward || rewardsLeft() > 0) ? `<button class="btn btn-ghost btn-sm ${l.reward ? 'on' : ''}" data-rw="${i}" title="Usar premio">${icon('gift')}</button>` : ''}`}
        <button class="btn btn-ghost btn-icon btn-sm" data-del="${i}" aria-label="Quitar">${icon('x')}</button></div>
    </div>`).join('') : `<div class="empty">${icon('scissors')}<b>Nada por cobrar</b><span>Elige el barbero arriba y toca los servicios. Si el cliente tiene club o premio, se aplica aquí.</span></div>`;

    const bs = lineBarbers();
    const hasSvc = cart.some((l) => l.kind === 'servicio');
    $('#c-extra').innerHTML = cart.length ? `
      ${hasSvc ? `<button class="btn btn-secondary btn-sm btn-block" id="c-style">${icon('scissors')} ${style ? `<span class="ellipsis">Ficha: ${esc(styleLine(style))}</span>` : 'Anotar la ficha del corte'}${photo ? ' 📷' : ''}</button>` : ''}
      ${store.settings.tips !== false && bs.length ? `<div class="tip-row"><span class="small muted">Propina</span>${bs.map((id) => { const b = store.barber(id); return `<label class="tip-in" title="${esc(b?.name || '')}"><span class="bdot" style="--bc:${b?.color}">${esc((b?.name || '?')[0])}</span><input class="input input-sm" inputmode="decimal" data-tip="${id}" value="${tips[id] ? num(tips[id]) : ''}" placeholder="0"></label>`; }).join('')}</div>` : ''}
      <div class="between small"><span class="muted">Subtotal${tipsTotal ? ' + propina' : ''}</span><b>${usd(t.subtotal + tipsTotal)}</b></div>` : '';
    $('#c-total').textContent = usd(t.total + tipsTotal);
    $('#fab-n').textContent = cart.reduce((a, l) => a + l.qty, 0); $('#fab-t').textContent = usd(t.total + tipsTotal);
    $('#c-pay').disabled = !cart.length;

    const L = (i) => cart[+i];
    el.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => addProduct(store.product(L(b.dataset.inc).productId)));
    el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const l = L(b.dataset.dec); l.qty -= 1; if (l.qty <= 0) cart.splice(+b.dataset.dec, 1); renderCart(); renderGrid(); });
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { cart.splice(+b.dataset.del, 1); syncTips(); renderCart(); renderGrid(); });
    el.querySelectorAll('[data-lb]').forEach((s) => s.onchange = () => { L(s.dataset.lb).barberId = s.value || null; syncTips(); renderCart(); });
    el.querySelectorAll('[data-club]').forEach((b) => b.onclick = () => { const l = L(b.dataset.club); l.club = !l.club; if (l.club) l.reward = false; l.price = l.club || l.reward ? 0 : l.listPrice; renderCart(); });
    el.querySelectorAll('[data-rw]').forEach((b) => b.onclick = () => { const l = L(b.dataset.rw); l.reward = !l.reward; if (l.reward) l.club = false; l.price = l.club || l.reward ? 0 : l.listPrice; renderCart(); });
    el.querySelectorAll('[data-price]').forEach((b) => b.onclick = async () => {
      const l = L(b.dataset.price);
      const v = await promptDialog({ title: 'Precio', label: l.name, value: num(l.price), confirmText: 'Aplicar' });
      if (v != null && parseNum(v) >= 0) { l.price = round2(parseNum(v)); if (l.kind === 'servicio') l.listPrice = l.price; renderCart(); }
    });
    el.querySelectorAll('[data-tip]').forEach((i) => i.onchange = () => { tips[i.dataset.tip] = round2(parseNum(i.value) || 0); renderCart(); });
    if ($('#c-style')) $('#c-style').onclick = editStyle;
  }
  const syncTips = () => { const bs = lineBarbers(); Object.keys(tips).forEach((k) => { if (!bs.includes(k)) delete tips[k]; }); };
  const renderAll = () => { renderCart(); renderGrid(); };

  async function editStyle() {
    const r = await styleForm(style || client?.lastStyle || {}, { confirmText: 'Listo' });
    if (r) { style = r.style; photo = r.photo || photo; renderCart(); }
  }
  async function pick() {
    const c = await pickClient({ title: '¿A quién le cobras?' });
    if (c) { setClient(c); }
  }
  function setClient(c) {
    client = c;
    // Reaplica el club a los servicios ya cargados
    cart.forEach((l) => { if (l.kind === 'servicio' && !l.club && !l.reward && store.clubCovers(client, l.serviceId) && clubLeft() > 0) { l.club = true; l.price = 0; } });
    renderAll();
  }

  async function pay() {
    if (!cart.length) return;
    const t = cartTotals(cart);
    const tipList = Object.entries(tips).map(([bid, amount]) => ({ barberId: bid, amount })).filter((x) => x.amount > 0);
    const tipsTotal = tipList.reduce((a, x) => a + x.amount, 0);
    let credit = 0;
    if (client) {
      // Opción de dejar parte a deber (solo con cliente identificado)
      const choice = await askCredit(t.total + tipsTotal);
      if (choice == null) return;
      credit = choice;
    }
    const amount = round2(t.total + tipsTotal - credit);
    const run = async (res = { payments: [], discount: 0, print: false }) => {
      const out = await chargeTicket({ lines: cart.map(({ key, ...l }) => l), client, discount: res.discount, payments: res.payments, appt, tips: tipList, credit, style });
      if (photo && out.sale.visitId) { try { await savePhoto('v_' + out.sale.visitId, photo); } catch (e) { console.warn(e); } }
      if (res.print) printReceipt(out.sale);
      return out;
    };
    let out;
    try {
      out = amount > 0.004
        ? await openPay({ title: 'Cobrar', sub: esc(client?.name || 'Cliente de paso'), amount, baseTotal: amount, discount: true, printLabel: 'Imprimir recibo', onConfirm: run })
        : await run();
    } catch (e) { toast(e.message, 'danger', 5000); return; }
    if (!out) return;
    notifyLowStock(out.low);
    const cl = out.client;
    if (out.sale.earnedReward) toast(`🏆 ¡${cl.name} completó su tarjeta y ganó ${store.loyalty.reward}!`, 'success', 6000);
    showPaid(out.sale, { title: 'Cobro registrado', onPrint: () => printReceipt(out.sale) });
    if (cl?.phone) setTimeout(() => offerThanks(cl), 300);
    reset();
    if (params.apptId || params.clientId) navigate('cobrar', { replace: true, force: true });
  }

  function askCredit(total) {
    return new Promise((resolve) => {
      let out = null;
      const m = openModal({
        title: 'Forma de cobro', sub: `${esc(client.name)} · ${usd(total)}`, size: 'sm',
        body: `<div class="stack"><button class="btn btn-primary btn-lg btn-block" data-full>${icon('cash')} Paga completo ahora</button>
          <div class="box"><div class="field"><label>Deja a deber (fiado)</label><input class="input" inputmode="decimal" data-amt placeholder="Monto que queda pendiente" value=""></div><button class="btn btn-secondary btn-block" data-part>${icon('wallet')} Registrar con saldo pendiente</button><div class="hint">Lo que falte queda en su ficha y en "Saldos" para cobrarlo después.</div></div></div>`,
        footer: '<button class="btn btn-secondary" data-close>Cancelar</button>',
        onClose: () => resolve(out)
      });
      m.el.querySelector('[data-full]').onclick = () => { out = 0; m.close(); };
      m.el.querySelector('[data-part]').onclick = () => {
        const v = round2(parseNum(m.el.querySelector('[data-amt]').value) || 0);
        if (!(v > 0)) { toast('Indica el monto que queda pendiente', 'warning'); return; }
        out = Math.min(v, total); m.close();
      };
    });
  }

  function offerThanks(cl) {
    const m = openModal({
      title: 'Mensaje de gracias', sub: esc(cl.name), size: 'sm',
      body: `<p class="small">Envíale sus sellos, su tarjeta y el enlace para agendar el próximo corte. Los clientes que reciben este mensaje vuelven antes.</p>${stampsHTML(cl, true)}`,
      footer: `<button class="btn btn-secondary" data-close>Ahora no</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar por WhatsApp</button>`
    });
    m.el.querySelector('[data-wa]').onclick = () => { waClient('gracias', { client: cl }); m.close(); };
  }

  function reset() { cart = []; client = null; appt = null; style = null; photo = null; tips = {}; closeCart(); renderAll(); }

  const openCart = () => { $('#cart').classList.add('open'); $('#cart-bd').classList.add('open'); };
  const closeCart = () => { $('#cart').classList.remove('open'); $('#cart-bd').classList.remove('open'); };
  $('#cart-fab').onclick = openCart; $('#cart-bd').onclick = closeCart;
  $('#c-pay').onclick = pay;
  $('#c-clear').onclick = reset;
  $('#pos-club').onclick = async () => { const r = await clubModal(client); if (r?.client && client) { client = r.client; renderAll(); } };
  const sInp = $('#pos-search');
  sInp.oninput = debounce((e) => { search = e.target.value; renderGrid(); }, 100);
  sInp.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const v = sInp.value.trim().toLowerCase(); if (!v) return;
    const exact = sellable().find((p) => (p.sku || '').toLowerCase() === v);
    if (exact) { addProduct(exact); sInp.value = ''; search = ''; renderGrid(); }
  };

  // ---------- Viene desde una cita / turno o desde la ficha del cliente ----------
  if (params.apptId) {
    const a = store.appointments.find((x) => x.id === params.apptId);
    if (a && a.status !== 'terminada') {
      appt = a;
      barberId = a.barberId || barberId;
      client = a.clientId ? store.client(a.clientId) : null;
      if (!client && a.clientName) client = { name: a.clientName, phone: a.clientPhone || '' };
      if (client && !client.id) client = store.findByPhone(client.phone) || client;
      (a.serviceIds || []).forEach((id) => addService(store.service(id), a.barberId, { silent: true }));
      style = client?.lastStyle || null;
    }
  } else if (params.clientId) {
    client = store.client(params.clientId);
    const last = client?.lastServiceIds || [];
    if (client?.lastBarberId && store.barber(client.lastBarberId)) barberId = client.lastBarberId;
    if (last.length && !cart.length) last.forEach((id) => addService(store.service(id), barberId, { silent: true }));
    style = client?.lastStyle || null;
  }
  renderBarbers(); renderTabs(); renderAll();
  return store.on('*', (evt) => {
    if (evt === 'products') { renderTabs(); renderGrid(); }
    if (evt === 'settings') { renderBarbers(); renderTabs(); renderAll(); }
    if (evt === 'clients' && client?.id) { const fresh = store.client(client.id); if (fresh) { client = fresh; renderCtx(); } }
  });
}
