// SanoCortes — Productos e inventario: ceras, pomadas, cuidado de barba, insumos, existencia y vencimientos
import { store } from '../store.js';
import { moveProduct } from '../ops.js';
import { requirePin } from '../auth.js';
import { fmtDate, todayKey } from '../utils.js';
import { esc, usd, bs, num, toast, openModal, emptyState, parseNum, setBusy, normalize, debounce, qtyFmt, fmtDateTime, toCSV, download, parseCSV, nowISO, confirmDialog, startOfDay, endOfDay, addDays, dayKey, fromKey, round2, waLink } from '../utils.js';
import { icon } from '../icons.js';
import { printDoc } from '../shared.js';

const MOVE = { compra: 'Compra', entrada: 'Entrada', merma: 'Merma / daño', salida: 'Salida', conteo: 'Conteo físico', uso: 'Usado en atención', devolucion: 'Devolución', venta: 'Venta' };

export function mount(el, { params = {} }) {
  let tab = 'items';
  let cat = 'all';
  let search = params.q || '';
  let only = 'all';
  let logs = null; let from = dayKey(addDays(new Date(), -15)); let to = dayKey();

  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Productos e inventario</h1><p class="view-sub">Ceras, pomadas, aceites y cuidado de barba para vender, e insumos de uso interno: existencia, costo, ganancia y vencimientos.</p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="i-imp">${icon('upload')} Importar</button><button class="btn btn-secondary" id="i-exp">${icon('download')} Exportar</button><button class="btn btn-secondary" id="i-buy">${icon('truck')} Registrar compra</button><button class="btn btn-primary" id="i-new">${icon('plus')} Nuevo producto</button></div></div>
    <div class="kpis" id="i-kpis"></div>
    <div class="tabs"><button data-tab="items">Productos</button><button data-tab="logs">Movimientos</button><button data-tab="shop">Lista de compras</button></div>
    <div id="i-body"></div>`;
  const $ = (s) => el.querySelector(s);

  function kpis() {
    const act = store.products.filter((p) => p.active !== false);
    const value = act.reduce((a, p) => a + Math.max(0, p.stock || 0) * (p.cost || 0), 0);
    const sale = act.reduce((a, p) => a + Math.max(0, p.stock || 0) * (p.price || 0), 0);
    $('#i-kpis').innerHTML = `
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Productos</span><span class="kpi-icon tone-brand">${icon('box')}</span></div><div class="kpi-value">${act.length}</div><div class="kpi-sub">${act.reduce((a, p) => a + Math.max(0, p.stock || 0), 0)} unidades</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Valor a costo</span><span class="kpi-icon tone-info">${icon('dollar')}</span></div><div class="kpi-value">${usd(value)}</div><div class="kpi-sub">a precio de venta ${usd(sale)}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Stock bajo</span><span class="kpi-icon tone-warning">${icon('alert')}</span></div><div class="kpi-value">${store.lowProducts.length - store.outProducts.length}</div><div class="kpi-sub">en o bajo el mínimo</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Vencidos / por vencer</span><span class="kpi-icon tone-danger">${icon('clock')}</span></div><div class="kpi-value">${store.expiringProducts.length}</div><div class="kpi-sub">${store.outProducts.length} agotado(s) · próximos 60 días</div></div>`;
  }

  function render() {
    kpis();
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'items') renderItems();
    if (tab === 'logs') renderLogs();
    if (tab === 'shop') renderShop();
  }

  function renderItems() {
    const cats = [...new Set(store.products.map((p) => p.category).filter(Boolean))];
    const t = normalize(search);
    const list = store.products.filter((p) => (cat === 'all' || p.category === cat)
      && (only === 'all' || (only === 'low' && store.lowProducts.includes(p)) || (only === 'exp' && store.expiringProducts.includes(p)) || (only === 'sell' && p.sellable !== false) || (only === 'parts' && p.sellable === false))
      && (!t || normalize(`${p.name} ${p.sku || ''} ${p.compatible || ''} ${p.supplier || ''} ${p.lot || ''}`).includes(t)));
    $('#i-body').innerHTML = `<div class="card card-flush">
      <div class="toolbar"><label class="search">${icon('search')}<input id="i-search" placeholder="Buscar por nombre, marca, código o lote…" value="${esc(search)}"></label>
        <select class="select" id="i-cat" style="width:auto;min-width:160px"><option value="all">Todas las categorías</option>${cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <div class="seg">${[['all', 'Todos'], ['low', 'Stock bajo'], ['exp', 'Por vencer'], ['sell', 'Se cobran'], ['parts', 'Uso interno']].map(([k, l]) => `<button data-only="${k}" class="${only === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${list.length ? `<div class="table-wrap"><table class="table rt"><thead><tr><th>Producto</th><th class="hide-sm">Categoría / vence</th><th>Existencia</th><th class="r hide-sm">Costo</th><th class="r">Precio</th><th class="r hide-sm">Margen</th><th class="r"></th></tr></thead><tbody>
        ${list.map((p) => {
          const st = Number(p.stock) || 0; const min = Number(p.minStock) || 0; const tracked = p.trackStock !== false;
          const cls = !tracked ? '' : st <= 0 ? 'out' : st <= min ? 'low' : '';
          const margin = p.price > 0 ? ((p.price - (p.cost || 0)) / p.price) * 100 : 0;
          return `<tr style="${p.active === false ? 'opacity:.5' : ''}">
            <td><div class="t-name">${esc(p.name)}</div><div class="t-sub">${[p.sku && 'Cód. ' + esc(p.sku), p.compatible && esc(p.compatible), p.lot && 'Lote ' + esc(p.lot), p.sellable === false && 'Uso interno'].filter(Boolean).join(' · ')}</div></td>
            <td class="hide-sm small">${esc(p.category || '—')}${p.expiresAt ? `<div><span class="badge ${p.expiresAt < todayKey() ? 'badge-danger' : store.expiringProducts.includes(p) ? 'badge-warning' : 'badge-neutral'}">${p.expiresAt < todayKey() ? 'Vencido' : 'Vence'} ${fmtDate(p.expiresAt)}</span></div>` : ''}</td>
            <td>${tracked ? `<div class="row" style="gap:8px"><b class="num ${cls === 'out' ? 'text-danger' : cls === 'low' ? 'text-warning' : ''}">${qtyFmt(st)}</b><div class="stockbar ${cls}"><i style="width:${Math.min(100, min > 0 ? st / (min * 3) * 100 : st > 0 ? 100 : 0)}%"></i></div></div><div class="t-sub">mín. ${qtyFmt(min)}</div>` : '<span class="faint small">No controla</span>'}</td>
            <td class="r num hide-sm">${usd(p.cost || 0)}</td>
            <td class="r num"><b>${usd(p.price || 0)}</b></td>
            <td class="r hide-sm"><span class="badge ${margin >= 40 ? 'badge-success' : margin >= 20 ? 'badge-warning' : 'badge-danger'}">${num(margin, 0)}%</span></td>
            <td class="r nowrap"><button class="btn btn-secondary btn-sm" data-mv="${p.id}">${icon('layers')} Mover</button><button class="btn btn-ghost btn-icon btn-sm" data-ed="${p.id}">${icon('edit')}</button></td></tr>`;
        }).join('')}</tbody></table></div>` : `<div style="padding:20px">${emptyState('box', store.products.length ? 'Sin resultados' : 'Aún no hay productos', store.products.length ? '' : 'Agrega anestésicos, resinas, inyectables, material de curas y descartables, o impórtalos desde Excel.')}</div>`}
    </div>`;
    const si = $('#i-search');
    si.oninput = debounce((e) => { search = e.target.value; renderItems(); const n = $('#i-search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 160);
    $('#i-cat').onchange = (e) => { cat = e.target.value; renderItems(); };
    el.querySelectorAll('[data-only]').forEach((b) => b.onclick = () => { only = b.dataset.only; renderItems(); });
    el.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => moveModal(store.product(b.dataset.mv)));
    el.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => editModal(store.product(b.dataset.ed)));
  }

  async function renderLogs() {
    $('#i-body').innerHTML = `<div class="card card-flush"><div class="toolbar"><input class="input input-sm" type="date" id="l-from" value="${from}" style="width:auto"><span class="muted">a</span><input class="input input-sm" type="date" id="l-to" value="${to}" style="width:auto"></div><div id="l-list"><div class="empty"><div class="spinner"></div></div></div></div>`;
    $('#l-from').onchange = (e) => { from = e.target.value; logs = null; renderLogs(); };
    $('#l-to').onchange = (e) => { to = e.target.value; logs = null; renderLogs(); };
    if (!logs) { try { logs = (await store.listBetween('inventory_logs', 'date', startOfDay(fromKey(from)).toISOString(), endOfDay(fromKey(to)).toISOString())).sort((a, b) => (b.date || '').localeCompare(a.date || '')); } catch (_) { logs = []; } }
    if (tab !== 'logs' || !$('#l-list')) return;
    $('#l-list').innerHTML = logs.length ? `<div class="table-wrap"><table class="table rt"><thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th class="r">Cantidad</th><th class="hide-sm">Detalle</th></tr></thead><tbody>
      ${logs.map((l) => `<tr><td class="small nowrap">${fmtDateTime(l.date)}</td><td class="t-name">${esc(l.name)}</td><td><span class="badge ${l.qty >= 0 ? 'badge-success' : l.type === 'merma' ? 'badge-danger' : 'badge-neutral'}">${MOVE[l.type] || l.type}</span></td><td class="r num ${l.qty >= 0 ? 'text-success' : 'text-danger'}"><b>${l.qty > 0 ? '+' : ''}${qtyFmt(l.qty)}</b></td><td class="hide-sm small muted">${esc(l.reason || '')}${l.by ? ' · ' + esc(l.by) : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div style="padding:16px">${emptyState('layers', 'Sin movimientos en estas fechas')}</div>`;
  }

  function shopList() {
    return store.lowProducts.map((p) => ({ p, qty: Math.max(1, Math.ceil((Number(p.minStock) || 1) * 2 - (Number(p.stock) || 0))) }));
  }
  function renderShop() {
    const list = shopList();
    $('#i-body').innerHTML = `<div class="card">${list.length ? `
      <div class="card-head"><div class="card-title">${icon('truck')} Sugerido para comprar</div><div class="row"><button class="btn btn-secondary btn-sm" id="s-print">${icon('print')} Imprimir</button><button class="btn btn-whatsapp btn-sm" id="s-wa">${icon('whatsapp')} Enviar</button></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Producto</th><th class="r">Existencia</th><th class="r">Mínimo</th><th class="r">Comprar</th><th class="r hide-sm">Costo aprox.</th></tr></thead><tbody>
      ${list.map(({ p, qty }) => `<tr><td><b>${esc(p.name)}</b><div class="t-sub">${esc(p.supplier || p.category || '')}</div></td><td class="r num ${(p.stock || 0) <= 0 ? 'text-danger' : 'text-warning'}">${qtyFmt(p.stock || 0)}</td><td class="r num">${qtyFmt(p.minStock || 0)}</td><td class="r num"><b>${qty}</b></td><td class="r num hide-sm">${usd(qty * (p.lastCost || p.cost || 0))}</td></tr>`).join('')}
      </tbody></table></div><div class="r mt bold">Total aproximado: ${usd(list.reduce((a, x) => a + x.qty * (x.p.lastCost || x.p.cost || 0), 0))}</div>` : emptyState('check', 'No hace falta comprar nada', 'Todos los insumos están sobre su existencia mínima.')}</div>`;
    if (!list.length) return;
    const text = `*Lista de compras · ${store.businessName}*\n\n${list.map(({ p, qty }) => `• ${qty} × ${p.name}${p.compatible ? ` (${p.compatible})` : ''}`).join('\n')}`;
    $('#s-wa').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    $('#s-print').onclick = () => printDoc('Lista de compras', `<table><thead><tr><th>Producto</th><th>Proveedor</th><th class="r">Existencia</th><th class="r">Comprar</th></tr></thead><tbody>${list.map(({ p, qty }) => `<tr><td>${esc(p.name)}</td><td>${esc(p.supplier || '')}</td><td class="r">${qtyFmt(p.stock || 0)}</td><td class="r"><b>${qty}</b></td></tr>`).join('')}</tbody></table>`);
  }

  function editModal(p = null) {
    const isNew = !p;
    p ||= { name: '', category: store.settings.categories[0], compatible: '', sku: '', cost: 0, price: 0, stock: 0, minStock: 2, supplier: '', lot: '', expiresAt: '', unit: 'unidad', sellable: true, trackStock: true, active: true };
    const m = openModal({
      title: isNew ? 'Nuevo producto' : 'Editar producto', size: 'lg',
      body: `<form class="form-grid" data-f autocomplete="off">
        <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(p.name)}" placeholder="Ej.: Pomada mate efecto seco 100 g" autofocus></div>
        <div class="field"><label>Categoría</label><select class="select" name="category">${[...new Set([...store.settings.categories, p.category].filter(Boolean))].map((c) => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>Código / SKU</label><input class="input" name="sku" value="${esc(p.sku || '')}" placeholder="Opcional (código de barras)"></div>
        <div class="field full"><label>Marca / presentación</label><input class="input" name="compatible" value="${esc(p.compatible || '')}" placeholder="Ej.: Reuzel · 113 g"></div>
        <div class="field"><label>Lote</label><input class="input" name="lot" value="${esc(p.lot || '')}" placeholder="Opcional"></div>
        <div class="field"><label>Fecha de vencimiento</label><input class="input" type="date" name="expiresAt" value="${esc(p.expiresAt || '')}"></div>
        <div class="field"><label>Costo</label><input class="input" name="cost" inputmode="decimal" value="${num(p.cost || 0)}"></div>
        <div class="field"><label>Precio de venta</label><input class="input" name="price" inputmode="decimal" value="${num(p.price || 0)}"><span class="hint" data-mg></span></div>
        ${isNew ? `<div class="field"><label>Existencia inicial</label><input class="input" name="stock" inputmode="decimal" value="${qtyFmt(p.stock || 0)}"></div>` : ''}
        <div class="field"><label>Existencia mínima (alerta)</label><input class="input" name="minStock" inputmode="decimal" value="${qtyFmt(p.minStock || 0)}"></div>
        <div class="field ${isNew ? '' : 'full'}"><label>Proveedor</label><input class="input" name="supplier" value="${esc(p.supplier || '')}"></div>
        <label class="check box box-white full"><span class="switch"><input type="checkbox" name="sellable" ${p.sellable !== false ? 'checked' : ''}><span></span></span><span><b>Se vende al cliente</b><br><small class="muted">Aparece en “Cobrar”. Apágalo para insumos de uso interno (cuchillas, capas, talco, alcohol…).</small></span></label>
        <label class="check box box-white full"><span class="switch"><input type="checkbox" name="trackStock" ${p.trackStock !== false ? 'checked' : ''}><span></span></span><span><b>Controlar existencia</b><br><small class="muted">Descuenta la existencia al venderlo y avisa cuando se acaba.</small></span></label>
        <div class="error-msg full" data-err></div>
      </form>`,
      footer: `${isNew ? '' : `<button class="btn btn-danger-soft" data-del style="margin-right:auto">${icon('trash')} ${p.active === false ? 'Eliminar' : 'Desactivar'}</button>`}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    const mg = () => { const c = parseNum(F.cost.value), pr = parseNum(F.price.value); m.el.querySelector('[data-mg]').textContent = pr > 0 ? `Ganancia ${usd(pr - c)} (${num(((pr - c) / pr) * 100, 0)}%)` : ''; };
    F.cost.oninput = mg; F.price.oninput = mg; mg();
    const save = async (e) => {
      e?.preventDefault();
      const name = F.name.value.trim();
      if (!name) { m.el.querySelector('[data-err]').textContent = 'Escribe el nombre.'; return; }
      const data = { name, category: F.category.value, sku: F.sku.value.trim(), compatible: F.compatible.value.trim(), cost: round2(parseNum(F.cost.value)), price: round2(parseNum(F.price.value)), minStock: parseNum(F.minStock.value), supplier: F.supplier.value.trim(), lot: F.lot.value.trim(), expiresAt: F.expiresAt.value || '', sellable: F.sellable.checked, trackStock: F.trackStock.checked, active: true, updatedAt: nowISO() };
      if (isNew) { data.stock = parseNum(F.stock.value); data.createdAt = nowISO(); data.sold = 0; }
      const id = isNew ? store.newRef('products').id : p.id;
      await store.save('products', id, data, !isNew);
      m.close(); toast(isNew ? 'Producto creado' : 'Producto actualizado');
    };
    m.el.querySelector('[data-f]').onsubmit = save;
    m.el.querySelector('[data-ok]').onclick = save;
    m.el.querySelector('[data-del]') && (m.el.querySelector('[data-del]').onclick = async () => {
      if (!(await requirePin('Eliminar o desactivar un producto'))) return;
      if (p.active === false) {
        if (!(await confirmDialog({ title: 'Eliminar producto', message: `¿Eliminar <b>${esc(p.name)}</b> definitivamente?`, confirmText: 'Eliminar', danger: true }))) return;
        await store.remove('products', p.id);
      } else await store.save('products', p.id, { active: false, updatedAt: nowISO() });
      m.close(); toast(p.active === false ? 'Producto eliminado' : 'Producto desactivado', 'warning');
    });
  }

  function moveModal(p, mode = 'compra') {
    if (!p) { pickForBuy(); return; }
    let cur = 'USD';
    const m = openModal({
      title: `Mover: ${esc(p.name)}`, sub: `Existencia: ${qtyFmt(p.stock || 0)} · costo promedio ${usd(p.cost || 0)}${p.expiresAt ? ' · vence ' + fmtDate(p.expiresAt) : ''}`, size: 'md',
      body: `<div class="stack"><div class="seg seg-block" data-modes>${[['compra', 'Compra'], ['entrada', 'Entrada'], ['merma', 'Merma'], ['conteo', 'Conteo']].map(([k, l]) => `<button type="button" data-m="${k}" class="${k === mode ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="field"><label data-ql>Cantidad</label><input class="input input-lg" data-q inputmode="decimal" placeholder="0" autofocus></div>
        <div class="field" data-costf><label>Costo por unidad ($)</label><input class="input" data-c inputmode="decimal" value="${num(p.lastCost || p.cost || 0)}"></div>
        <div class="form-grid" data-lotf><div class="field"><label>Lote</label><input class="input" data-lot value="${esc(p.lot || '')}"></div><div class="field"><label>Vence</label><input class="input" type="date" data-exp></div></div>
        <label class="check" data-payf><input type="checkbox" data-pay> <span>Pagar con dinero de la caja</span></label>
        <div data-curf hidden></div>
        <div class="field"><label>Nota</label><input class="input" data-r placeholder="Ej.: proveedor, factura, uso interno en la silla 2, motivo de la merma"></div>
        <div class="hint" data-h></div><div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Registrar</button>`
    });
    const q = (s) => m.el.querySelector(s);
    const upd = () => {
      q('[data-costf]').hidden = mode !== 'compra'; q('[data-lotf]').hidden = mode !== 'compra' && mode !== 'entrada'; q('[data-payf]').hidden = mode !== 'compra'; q('[data-curf]').hidden = mode !== 'compra' || !q('[data-pay]').checked;
      q('[data-ql]').textContent = mode === 'conteo' ? 'Cantidad contada (nueva existencia)' : 'Cantidad';
      const n = parseNum(q('[data-q]').value);
      q('[data-h]').textContent = mode === 'compra' ? `Total de la compra: ${usd(n * parseNum(q('[data-c]').value))}` : mode === 'conteo' ? `Diferencia: ${qtyFmt(n - (p.stock || 0))}` : '';
      m.el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    };
    m.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; upd(); });
    m.el.querySelectorAll('[data-cur]').forEach((b) => b.onclick = () => { cur = b.dataset.cur; m.el.querySelectorAll('[data-cur]').forEach((x) => x.classList.toggle('on', x === b)); });
    q('[data-q]').oninput = upd; q('[data-c]').oninput = upd; q('[data-pay]').onchange = upd; upd();
    q('[data-ok]').onclick = async (e) => {
      const qty = parseNum(q('[data-q]').value);
      if (!(qty > 0) && !(mode === 'conteo' && q('[data-q]').value.trim() !== '')) { q('[data-err]').textContent = 'Indica la cantidad.'; return; }
      if ((mode === 'merma' || mode === 'conteo') && !(await requirePin(mode === 'merma' ? 'Registrar una merma' : 'Ajustar por conteo'))) return;
      setBusy(e.currentTarget, true);
      try { await moveProduct(p, { mode, qty, unitCost: parseNum(q('[data-c]').value), reason: q('[data-r]').value.trim(), payFromCash: q('[data-pay]').checked, payCurrency: cur, lot: q('[data-lot]').value.trim(), expiresAt: q('[data-exp]').value || '' }); m.close(); toast('Movimiento registrado'); logs = null; }
      catch (ex) { q('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  }

  function pickForBuy() {
    const m = openModal({ title: 'Registrar compra', sub: 'Elige el producto que compraste', size: 'md', body: `<div class="stack"><label class="search">${icon('search')}<input data-q placeholder="Buscar producto" autofocus></label><div class="list" data-l style="max-height:380px;overflow:auto"></div></div>` });
    const draw = (t = '') => {
      const n = normalize(t);
      m.el.querySelector('[data-l]').innerHTML = store.products.filter((p) => p.active !== false && (!n || normalize(p.name + ' ' + (p.compatible || '')).includes(n))).slice(0, 40).map((p) => `<div class="list-item click" data-p="${p.id}"><div class="grow"><b>${esc(p.name)}</b><div class="t-sub">${esc(p.category || '')} · stock ${qtyFmt(p.stock || 0)}</div></div>${icon('arrowRight')}</div>`).join('') || emptyState('box', 'Sin insumos');
      m.el.querySelectorAll('[data-p]').forEach((x) => x.onclick = () => { m.close(); moveModal(store.product(x.dataset.p), 'compra'); });
    };
    m.el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
    draw();
  }

  function importCSV() {
    const m = openModal({
      title: 'Importar productos', sub: 'Desde Excel guardado como CSV (separado por punto y coma o coma).', size: 'md',
      body: `<div class="stack"><div class="box small">Columnas en este orden: <b>Nombre; Categoría; Marca/presentación; Costo; Precio; Existencia; Mínimo; Código; Lote; Vence (AAAA-MM-DD)</b>. La primera fila puede ser el encabezado.</div>
        <button class="btn btn-secondary" data-tpl>${icon('download')} Descargar plantilla</button>
        <input type="file" accept=".csv,text/csv" class="input" data-file style="padding-top:8px"><div class="hint" data-h></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok disabled>${icon('upload')} Importar</button>`
    });
    let rows = [];
    m.el.querySelector('[data-tpl]').onclick = () => download('plantilla-inventario.csv', toCSV([['Nombre', 'Categoría', 'Presentación', 'Costo', 'Precio', 'Existencia', 'Mínimo', 'Código', 'Lote', 'Vence'], ['Proteína whey 2 lb', 'Proteínas', 'Chocolate · 28 servicios', '0.8', '3', '20', '5', '', 'L2301', '2027-06-30'], ['Gasas estériles 10x10', 'Material de curas', 'Sobre x 10', '0.5', '1.5', '50', '10', '', '', '']]));
    m.el.querySelector('[data-file]').onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      rows = parseCSV(await file.text());
      if (rows.length && /nombre/i.test(rows[0][0])) rows.shift();
      rows = rows.filter((r) => r[0]);
      m.el.querySelector('[data-h]').textContent = `${rows.length} producto(s) listos para importar.`;
      m.el.querySelector('[data-ok]').disabled = !rows.length;
    };
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      setBusy(e.currentTarget, true);
      for (let i = 0; i < rows.length; i += 80) {
        const b = store.batch();
        rows.slice(i, i + 80).forEach((r) => b.set(store.newRef('products'), { name: r[0], category: r[1] || 'Otros', compatible: r[2] || '', cost: round2(parseNum(r[3])), price: round2(parseNum(r[4])), stock: parseNum(r[5]), minStock: parseNum(r[6]), sku: r[7] || '', lot: r[8] || '', expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(r[9] || '') ? r[9] : '', supplier: '', sellable: true, trackStock: true, active: true, sold: 0, createdAt: nowISO(), updatedAt: nowISO() }));
        await store.commit(b);
      }
      m.close(); toast(`${rows.length} producto(s) importados`);
    };
  }

  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
  $('#i-new').onclick = () => editModal();
  $('#i-buy').onclick = () => pickForBuy();
  $('#i-imp').onclick = importCSV;
  $('#i-exp').onclick = () => download(`inventario-${dayKey()}.csv`, toCSV([['Nombre', 'Categoría', 'Presentación', 'Costo', 'Precio', 'Existencia', 'Mínimo', 'Código', 'Lote', 'Vence', 'Proveedor', 'Se cobra'], ...store.products.map((p) => [p.name, p.category, p.compatible || '', num(p.cost || 0), num(p.price || 0), p.stock || 0, p.minStock || 0, p.sku || '', p.lot || '', p.expiresAt || '', p.supplier || '', p.sellable !== false ? 'Sí' : 'No'])]));
  render();
  return store.on('products', () => { if (tab !== 'logs') render(); else kpis(); });
}
