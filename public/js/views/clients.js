// SanoCortes — Clientes: lista con filtros (les toca, club, premios, saldo…), búsqueda, importar y exportar
import { store, clientBadge, CLIENT_STATUS } from '../store.js';
import { saveClient } from '../ops.js';
import { esc, usd, normalize, debounce, emptyState, fmtDate, toast, download, toCSV, parseCSV, openModal, setBusy, todayKey } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, hydratePhotos, openClient, clientForm, clientLine, stampsHTML } from '../client.js';
import { styleLine } from '../barber.js';

const FILTERS = {
  all: ['Todos', () => true],
  le_toca: ['Les toca corte', (c) => ['le_toca', 'atrasado'].includes(store.clientStatus(c))],
  nuevo: ['Nuevos (30 días)', (c) => (c.createdAt || '') >= new Date(Date.now() - 30 * 864e5).toISOString()],
  frecuentes: ['Frecuentes', (c) => (c.visits || 0) >= 6 && c.avgDays && c.avgDays <= 25],
  club: ['Con club', (c) => c.membership && c.membership.status !== 'anulada' && c.membership.end >= todayKey()],
  premio: ['Con premio', (c) => Number(c.rewards) > 0],
  saldo: ['Con saldo', (c) => (Number(c.balance) || 0) > 0.009],
  perdido: ['Perdidos', (c) => store.clientStatus(c) === 'perdido'],
  baja: ['De baja', (c) => c.active === false]
};

export function mount(el) {
  let filter = 'all'; let q = ''; let sort = 'name'; let barber = '';
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Clientes</h1><p class="view-sub" id="c-sub"></p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="c-imp">${icon('upload')} Importar</button><button class="btn btn-secondary" id="c-exp">${icon('download')} Exportar</button><button class="btn btn-primary" id="c-new">${icon('userPlus')} Nuevo cliente</button></div></div>
    <div class="card card-flush">
      <div class="toolbar"><label class="search">${icon('search')}<input id="c-q" placeholder="Nombre, teléfono, N° o código de tarjeta…"></label>
        <div class="row" style="gap:6px"><select class="select select-sm" id="c-barber" style="width:auto"><option value="">Todos los barberos</option>${store.activeBarbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <select class="select select-sm" id="c-sort" style="width:auto"><option value="name">A–Z</option><option value="recent">Último corte</option><option value="visits">Más visitas</option><option value="spent">Más gasto</option><option value="due">Más atrasados</option></select></div></div>
      <div class="chips" id="c-chips" data-tour="filters" style="padding:0 14px 12px"></div>
      <div id="c-list"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  const rows = () => {
    const t = normalize(q); const d = q.replace(/\D/g, '');
    const f = FILTERS[filter][1];
    const list = store.clients.filter((c) => (filter === 'baja' ? c.active === false : c.active !== false && f(c)) && (!barber || c.barberId === barber || c.lastBarberId === barber)
      && (!t || normalize(`${c.name} ${c.number} ${c.cardCode || ''}`).includes(t) || (d.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(d))));
    const S = {
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      recent: (a, b) => (b.lastVisitAt || '').localeCompare(a.lastVisitAt || ''),
      visits: (a, b) => (b.visits || 0) - (a.visits || 0),
      spent: (a, b) => (b.totalSpent || 0) - (a.totalSpent || 0),
      due: (a, b) => ((store.daysSince(b) ?? -1) - store.cycleOf(b)) - ((store.daysSince(a) ?? -1) - store.cycleOf(a))
    };
    return list.sort(S[sort]);
  };

  function draw() {
    const live = store.liveClients.length;
    $('#c-sub').textContent = `${live} cliente(s) · ${store.dueClients.length} les toca corte · ${store.clients.filter(FILTERS.club[1]).length} en el club`;
    $('#c-chips').innerHTML = Object.entries(FILTERS).map(([k, [l, fn]]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l} <span class="count">${k === 'baja' ? store.clients.filter((c) => c.active === false).length : store.liveClients.filter(fn).length}</span></button>`).join('');
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
    const list = rows();
    $('#c-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table table-hover table-cards"><thead><tr><th>Cliente</th><th class="hide-sm">Último corte</th><th class="hide-sm">Estilo</th><th class="hide-sm">Sellos</th><th class="r hide-sm">Gasto</th><th class="c">Estado</th></tr></thead><tbody>
      ${list.slice(0, 300).map((c) => `<tr data-id="${c.id}" style="cursor:pointer">
        <td><div class="row">${avatar(c)}<div style="min-width:0"><div class="t-name ellipsis">${esc(c.name)}</div><div class="t-sub">${esc(c.number)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.barberId && store.barber(c.barberId) ? ' · ' + esc(store.barber(c.barberId).name.split(' ')[0]) : ''}</div></div></div></td>
        <td class="hide-sm small">${clientLine(c)}</td>
        <td class="hide-sm small ellipsis" style="max-width:220px">${c.lastStyle ? esc(styleLine(c.lastStyle)) : '<span class="faint">—</span>'}</td>
        <td class="hide-sm">${stampsHTML(c)}${Number(c.rewards) > 0 ? `<span class="badge badge-success">${icon('gift')} ${c.rewards}</span>` : ''}</td>
        <td class="r num hide-sm">${usd(c.totalSpent || 0)}<div class="t-sub">${c.visits || 0} visita(s)</div></td>
        <td class="c">${clientBadge(store.clientStatus(c))}${c.membership && c.membership.status !== 'anulada' && c.membership.end >= todayKey() ? `<div><span class="badge badge-violet">${icon('crown')} club</span></div>` : ''}${(Number(c.balance) || 0) > 0.009 ? `<div><span class="badge badge-danger">debe ${usd(c.balance)}</span></div>` : ''}</td></tr>`).join('')}
    </tbody></table></div>${list.length > 300 ? `<div class="small muted center" style="padding:10px">Mostrando 300 de ${list.length}. Usa la búsqueda.</div>` : ''}`
      : `<div style="padding:8px 16px 20px">${store.clients.length ? emptyState('users', 'Nadie en este filtro', q ? 'Prueba con otra búsqueda.' : '') : emptyState('users', 'Aún no hay clientes', 'Se registran solos al agendar o cobrar, o impórtalos desde Excel (CSV).')}</div>`;
    el.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => openClient(r.dataset.id));
    hydratePhotos($('#c-list'), 40);
  }

  $('#c-q').oninput = debounce((e) => { q = e.target.value; draw(); }, 100);
  $('#c-q').onkeydown = (e) => { if (e.key === 'Enter') { const c = store.findClient(e.target.value); if (c) openClient(c.id); } };
  $('#c-sort').onchange = (e) => { sort = e.target.value; draw(); };
  $('#c-barber').onchange = (e) => { barber = e.target.value; draw(); };
  $('#c-new').onclick = async () => { const c = await clientForm(); if (c) openClient(c.id); };
  $('#c-exp').onclick = () => exportCSV(rows());
  $('#c-imp').onclick = () => importCSV();
  draw();
  return store.on('clients', draw);
}

function exportCSV(list) {
  const t = todayKey();
  const head = ['N°', 'Nombre', 'Teléfono', 'Correo', 'Nacimiento', 'Barbero preferido', 'Estado', 'Visitas', 'Cada (días)', 'Último corte', 'Estilo', 'Sellos', 'Premios', 'Club', 'Saldo', 'Gasto total', 'Registro'];
  const data = list.map((c) => [c.number, c.name, c.phone || '', c.email || '', c.birthDate || '', store.barber(c.barberId)?.name || '', CLIENT_STATUS[store.clientStatus(c)]?.label || '', c.visits || 0, c.avgDays || '', (c.lastVisitAt || '').slice(0, 10), c.lastStyle ? styleLine(c.lastStyle) : '', c.stamps || 0, c.rewards || 0, c.membership?.name || '', Number(c.balance) || 0, Number(c.totalSpent) || 0, (c.createdAt || '').slice(0, 10)]);
  download(`clientes-${t}.csv`, toCSV([head, ...data]), 'text/csv;charset=utf-8');
  toast(`${data.length} cliente(s) exportados`);
}

/** Importa clientes desde CSV (Excel → Guardar como CSV). Detecta columnas por su nombre. */
function importCSV() {
  const m = openModal({
    title: 'Importar clientes', sub: 'Desde Excel o Google Sheets guardado como CSV', size: 'md',
    body: `<div class="stack"><p class="small" style="margin:0">La primera fila debe tener los títulos. Se reconocen: <b>Nombre</b> (obligatorio), <b>Teléfono</b>, <b>Correo</b>, <b>Nacimiento</b> (AAAA-MM-DD o DD/MM/AAAA), <b>Notas</b>. Los teléfonos repetidos se omiten.</p>
      <input type="file" accept=".csv,text/csv" class="input" data-file><div data-prev></div><div class="error-msg" data-err></div></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok disabled>${icon('upload')} Importar</button>`
  });
  let parsed = [];
  const pick = (h, ...keys) => h.findIndex((x) => keys.some((k) => normalize(x).includes(k)));
  const toDate = (v) => {
    const s = String(v || '').trim(); if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
    if (!d) return '';
    const y = d[3].length === 2 ? (Number(d[3]) > 30 ? '19' : '20') + d[3] : d[3];
    return `${y}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  };
  m.el.querySelector('[data-file]').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rowsIn = parseCSV(await f.text()).filter((r) => r.some((x) => String(x).trim()));
    const h = rowsIn.shift() || [];
    const ix = { name: pick(h, 'nombre', 'name', 'cliente'), phone: pick(h, 'telefono', 'celular', 'whatsapp', 'movil', 'phone'), email: pick(h, 'correo', 'email', 'mail'), birthDate: pick(h, 'nacimiento', 'fecha nac', 'cumple', 'birth'), notes: pick(h, 'nota', 'observ') };
    if (ix.name < 0) { m.el.querySelector('[data-err]').textContent = 'No encontré una columna “Nombre”.'; return; }
    const seen = new Set();
    parsed = rowsIn.map((r) => {
      const g = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '');
      return { name: g('name'), phone: g('phone'), email: g('email'), birthDate: toDate(g('birthDate')), notes: g('notes') };
    }).filter((x) => {
      if (!x.name) return false;
      const k = x.phone.replace(/\D/g, '').slice(-8);
      if (k.length >= 7) { if (seen.has(k) || store.findByPhone(x.phone)) return false; seen.add(k); }
      return true;
    });
    m.el.querySelector('[data-prev]').innerHTML = `<div class="box small"><b>${parsed.length}</b> cliente(s) nuevos listos para importar${rowsIn.length - parsed.length ? ` · ${rowsIn.length - parsed.length} omitido(s) por estar repetidos o sin nombre` : ''}.<div class="t-sub mt-xs">${parsed.slice(0, 4).map((x) => esc(x.name)).join(' · ')}${parsed.length > 4 ? '…' : ''}</div></div>`;
    m.el.querySelector('[data-ok]').disabled = !parsed.length;
  };
  m.el.querySelector('[data-ok]').onclick = async (e) => {
    const btn = e.currentTarget; setBusy(btn, true, 'Importando…');
    let ok = 0;
    for (const x of parsed) {
      try { await saveClient(x); ok++; btn.textContent = `Importando ${ok}/${parsed.length}…`; } catch (err) { console.warn(err.message); }
    }
    m.close(); toast(`${ok} cliente(s) importados`);
  };
}
