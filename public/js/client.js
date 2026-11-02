// SanoCortes — Clientes: buscador, formulario, ficha completa con historial de cortes (receta), sellos, club y tarjeta
import { store, clientBadge, apptBadge, SEX, daysBetween } from './store.js';
import { saveClient, setClientActive, renewCardCode, cardUrl, payBalance, sellPlan, adjustLoyalty } from './ops.js';
import { FADE_TYPES, GUARDS, TOP_STYLES, BEARD_STYLES, NECKLINE, HAIR_TYPES, SKIN_NOTES, DRINKS, styleLine } from './barber.js';
import { openModal, esc, usd, toast, setBusy, fmtDate, fmtDateTime, todayKey, dayKey, addDays, fromKey, loc, normalize, debounce, initials, colorFor, compressImage, confirmDialog, emptyState, methodLabel, printHTML, fmtAgo, num } from './utils.js';
import { icon } from './icons.js';
import { qrDataURL, waClient, printReceipt, PRINT_HEAD } from './shared.js';
import { db, doc, getDoc, setDoc, deleteDoc } from './firebase.js';
import { requirePin } from './auth.js';

const nav = async (route, params = {}) => { const { navigate } = await import('./main.js'); navigate(route, { params, force: true }); };

// ======================================================================
// FOTOS (colección aparte: la lista no carga imágenes). Cliente: id; corte: "v_" + id de la visita
// ======================================================================
const photoCache = new Map();
const photoRef = (id) => doc(db, 'tenants', store.tenantId, 'photos', id);
export async function loadPhoto(id) {
  if (!id || !store.tenantId) return '';
  if (photoCache.has(id)) return photoCache.get(id);
  const p = getDoc(photoRef(id)).then((s) => (s.exists() ? s.data().data || '' : '')).catch(() => '');
  photoCache.set(id, p);
  return p;
}
export async function clientPhoto(c) { return c?.hasPhoto ? loadPhoto(c.id) : ''; }
export async function savePhoto(id, data) {
  photoCache.set(id, Promise.resolve(data || ''));
  if (data) await setDoc(photoRef(id), { data, updatedAt: new Date().toISOString() });
  else await deleteDoc(photoRef(id)).catch(() => {});
}
export function avatar(c, size = '') {
  return `<span class="avatar ${size}" style="background:${colorFor(c?.name)}" ${c?.hasPhoto ? `data-ph="${c.id}"` : ''}>${esc(initials(c?.name))}</span>`;
}
export function hydratePhotos(root, max = 60) {
  [...root.querySelectorAll('[data-ph]')].slice(0, max).forEach(async (el) => {
    const src = await loadPhoto(el.dataset.ph);
    if (src && el.isConnected) { el.innerHTML = `<img src="${src}" alt="">`; el.classList.add('has-img'); el.removeAttribute('data-ph'); }
  });
}
export const clientLine = (c) => {
  const d = store.daysSince(c);
  return d == null ? 'Sin visitas aún' : `Último corte ${d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`}${c.avgDays ? ` · viene cada ${c.avgDays} días` : ''}`;
};
export function stampsHTML(c, big = false) {
  const L = store.loyalty;
  if (!L?.enabled) return '';
  const n = Math.min(Number(c?.stamps) || 0, L.every);
  return `<div class="stamps ${big ? 'stamps-lg' : ''}" title="${n} de ${L.every} sellos">${Array.from({ length: L.every }, (_, i) => `<i class="${i < n ? 'on' : ''}">${i < n ? icon('scissors') : ''}</i>`).join('')}</div>`;
}

// ======================================================================
// BUSCAR / ELEGIR CLIENTE
// ======================================================================
export function pickClient({ title = 'Buscar cliente', allowNew = true, filter = null } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    const m = openModal({
      title, size: 'md',
      body: `<div class="stack"><label class="search search-big">${icon('search')}<input data-q placeholder="Nombre, teléfono o N° de cliente…" autocomplete="off" autofocus></label><div class="pick-list" data-l></div></div>`,
      footer: `${allowNew ? `<button class="btn btn-secondary" data-new style="margin-right:auto">${icon('userPlus')} Cliente nuevo</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button>`,
      onClose: () => resolve(picked)
    });
    const draw = (q = '') => {
      const t = normalize(q); const d = q.replace(/\D/g, '');
      const list = store.clients.filter((x) => x.active !== false && (!filter || filter(x)) && (!t || normalize(`${x.name} ${x.number || ''}`).includes(t) || (d.length >= 3 && String(x.phone || '').replace(/\D/g, '').includes(d)))).slice(0, 40);
      m.el.querySelector('[data-l]').innerHTML = list.length ? list.map((x) => `<button type="button" class="list-item" data-id="${x.id}">${avatar(x)}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub">${esc(x.number)}${x.phone ? ' · ' + esc(x.phone) : ''} · ${clientLine(x)}</div></div>${clientBadge(store.clientStatus(x))}</button>`).join('')
        : emptyState('users', t ? 'Sin resultados' : 'Aún no hay clientes', allowNew ? 'Regístralo con “Cliente nuevo”.' : '');
      m.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { picked = store.client(b.dataset.id); m.close(); });
      hydratePhotos(m.el, 20);
    };
    m.el.querySelector('[data-q]').oninput = debounce((e) => draw(e.target.value), 80);
    m.el.querySelector('[data-q]').onkeydown = (e) => { if (e.key === 'Enter') { const f = store.findClient(e.target.value); if (f) { picked = f; m.close(); } } };
    const nb = m.el.querySelector('[data-new]');
    if (nb) nb.onclick = async () => { const q = m.el.querySelector('[data-q]').value.trim(); const isPhone = /\d{6,}/.test(q); const r = await clientForm(null, { name: isPhone ? '' : q, phone: isPhone ? q : '' }); if (r) { picked = r; m.close(); } };
    draw();
  });
}

// ======================================================================
// FORMULARIO DEL CLIENTE
// ======================================================================
export function clientForm(client = null, preset = {}) {
  const x = { ...preset, ...(client || {}) };
  let photo = null; let photoChanged = false;
  return new Promise((resolve) => {
    let saved = null;
    const hair = new Set(x.hairType || []); const skin = new Set(x.skin || []);
    const m = openModal({
      title: client ? 'Editar cliente' : 'Nuevo cliente', sub: client ? esc(client.number) : 'Con nombre y teléfono basta; lo demás ayuda a atenderlo como le gusta.', size: 'lg',
      body: `<form data-f autocomplete="off">
        <div class="mform">
          <div class="photo-pick" data-photo>${avatar(x, 'avatar-xl')}<label class="btn btn-secondary btn-sm">${icon('camera')} Foto<input type="file" accept="image/*" capture="user" data-file hidden></label>${x.hasPhoto ? `<button type="button" class="linkish small" data-rmph>Quitar foto</button>` : ''}</div>
          <div class="form-grid grow">
            <div class="field full"><label>Nombre y apellido *</label><input class="input" name="name" value="${esc(x.name || '')}" autofocus></div>
            <div class="field"><label>Teléfono / WhatsApp</label><input class="input" name="phone" inputmode="tel" value="${esc(x.phone || '')}" placeholder="Para recordatorios y su tarjeta"></div>
            <div class="field"><label>Fecha de nacimiento</label><input class="input" type="date" name="birthDate" value="${esc(x.birthDate || '')}"></div>
            <div class="field"><label>Barbero preferido</label><select class="select" name="barberId"><option value="">Cualquiera</option>${store.activeBarbers.map((b) => `<option value="${b.id}" ${x.barberId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Instagram</label><input class="input" name="instagram" value="${esc(x.instagram || '')}" placeholder="@usuario"></div>
          </div>
        </div>
        <div class="section-title mt-lg">${icon('comb')} Cabello y preferencias</div>
        <div class="field"><label>Tipo de cabello</label><div class="chips chips-wrap" data-hair>${HAIR_TYPES.map((c) => `<button type="button" class="chip ${hair.has(c) ? 'on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
        <div class="field mt"><label>Piel</label><div class="chips chips-wrap" data-skin>${SKIN_NOTES.map((c) => `<button type="button" class="chip ${skin.has(c) ? 'on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
        <div class="form-grid mt">
          <div class="field"><label>Bebida que prefiere</label><select class="select" name="drink"><option value="">—</option>${DRINKS.map((d) => `<option ${x.drink === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
          <div class="field"><label>Alergias o cuidados</label><input class="input" name="allergies" value="${esc(x.allergies || '')}" placeholder="Ej.: alergia al alcohol del aftershave"></div>
          <div class="field"><label>${esc(loc().id)} (opcional)</label><input class="input" name="idDoc" value="${esc(x.idDoc || '')}"></div>
          <div class="field"><label>Correo (opcional)</label><input class="input" name="email" inputmode="email" value="${esc(x.email || '')}"></div>
          <div class="field"><label>Si es menor: representante</label><input class="input" name="guardianName" value="${esc(x.guardianName || '')}" placeholder="Nombre del papá o la mamá"></div>
          <div class="field"><label>¿Cómo nos conoció?</label><select class="select" name="referredBy">${['', 'Instagram', 'TikTok', 'Facebook', 'Google Maps', 'Recomendación de un cliente', 'Pasaba por aquí', 'Reserva en línea', 'Otro'].map((o) => `<option ${x.referredBy === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          <div class="field full"><label>Notas para el barbero</label><input class="input" name="notes" value="${esc(x.notes || '')}" placeholder="Ej.: le gusta conversar de fútbol; no le gusta el talco"></div>
        </div>
        <div class="error-msg mt" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${client ? 'Guardar' : 'Registrar cliente'}</button>`,
      onClose: () => resolve(saved)
    });
    const F = m.el.querySelector('[data-f]').elements;
    const chipSet = (sel, set) => m.el.querySelectorAll(`${sel} [data-v]`).forEach((b) => b.onclick = () => { const v = b.dataset.v; set.has(v) ? set.delete(v) : set.add(v); b.classList.toggle('on', set.has(v)); });
    chipSet('[data-hair]', hair); chipSet('[data-skin]', skin);
    m.el.querySelector('[data-file]').onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { photo = await compressImage(f, 220, 0.72); photoChanged = true; m.el.querySelector('[data-photo] .avatar').outerHTML = `<span class="avatar avatar-xl has-img"><img src="${photo}" alt=""></span>`; }
      catch (_) { toast('No se pudo leer la imagen', 'warning'); }
    };
    m.el.querySelector('[data-rmph]')?.addEventListener('click', () => { photo = ''; photoChanged = true; m.el.querySelector('[data-photo] .avatar').outerHTML = avatar({ name: F.name.value }, 'avatar-xl'); });
    if (client?.hasPhoto) clientPhoto(client).then((src) => { const a = m.el.querySelector('[data-photo] .avatar'); if (src && a && !photoChanged) { a.innerHTML = `<img src="${src}" alt="">`; a.classList.add('has-img'); } });
    m.el.querySelector('[data-f]').onsubmit = (e) => { e.preventDefault(); m.el.querySelector('[data-ok]').click(); };
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      const err = m.el.querySelector('[data-err]'); err.textContent = '';
      if (!F.name.value.trim()) { err.textContent = 'Escribe el nombre del cliente.'; F.name.focus(); return; }
      const btn = e.currentTarget; setBusy(btn, true, 'Guardando…');
      const data = {
        name: F.name.value, phone: F.phone.value, birthDate: F.birthDate.value, barberId: F.barberId.value, instagram: F.instagram.value,
        hairType: [...hair], skin: [...skin], drink: F.drink.value, allergies: F.allergies.value, idDoc: F.idDoc.value, email: F.email.value,
        guardianName: F.guardianName.value, referredBy: F.referredBy.value, notes: F.notes.value
      };
      try {
        const out = await saveClient(data, client?.id || null);
        if (photoChanged) { await savePhoto(out.id, photo); await store.save('clients', out.id, { hasPhoto: !!photo }); out.hasPhoto = !!photo; }
        saved = { ...out, hasPhoto: photoChanged ? !!photo : out.hasPhoto };
        m.close();
        toast(client ? 'Cliente actualizado' : `Cliente registrado: ${saved.number}`);
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
  });
}

// ======================================================================
// FICHA DE ESTILO (la receta del corte)
// ======================================================================
/** Formulario de la receta del corte. Resuelve con { style, photo } o null. */
export function styleForm(initial = {}, { title = 'Ficha del corte', sub = 'Así cualquier barbero lo repite igual la próxima vez.', withPhoto = true, confirmText = 'Guardar ficha' } = {}) {
  const st = { fade: '', sides: '', top: '', topStyle: '', beard: '', neck: '', products: '', notes: '', ...initial };
  let photo = null;
  return new Promise((resolve) => {
    let out = null;
    const seg = (name, list) => `<div class="chips chips-wrap" data-seg="${name}">${list.map((v) => `<button type="button" class="chip ${st[name] === v ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
    const m = openModal({
      title, sub, size: 'lg',
      body: `<div class="stack">
        <div class="field"><label>Degradado</label>${seg('fade', FADE_TYPES)}</div>
        <div class="form-grid">
          <div class="field"><label>Máquina en los lados (#)</label><select class="select" data-k="sides"><option value="">—</option>${GUARDS.map((g) => `<option ${st.sides === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
          <div class="field"><label>Arriba</label><select class="select" data-k="top"><option value="">—</option>${['Tijera', ...GUARDS.map((g) => '#' + g)].map((g) => `<option ${st.top === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
          <div class="field"><label>Nuca</label><select class="select" data-k="neck"><option value="">—</option>${NECKLINE.map((g) => `<option ${st.neck === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
          <div class="field"><label>Productos usados</label><input class="input" data-k="products" value="${esc(st.products)}" placeholder="Ej.: pomada mate, aceite de barba"></div>
        </div>
        <div class="field"><label>Estilo de arriba</label>${seg('topStyle', TOP_STYLES)}</div>
        <div class="field"><label>Barba</label>${seg('beard', BEARD_STYLES)}</div>
        <div class="field"><label>Notas del corte</label><textarea class="textarea" data-k="notes" rows="2" placeholder="Ej.: raya al lado izquierdo con navaja, patillas a la mitad de la oreja, no rebajar mucho la coronilla">${esc(st.notes)}</textarea></div>
        ${withPhoto ? `<div class="row" style="gap:12px"><label class="btn btn-secondary">${icon('camera')} Foto del resultado<input type="file" accept="image/*" capture="environment" data-file hidden></label><div data-prev class="small muted">Opcional: queda en su historial para mostrarla la próxima vez.</div></div>` : ''}
        <div class="box small" data-line></div>
      </div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${esc(confirmText)}</button>`,
      onClose: () => resolve(out)
    });
    const line = () => { m.el.querySelector('[data-line]').innerHTML = `${icon('scissors')} ${esc(styleLine(st)) || 'Elige los detalles del corte.'}`; };
    m.el.querySelectorAll('[data-seg]').forEach((g) => g.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => {
      const k = g.dataset.seg; st[k] = st[k] === b.dataset.v ? '' : b.dataset.v;
      g.querySelectorAll('[data-v]').forEach((y) => y.classList.toggle('on', y.dataset.v === st[k])); line();
    }));
    m.el.querySelectorAll('[data-k]').forEach((i) => { i.oninput = i.onchange = () => { st[i.dataset.k] = i.value.trim(); line(); }; });
    const fi = m.el.querySelector('[data-file]');
    if (fi) fi.onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { photo = await compressImage(f, 520, 0.72); m.el.querySelector('[data-prev]').innerHTML = `<img src="${photo}" alt="" style="height:64px;border-radius:10px">`; } catch (_) { toast('No se pudo leer la imagen', 'warning'); }
    };
    m.el.querySelector('[data-ok]').onclick = () => { out = { style: { ...st }, photo }; m.close(); };
    line();
  });
}

// ======================================================================
// FICHA DEL CLIENTE
// ======================================================================
const TABS = { resumen: 'Resumen', cortes: 'Historial de cortes', citas: 'Citas', pagos: 'Pagos' };
export async function openClient(id, { tab = 'resumen' } = {}) {
  let cl = store.client(id) || await store.getClient(id);
  if (!cl) { toast('Cliente no encontrado', 'warning'); return; }
  const cache = {};
  const m = openModal({ title: '', size: 'xl', body: '<div data-root></div>' });
  m.el.querySelector('.modal').classList.add('member-modal');
  const root = m.el.querySelector('[data-root]');
  const load = async (k, fn) => (cache[k] ??= await fn().catch((e) => { console.error(e); return []; }));
  const off = store.on('clients', () => { const n = store.client(id); if (n) { cl = n; header(); } });
  const close0 = m.close; m.close = () => { off(); close0(); };

  root.innerHTML = `<div data-head></div><div class="tabs mt" data-tabs>${Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}</button>`).join('')}</div><div data-body class="mt"></div>`;
  const $ = (q) => root.querySelector(q);

  function header() {
    const st = store.clientStatus(cl);
    const bal = Number(cl.balance) || 0;
    const next = store.nextAppointmentOf(cl.id);
    const ms = cl.membership && cl.membership.status !== 'anulada' ? cl.membership : null;
    $('[data-head]').innerHTML = `<div class="mhead">
      ${avatar(cl, 'avatar-xl')}
      <div class="grow" style="min-width:0">
        <div class="row row-wrap"><h2 class="mhead-name">${esc(cl.name)}</h2>${clientBadge(st)}${bal > 0.009 ? `<span class="badge badge-danger">Debe ${usd(bal)}</span>` : ''}${Number(cl.rewards) > 0 ? `<span class="badge badge-success">${icon('gift')} ${cl.rewards} premio(s)</span>` : ''}${ms ? `<span class="badge badge-violet">${icon('crown')} ${esc(ms.name)} · ${ms.left} restante(s)</span>` : ''}</div>
        <div class="t-sub">${esc(cl.number)}${cl.phone ? ` · ${esc(cl.phone)}` : ''}${cl.barberId && store.barber(cl.barberId) ? ` · ${icon('scissors')} prefiere a ${esc(store.barber(cl.barberId).name)}` : ''}</div>
        <div class="small mt">${clientLine(cl)}${next ? ` · <b class="text-brand">Próxima cita: ${next.date === todayKey() ? 'hoy' : fmtDate(next.date)} ${esc(next.time)} con ${esc(next.barberName)}</b>` : ''}</div>
        ${cl.allergies ? `<div class="vital-alert warning mt-xs">${icon('alert')} ${esc(cl.allergies)}</div>` : ''}
      </div>
      <button class="x-btn" data-x aria-label="Cerrar">${icon('x')}</button>
    </div>
    <div class="mactions">
      <button class="btn btn-primary" data-a="appt">${icon('calendar')} Agendar cita</button>
      <button class="btn btn-success" data-a="walk">${icon('chair')} Turno ahora</button>
      <button class="btn btn-secondary" data-a="charge">${icon('cart')} Cobrar</button>
      <button class="btn btn-secondary" data-a="club">${icon('crown')} ${ms ? 'Renovar club' : 'Club'}</button>
      ${bal > 0.009 ? `<button class="btn btn-secondary" data-a="debt">${icon('dollar')} Cobrar saldo</button>` : ''}
      <button class="btn btn-secondary" data-a="card">${icon('qr')} Tarjeta</button>
      <button class="btn btn-whatsapp" data-a="wa">${icon('whatsapp')} WhatsApp</button>
      <button class="btn btn-ghost" data-a="edit">${icon('edit')} Editar</button>
      <button class="btn btn-ghost btn-icon" data-a="more" title="Más opciones">${icon('menu')}</button>
    </div>`;
    hydratePhotos($('[data-head]'));
    $('[data-x]').onclick = () => m.close();
    root.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => action(b.dataset.a));
  }

  async function action(a) {
    if (a === 'appt') { const { apptForm } = await import('./appt.js'); const r = await apptForm({ client: cl }); if (r) { cache.appts = null; header(); draw(); } }
    if (a === 'walk') { const { walkinForm } = await import('./appt.js'); const r = await walkinForm({ client: cl }); if (r) { m.close(); nav('turnos'); } }
    if (a === 'charge') { m.close(); nav('cobrar', { clientId: cl.id }); }
    if (a === 'club') { const r = await clubModal(cl); if (r) { cache.sales = null; header(); draw(); } }
    if (a === 'debt') { await payDebtModal(cl); cache.sales = null; draw(); }
    if (a === 'card') cardModal(cl);
    if (a === 'edit') { const r = await clientForm(cl); if (r) { cl = { ...cl, ...r }; header(); draw(); } }
    if (a === 'wa') waMenu(cl);
    if (a === 'more') moreMenu();
  }

  function moreMenu() {
    const mm = openModal({
      title: 'Más opciones', sub: esc(cl.name), size: 'sm',
      body: `<div class="list">
        ${store.loyalty.enabled ? `<button class="list-item" data-o="stamps">${icon('stamp')}<div class="grow"><b>Ajustar sellos y premios</b><div class="t-sub">Cortesía o corrección (PIN)</div></div></button>` : ''}
        <button class="list-item" data-o="style">${icon('scissors')}<div class="grow"><b>Anotar ficha de estilo</b><div class="t-sub">Sin cobrar (p. ej. de un corte anterior)</div></div></button>
        <button class="list-item" data-o="code">${icon('refresh')}<div class="grow"><b>Nuevo código de tarjeta</b><div class="t-sub">Si compartió su enlace</div></div></button>
        <button class="list-item" data-o="baja">${icon(cl.active === false ? 'unlock' : 'x')}<div class="grow"><b>${cl.active === false ? 'Reactivar cliente' : 'Dar de baja'}</b><div class="t-sub">${cl.active === false ? 'Vuelve a la lista de clientes' : 'Se conserva su historial'}</div></div></button>
      </div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    mm.el.querySelector('[data-o="stamps"]')?.addEventListener('click', async () => {
      mm.close();
      if (!(await requirePin('Ajustar sellos y premios'))) return;
      const f = openModal({
        title: 'Sellos y premios', sub: esc(cl.name), size: 'sm',
        body: `<div class="form-grid"><div class="field"><label>Sellos (de ${store.loyalty.every})</label><input class="input" type="number" min="0" max="${store.loyalty.every - 1}" data-s value="${Number(cl.stamps) || 0}"></div><div class="field"><label>Premios disponibles</label><input class="input" type="number" min="0" data-r value="${Number(cl.rewards) || 0}"></div><div class="field full"><label>Motivo</label><input class="input" data-why placeholder="Ej.: cortesía por la espera"></div></div>`,
        footer: '<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>'
      });
      f.el.querySelector('[data-ok]').onclick = async () => { await adjustLoyalty(cl, { stamps: f.el.querySelector('[data-s]').value, rewards: f.el.querySelector('[data-r]').value, reason: f.el.querySelector('[data-why]').value }); f.close(); toast('Sellos actualizados'); };
    });
    mm.el.querySelector('[data-o="style"]').onclick = async () => {
      mm.close();
      const r = await styleForm(cl.lastStyle || {}, { title: 'Ficha de estilo', confirmText: 'Guardar en el historial' });
      if (!r) return;
      const b = store.batch(); const ref = store.newRef('visits');
      b.set(ref, { clientId: cl.id, clientName: cl.name, date: new Date().toISOString(), dayKey: todayKey(), barberId: cl.barberId || null, barberName: store.barber(cl.barberId)?.name || '', services: ['Ficha anotada'], total: 0, saleId: null, style: r.style, hasPhoto: !!r.photo, manual: true, by: 'ficha' });
      b.set(store.ref('clients', cl.id), { lastStyle: r.style }, { merge: true });
      await store.commit(b);
      if (r.photo) { await savePhoto('v_' + ref.id, r.photo); }
      cache.visits = null; tab = 'cortes'; draw(); toast('Ficha guardada');
    };
    mm.el.querySelector('[data-o="code"]').onclick = async () => {
      mm.close();
      if (!(await confirmDialog({ title: 'Nuevo código de tarjeta', message: 'El enlace anterior de su tarjeta dejará de funcionar.', confirmText: 'Generar' }))) return;
      const code = await renewCardCode(cl); cl = { ...cl, cardCode: code }; toast('Código renovado'); cardModal(cl);
    };
    mm.el.querySelector('[data-o="baja"]').onclick = async () => {
      mm.close();
      if (cl.active === false) { await setClientActive(cl, true); toast('Cliente reactivado'); return; }
      if (!(await confirmDialog({ title: 'Dar de baja', message: `${esc(cl.name)} dejará de aparecer en la lista y en los recordatorios. Su historial se conserva.`, confirmText: 'Dar de baja', danger: true }))) return;
      await setClientActive(cl, false, 'Baja manual'); toast('Cliente dado de baja', 'warning');
    };
  }

  async function draw() {
    root.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const body = $('[data-body]');
    body.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    try { await TAB_RENDER[tab](body); } catch (e) { console.error(e); body.innerHTML = emptyState('alert', 'No se pudo cargar', esc(e.message)); }
  }

  const TAB_RENDER = {
    async resumen(body) {
      const visits = await load('visits', () => store.clientVisits(cl.id));
      const L = store.loyalty;
      const real = visits.filter((v) => !v.manual);
      const spent = Number(cl.totalSpent) || 0;
      const avgTicket = real.length ? real.reduce((a, v) => a + (v.total || 0), 0) / real.length : 0;
      const byBarber = {}; real.forEach((v) => { if (v.barberName) byBarber[v.barberName] = (byBarber[v.barberName] || 0) + 1; });
      const fav = Object.entries(byBarber).sort((a, b) => b[1] - a[1])[0];
      const bySvc = {}; real.forEach((v) => (v.services || []).forEach((s) => { bySvc[s] = (bySvc[s] || 0) + 1; }));
      const topSvc = Object.entries(bySvc).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const nextDue = cl.lastVisitAt ? dayKey(addDays(new Date(cl.lastVisitAt), store.cycleOf(cl))) : null;
      const qr = cl.cardCode ? await qrDataURL(cardUrl(cl.cardCode), 3) : '';
      const last = cl.lastStyle;
      body.innerHTML = `<div class="grid-main">
        <div class="stack">
          <div class="kpis kpis-sm">
            <div class="card kpi"><div class="kpi-label">Visitas</div><div class="kpi-value">${cl.visits || 0}</div><div class="kpi-sub">desde ${fmtDate(cl.createdAt)}</div></div>
            <div class="card kpi"><div class="kpi-label">Viene cada</div><div class="kpi-value">${cl.avgDays ? cl.avgDays + '<small> días</small>' : '—'}</div><div class="kpi-sub">${nextDue ? `le toca ~${fmtDate(nextDue)}` : 'aún sin historial'}</div></div>
            <div class="card kpi"><div class="kpi-label">Gasto total</div><div class="kpi-value">${usd(spent)}</div><div class="kpi-sub">ticket promedio ${usd(avgTicket)}</div></div>
            <div class="card kpi"><div class="kpi-label">No vino</div><div class="kpi-value ${cl.noShows >= 2 ? 'text-danger' : ''}">${cl.noShows || 0}</div><div class="kpi-sub">cita(s) perdida(s)</div></div>
          </div>
          <div class="card"><div class="card-head"><div class="card-title">${icon('scissors')} Su corte de siempre</div><button class="btn btn-ghost btn-sm" data-go-cortes>Historial</button></div>
            ${last ? `<div class="style-card"><b>${esc(styleLine(last) || 'Ficha sin detalles')}</b>${last.products ? `<div class="t-sub">Productos: ${esc(last.products)}</div>` : ''}${last.notes ? `<div class="small mt-xs">“${esc(last.notes)}”</div>` : ''}</div>` : emptyState('scissors', 'Aún no hay ficha de estilo', 'Se guarda al cobrar el servicio: anota degradado, máquina y barba para repetirlo igual.')}
            <div class="kv-grid mt">
              <div class="kv"><span>Tipo de cabello</span><b>${esc((cl.hairType || []).join(', ') || '—')}</b></div>
              <div class="kv"><span>Piel</span><b>${esc((cl.skin || []).join(', ') || '—')}</b></div>
              <div class="kv"><span>Bebida</span><b>${esc(cl.drink || '—')}</b></div>
              <div class="kv"><span>Barbero que más lo atiende</span><b>${fav ? `${esc(fav[0])} (${fav[1]})` : '—'}</b></div>
              ${cl.notes ? `<div class="kv kv-1"><span>Notas</span><b>${esc(cl.notes)}</b></div>` : ''}
            </div>
          </div>
          ${topSvc.length ? `<div class="card"><div class="card-title">${icon('chart')} Lo que más se hace</div><div class="stack mt">${topSvc.map(([n, k]) => `<div><div class="between small"><span>${esc(n)}</span><b>${k}</b></div><div class="progress mt-xs"><i style="width:${(k / topSvc[0][1]) * 100}%"></i></div></div>`).join('')}</div></div>` : ''}
        </div>
        <div class="stack">
          ${L.enabled ? `<div class="card"><div class="card-title">${icon('stamp')} Tarjeta de sellos</div>${stampsHTML(cl, true)}<div class="small muted mt">${Number(cl.rewards) > 0 ? `<b class="text-success">Tiene ${cl.rewards} ${esc(L.reward.toLowerCase())} para usar al cobrar.</b>` : `Le faltan <b>${Math.max(0, L.every - (Number(cl.stamps) || 0))}</b> para su ${esc(L.reward.toLowerCase())}.`}</div></div>` : ''}
          ${cl.membership && cl.membership.status !== 'anulada' ? `<div class="card"><div class="card-title">${icon('crown')} Club</div><div class="mt"><b>${esc(cl.membership.name)}</b><div class="t-sub">${fmtDate(cl.membership.start)} al ${fmtDate(cl.membership.end)}${cl.membership.end < todayKey() ? ' · <span class="text-danger">vencido</span>' : ''}</div><div class="progress mt"><i style="width:${(cl.membership.left / Math.max(1, cl.membership.visits)) * 100}%"></i></div><div class="small mt-xs">Le quedan <b>${cl.membership.left}</b> de ${cl.membership.visits} servicio(s)</div></div></div>` : ''}
          <div class="card center">${qr ? `<img src="${qr}" class="qr-img" alt="QR">` : ''}<div class="mono small mt-xs">${esc(cl.cardCode || '')}</div><div class="small muted">Tarjeta digital: sellos, próxima cita y su estilo</div><button class="btn btn-secondary btn-sm mt" data-card>${icon('whatsapp')} Enviar tarjeta</button></div>
        </div>
      </div>`;
      body.querySelector('[data-go-cortes]').onclick = () => { tab = 'cortes'; draw(); };
      body.querySelector('[data-card]').onclick = () => waClient('tarjeta', { client: cl });
    },
    async cortes(body) {
      const visits = await load('visits', () => store.clientVisits(cl.id));
      body.innerHTML = `<div class="between"><div class="small muted">${visits.length} registro(s) · la ficha se toma al cobrar cada servicio</div><button class="btn btn-secondary btn-sm" data-add>${icon('plus')} Anotar ficha</button></div>
        ${visits.length ? `<div class="timeline mt">${visits.map((v) => `<div class="tl-item"><span class="tl-dot" style="background:${store.barber(v.barberId)?.color || 'var(--brand)'}"></span><div class="grow">
          <div class="between"><b>${fmtDate(v.date)} · ${esc((v.services || []).join(' + '))}</b><span class="small">${v.total ? usd(v.total) : ''}</span></div>
          <div class="t-sub">${v.barberName ? `${icon('scissors')} ${esc(v.barberName)}` : ''}${v.saleNumber ? ` · ${esc(v.saleNumber)}` : ''}</div>
          ${v.style ? `<div class="style-card mt-xs"><b>${esc(styleLine(v.style) || '—')}</b>${v.style.products ? `<div class="t-sub">Productos: ${esc(v.style.products)}</div>` : ''}${v.style.notes ? `<div class="small">“${esc(v.style.notes)}”</div>` : ''}</div>` : ''}
          <div class="row mt-xs" style="gap:6px"><span data-vph="${v.id}"></span>${v.style ? `<button class="btn btn-ghost btn-sm" data-rep="${v.id}">${icon('copy')} Repetir este estilo</button>` : ''}<button class="btn btn-ghost btn-sm" data-edst="${v.id}">${icon('edit')} ${v.style ? 'Editar ficha' : 'Agregar ficha'}</button></div>
        </div></div>`).join('')}</div>` : emptyState('scissors', 'Sin cortes registrados', 'Cada servicio cobrado queda aquí con su receta.')}`;
      body.querySelector('[data-add]').onclick = () => { moreMenu(); };
      visits.forEach(async (v) => {
        const src = await loadPhoto('v_' + v.id);
        const el = body.querySelector(`[data-vph="${v.id}"]`);
        if (src && el) el.innerHTML = `<img src="${src}" alt="" class="cut-photo" data-big="${v.id}">`;
        el?.querySelector('[data-big]')?.addEventListener('click', () => openModal({ title: 'Resultado del corte', sub: fmtDate(v.date), size: 'md', body: `<img src="${src}" alt="" style="width:100%;border-radius:12px">` }));
      });
      body.querySelectorAll('[data-rep]').forEach((b) => b.onclick = async () => {
        const v = visits.find((x) => x.id === b.dataset.rep);
        await store.save('clients', cl.id, { lastStyle: v.style }); toast('Será el estilo sugerido en su próximo corte');
      });
      body.querySelectorAll('[data-edst]').forEach((b) => b.onclick = async () => {
        const v = visits.find((x) => x.id === b.dataset.edst);
        const r = await styleForm(v.style || cl.lastStyle || {});
        if (!r) return;
        await store.save('visits', v.id, { style: r.style });
        if (r.photo) await savePhoto('v_' + v.id, r.photo);
        if (visits[0]?.id === v.id) await store.save('clients', cl.id, { lastStyle: r.style });
        cache.visits = null; draw();
      });
    },
    async citas(body) {
      const list = await load('appts', () => store.clientAppts(cl.id));
      const noShow = list.filter((a) => a.status === 'no_vino').length;
      body.innerHTML = list.length ? `<div class="small muted">${list.length} cita(s) y turno(s)${noShow ? ` · <b class="text-danger">${noShow} no vino</b>` : ''}</div><div class="list mt">${list.map((a) => `<div class="list-item"><span class="kpi-icon" style="background:${a.barberColor || 'var(--brand)'}22;color:${a.barberColor || 'var(--brand)'};width:38px;height:38px">${icon(a.kind === 'turno' ? 'chair' : 'calendar')}</span><div class="grow" style="min-width:0"><b>${fmtDate(a.date)} ${esc(a.time)} · ${esc(a.serviceNames || '')}</b><div class="t-sub">${esc(a.barberName || '')}${a.source === 'online' ? ' · reservó en línea' : ''}${a.kind === 'turno' ? ' · llegó sin cita' : ''}</div></div>${apptBadge(a.status)}</div>`).join('')}</div>`
        : emptyState('calendar', 'Sin citas', 'Agéndale su próximo corte con “Agendar cita”.');
    },
    async pagos(body) {
      const sales = await load('sales', () => store.clientSales(cl.id));
      body.innerHTML = sales.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Documento</th><th>Fecha</th><th>Detalle</th><th class="r">Total</th><th></th></tr></thead><tbody>${sales.map((s) => `<tr style="${s.status === 'voided' ? 'opacity:.5' : ''}"><td><b>${esc(s.number)}</b>${s.status === 'voided' ? ' <span class="badge badge-danger">Anulado</span>' : ''}</td><td class="small">${fmtDateTime(s.date)}</td><td class="small">${(s.items || []).map((i) => esc(i.name)).join(', ')}</td><td class="r num"><b>${usd(s.total)}</b>${s.credit ? `<div class="t-sub text-danger">pendiente ${usd(s.credit)}</div>` : ''}</td><td class="r"><button class="btn btn-ghost btn-icon btn-sm" data-pr="${s.id}">${icon('print')}</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('receipt', 'Sin pagos registrados');
      body.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => printReceipt(sales.find((s) => s.id === b.dataset.pr)));
    }
  };

  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  header(); draw();
}

function waMenu(cl) {
  const L = store.loyalty;
  const opts = [
    ['tarjeta', 'Enviar su tarjeta', 'Sellos, próxima cita y su estilo'],
    ['le_toca', '“Te toca corte”', 'Invítalo a reservar'],
    ...(store.settings.booking?.enabled ? [['reservas', 'Enlace para reservar en línea', 'Elige barbero y hora solo']] : []),
    ...(Number(cl.rewards) > 0 && L.enabled ? [['premio', 'Tiene un premio', `${L.reward}`]] : []),
    ...(cl.membership ? [['club', 'Renovar el club', cl.membership.name]] : []),
    ...((Number(cl.balance) || 0) > 0.009 ? [['deuda', 'Recordar saldo pendiente', usd(cl.balance)]] : []),
    ['cumple', 'Feliz cumpleaños', 'Con un regalo'],
    ['perdido', 'Te extrañamos', 'Para quien dejó de venir'],
    ['libre', 'Mensaje libre', 'Escribe lo que quieras']
  ];
  const m = openModal({
    title: 'WhatsApp', sub: esc(cl.name), size: 'sm',
    body: `<div class="list">${opts.map(([k, t, s]) => `<button class="list-item" data-k="${k}">${icon('whatsapp')}<div class="grow"><b>${esc(t)}</b><div class="t-sub">${esc(s)}</div></div></button>`).join('')}</div>`,
    footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
  });
  m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
    const k = b.dataset.k; m.close();
    const weeks = store.daysSince(cl) != null ? Math.max(1, Math.round(store.daysSince(cl) / 7)) : '';
    waClient(k, { client: cl, extra: k === 'le_toca' ? weeks : '' });
  });
}

// ======================================================================
// CLUB, SALDO Y TARJETA
// ======================================================================
export async function clubModal(cl = null) {
  const { openPay, showPaid } = await import('./pay.js');
  if (!store.activePlans.length) { toast('Crea los planes del club en Configuración › Club.', 'warning'); return null; }
  return new Promise((resolve) => {
    let plan = store.activePlans[0];
    let done = null;
    const m = openModal({
      title: 'Club de la barbería', sub: cl ? esc(cl.name) : 'Prepago de servicios: el cliente ahorra y vuelve seguro', size: 'md',
      body: `<div class="stack">${cl ? '' : `<button class="btn btn-secondary btn-block" data-pick>${icon('search')} Elegir cliente</button>`}<div class="plan-grid" data-plans></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('cart')} Cobrar</button>`,
      onClose: () => resolve(done)
    });
    const draw = () => {
      m.el.querySelector('[data-plans]').innerHTML = store.activePlans.map((p) => {
        const normal = (p.services || []).map((id) => store.service(id)?.price || 0)[0] * (Number(p.visits) || 1);
        const save = normal > p.price ? normal - p.price : 0;
        return `<button type="button" class="plan-card ${plan?.id === p.id ? 'on' : ''}" data-p="${p.id}"><b>${esc(p.name)}</b><div class="plan-price">${usd(p.price)}</div><div class="t-sub">${p.visits} servicio(s) · ${p.days} días</div><div class="t-sub">${(p.services || []).map((id) => esc(store.service(id)?.name || '')).filter(Boolean).join(', ') || 'Cualquier servicio'}</div>${save ? `<span class="badge badge-success mt-xs">Ahorra ${usd(save)}</span>` : ''}${p.note ? `<div class="small mt-xs">${esc(p.note)}</div>` : ''}</button>`;
      }).join('');
      m.el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { plan = store.plan(b.dataset.p); draw(); });
    };
    m.el.querySelector('[data-pick]')?.addEventListener('click', async () => { const c = await pickClient(); if (c) { cl = c; m.el.querySelector('[data-pick]').innerHTML = `${icon('user')} ${esc(c.name)}`; } });
    m.el.querySelector('[data-ok]').onclick = async () => {
      if (!cl) { toast('Elige el cliente', 'warning'); return; }
      const out = await openPay({ title: `Club · ${plan.name}`, sub: esc(cl.name), amount: plan.price, onConfirm: async (r) => { const res = await sellPlan({ client: cl, plan, payments: r.payments }); if (r.print) printReceipt(res.sale); return res; } });
      if (out) { done = out; m.close(); showPaid(out.sale, { title: 'Club activado', onPrint: () => printReceipt(out.sale) }); }
    };
    draw();
  });
}
export async function payDebtModal(cl) {
  const { openPay, showPaid } = await import('./pay.js');
  const bal = Number(cl.balance) || 0;
  const out = await openPay({ title: 'Cobrar saldo pendiente', sub: esc(cl.name), amount: bal, editable: true, max: bal, onConfirm: async (r) => { const res = await payBalance(cl, { amount: r.amount, payments: r.payments }); if (r.print) printReceipt(res.sale); return res; } });
  if (out) showPaid(out.sale, { title: 'Abono registrado', onPrint: () => printReceipt(out.sale) });
}
async function copyCard(cl) {
  try { await navigator.clipboard.writeText(cardUrl(cl.cardCode)); toast('Enlace de la tarjeta copiado'); } catch (_) { toast(cardUrl(cl.cardCode), 'info', 6000); }
}
export async function cardModal(cl) {
  const qr = await qrDataURL(cardUrl(cl.cardCode), 5);
  const m = openModal({
    title: 'Tarjeta del cliente', sub: esc(cl.name), size: 'sm',
    body: `<div class="center stack" style="align-items:center"><img src="${qr}" class="qr-img lg" alt="QR"><div class="mono small">${esc(cl.cardCode)}</div>${stampsHTML(cl)}
      <div class="small muted">El cliente abre el enlace en su teléfono: ve sus sellos, su próxima cita, el estilo de su último corte y el botón para reservar. En el mostrador, escanea su QR para encontrarlo al instante.</div></div>`,
    footer: `<button class="btn btn-secondary" data-copy>${icon('copy')} Copiar</button><button class="btn btn-secondary" data-pr>${icon('print')} Imprimir</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar</button>`
  });
  m.el.querySelector('[data-copy]').onclick = () => copyCard(cl);
  m.el.querySelector('[data-pr]').onclick = () => printCard(cl);
  m.el.querySelector('[data-wa]').onclick = () => waClient('tarjeta', { client: cl });
}
/** Tarjeta de fidelidad tamaño CR80 para imprimir */
export async function printCard(cl) {
  const qr = await qrDataURL(cardUrl(cl.cardCode), 6);
  const L = store.loyalty;
  const n = Math.min(Number(cl.stamps) || 0, L.every);
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>Tarjeta ${esc(cl.number)}</title><style>
    @page { size: auto; margin: 10mm; } body { font-family: Arial, Helvetica, sans-serif; }
    .card { width: 85.6mm; height: 54mm; border-radius: 3.5mm; overflow: hidden; position: relative; background: #120d09; color: #fff; display: flex; box-shadow: 0 0 0 .2mm #999; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .l { flex: 1; padding: 4mm; display: flex; flex-direction: column; gap: 1.2mm; }
    .brand { font-size: 2.8mm; letter-spacing: .4mm; text-transform: uppercase; color: #f2c96b; font-weight: 700; }
    .shop { font-size: 3.6mm; font-weight: 700; }
    .nm { font-size: 3.9mm; font-weight: 800; line-height: 1.1; margin-top: auto; } .num { font-size: 2.6mm; color: #d6c7b0; }
    .st { display: flex; flex-wrap: wrap; gap: 1mm; width: 46mm; } .st i { width: 3.6mm; height: 3.6mm; border-radius: 50%; border: .3mm solid #f2c96b; display: inline-block; } .st i.on { background: #f2c96b; }
    .rw { font-size: 2.3mm; color: #f2c96b; }
    .r { width: 30mm; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1mm; color: #111; }
    .r img { width: 25mm; height: 25mm; } .r small { font-size: 2.1mm; font-family: monospace; }
    .bar { position: absolute; left: 0; right: 30mm; bottom: 0; height: 1.4mm; background: repeating-linear-gradient(135deg,#dc2626 0 3mm,#fff 3mm 4.5mm,#1e3a8a 4.5mm 6mm,#fff 6mm 7.5mm); }
  </style></head><body>
  <div class="card"><div class="l"><div class="brand">Cliente · SanoCortes</div><div class="shop">${esc(store.businessName)}</div>
    ${L.enabled ? `<div class="st">${Array.from({ length: L.every }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div><div class="rw">Cada ${L.every} cortes: ${esc(L.reward)}</div>` : ''}
    <div class="nm">${esc(cl.name)}</div><div class="num">${esc(cl.number)}</div></div>
    <div class="r"><img src="${qr}"><small>${esc(cl.cardCode)}</small><small>Tu tarjeta digital</small></div><div class="bar"></div></div>
  </body></html>`);
}
