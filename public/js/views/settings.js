// SanoCortes — Ajustes de la barbería
import { store, updateTenant, DAYS, getBookingPage } from '../store.js';
import { requirePin, changePassword, authErrorMessage, session } from '../auth.js';
import { esc, num, toast, parseNum, setBusy, toggleTheme, download, nowISO, round2, openModal, shortId, confirmDialog, emptyState, loc, flagImg, usd, scaleUSD } from '../utils.js';
import { icon } from '../icons.js';
import { openCountryPicker, salesWa, SALES_PHONE_FMT, BOOK_URL, qrDataURL } from '../shared.js';
import { isStandalone, bindInstallButtons } from '../install.js';
import { SERVICE_CATEGORIES, DEFAULT_SERVICES, DEFAULT_PLANS, BARBER_COLORS, LOYALTY_DEFAULT } from '../barber.js';
import { slugify, publishBooking, resetPublished } from '../ops.js';

const SECTIONS = { negocio: 'Barbería', horario: 'Horario y agenda', reserva: 'Reserva en línea', servicios: 'Servicios', club: 'Club', fidelidad: 'Fidelidad', recibos: 'Recibos', seguridad: 'Seguridad', apps: 'Instalar y respaldo' };
const sw = (name, on, title, sub) => `<label class="check box box-white"><span class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></span><span><b>${title}</b><br><small class="muted">${sub}</small></span></label>`;

export function mount(el, { params = {}, navigate }) {
  let sec = SECTIONS[params.tab || params.sec] ? (params.tab || params.sec) : 'negocio';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Ajustes</h1><p class="view-sub">Servicios, precios, horario, reserva en línea, club y fidelidad de tu barbería.</p></div></div>
    <div class="tabs">${Object.entries(SECTIONS).map(([k, v]) => `<button data-s="${k}">${v}</button>`).join('')}</div>
    <div id="s-body" style="max-width:980px"></div>`;
  const $ = (q) => el.querySelector(q);
  const s = () => store.settings;

  function render() {
    el.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    const body = $('#s-body');

    if (sec === 'negocio') {
      body.innerHTML = `<form class="card stack" id="f-biz">
        <div class="form-grid">
          <div class="field full"><label>Nombre de la barbería</label><input class="input" name="businessName" value="${esc(s().businessName || store.tenant?.name || '')}" placeholder="Ej.: Barbería El Bigote"></div>
          <div class="field"><label>${esc(loc().tax)} (identificación fiscal)</label><input class="input" name="rif" value="${esc(s().rif)}"></div>
          <div class="field"><label>Teléfono</label><input class="input" name="phone" value="${esc(s().phone)}"></div>
          <div class="field"><label>WhatsApp de la barbería</label><input class="input" name="whatsapp" value="${esc(s().whatsapp || '')}"><span class="hint">Aparece en la página de reservas y en la tarjeta del cliente.</span></div>
          <div class="field"><label>Instagram</label><input class="input" name="instagram" value="${esc(s().instagram)}" placeholder="@tubarberia"></div>
          <div class="field full"><label>Dirección</label><input class="input" name="address" value="${esc(s().address)}"></div>
          <div class="field full"><label>Normas para el cliente</label><textarea class="textarea" name="rules" style="min-height:70px">${esc(s().rules || '')}</textarea><span class="hint">Se muestran en la página de reservas (llegada, retrasos, cancelaciones).</span></div>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} Guardar</button></div>
      </form>
      <div class="card mt-lg between row-wrap"><div class="row" style="gap:12px"><span class="flag">${flagImg(loc().code, 30)}</span><div><div class="bold">País: ${esc(loc().name)} · ${esc(loc().curName)} (${esc(loc().sym)})</div><div class="small muted">Moneda, formas de pago y prefijo de WhatsApp.</div></div></div><button class="btn btn-secondary" id="s-rate">${icon('globe')} Cambiar país</button></div>
      <div class="card mt-lg between row-wrap"><div><div class="bold">Tema de la aplicación</div><div class="small muted">Claro u oscuro, según tu preferencia.</div></div><button class="btn btn-secondary" id="s-theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')} Cambiar tema</button></div>`;
      $('#f-biz').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        const patch = {}; for (const k of ['businessName', 'rif', 'phone', 'whatsapp', 'address', 'instagram', 'rules']) patch[k] = F[k].value.trim();
        await store.saveSettings(patch);
        if (patch.businessName && patch.businessName !== store.tenant?.name && !store.isDemo) updateTenant(store.tenantId, { name: patch.businessName, updatedAt: nowISO() }).catch(() => {});
        toast('Datos de la barbería guardados');
      };
      $('#s-rate').onclick = async () => { if (!(await requirePin('Cambiar el país y la moneda'))) return; if (await openCountryPicker({ force: true })) location.reload(); };
      $('#s-theme').onclick = (e) => { const n = toggleTheme(); e.currentTarget.innerHTML = `${icon(n === 'dark' ? 'sun' : 'moon')} Cambiar tema`; };
    }

    if (sec === 'horario') {
      const sc = s().schedule; const ag = s().agenda;
      body.innerHTML = `<form class="card stack" id="f-sch"><div class="card-title">${icon('clock')} Horario de la barbería</div>
        <div class="form-grid">
          <div class="field"><label>Lunes a viernes: abre</label><input class="input" type="time" name="open" value="${esc(sc.open)}"></div>
          <div class="field"><label>Cierra</label><input class="input" type="time" name="close" value="${esc(sc.close)}"></div>
          <div class="field"><label>Sábado: abre (vacío = cerrado)</label><input class="input" type="time" name="satOpen" value="${esc(sc.satOpen || '')}"></div>
          <div class="field"><label>Cierra</label><input class="input" type="time" name="satClose" value="${esc(sc.satClose || '')}"></div>
          <div class="field"><label>Domingo: abre (vacío = cerrado)</label><input class="input" type="time" name="sunOpen" value="${esc(sc.sunOpen || '')}"></div>
          <div class="field"><label>Cierra</label><input class="input" type="time" name="sunClose" value="${esc(sc.sunClose || '')}"></div>
        </div>
        <div class="field"><label>Días que abre de lunes a viernes</label><div class="chips">${[1, 2, 3, 4, 5].map((d) => `<label class="chip ${sc.days.includes(d) ? 'on' : ''}"><input type="checkbox" name="d${d}" ${sc.days.includes(d) ? 'checked' : ''} hidden>${DAYS[d]}</label>`).join('')}</div></div>
        <div class="card-title mt-sm">${icon('calendar')} Agenda</div>
        <div class="form-grid">
          <div class="field"><label>Intervalo de la agenda</label><select class="select" name="step">${[10, 15, 20, 30].map((v) => `<option value="${v}" ${Number(ag.step) === v ? 'selected' : ''}>${v} minutos</option>`).join('')}</select></div>
          <div class="field"><label>Minutos de limpieza entre clientes</label><input class="input" name="buffer" inputmode="numeric" value="${esc(ag.buffer || 0)}"></div>
          <div class="field"><label>Marcar “no vino” después de (min)</label><input class="input" name="noShowMinutes" inputmode="numeric" value="${esc(ag.noShowMinutes ?? 15)}"></div>
          <div class="field"><label>Recordar cita con (horas de anticipación)</label><input class="input" name="remindHours" inputmode="numeric" value="${esc(ag.remindHours ?? 24)}"></div>
          <div class="field"><label>Ciclo de corte general (días)</label><input class="input" name="cycleDays" inputmode="numeric" value="${esc(s().cycleDays ?? 21)}"><span class="hint">Se usa hasta que el cliente tiene 2 visitas; luego se usa su promedio real.</span></div>
        </div>
        ${sw('tips', s().tips !== false, 'Registrar propinas al cobrar', 'Se suman a la liquidación de cada barbero.')}
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} Guardar</button></div></form>
        <div class="box small mt-md">${icon('info')} El horario de cada barbero (días, entrada, salida y descanso) se configura en <b>Barberos y pagos</b>.</div>`;
      body.querySelectorAll('label.chip input').forEach((i) => i.onchange = () => i.parentElement.classList.toggle('on', i.checked));
      $('#f-sch').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const n = (k, d) => Math.max(0, Math.round(parseNum(F[k].value)) || d);
        const sch = { ...sc }; for (const k of ['open', 'close', 'satOpen', 'satClose', 'sunOpen', 'sunClose']) sch[k] = F[k].value;
        if (!sch.open || !sch.close || sch.open >= sch.close) { toast('Revisa la hora de apertura y cierre', 'warning'); return; }
        sch.days = [...[1, 2, 3, 4, 5].filter((d) => F['d' + d].checked), ...(sch.satOpen ? [6] : []), ...(sch.sunOpen ? [0] : [])];
        await store.saveSettings({ schedule: sch, agenda: { ...ag, step: Number(F.step.value) || 15, buffer: n('buffer', 0), noShowMinutes: n('noShowMinutes', 15), remindHours: n('remindHours', 24) }, cycleDays: Math.max(7, n('cycleDays', 21)), tips: F.tips.checked });
        toast('Horario y agenda guardados');
      };
    }

    if (sec === 'reserva') {
      const B = s().booking; const url = BOOK_URL();
      body.innerHTML = `<div class="grid-2"><form class="card stack" id="f-book"><div class="card-title">${icon('globe')} Reserva en línea</div>
        <p class="small muted" style="margin:0">Una página propia de tu barbería donde el cliente elige servicio, barbero y una hora libre. Se actualiza sola con tu agenda.</p>
        ${sw('enabled', B.enabled !== false, 'Recibir reservas en línea', 'Si lo apagas, la página muestra solo tu WhatsApp.')}
        ${sw('autoAccept', !!B.autoAccept, 'Aceptar automáticamente', 'Si el espacio sigue libre, la cita entra directo a la agenda. Si no, la apruebas tú.')}
        <div class="form-grid">
          <div class="field"><label>Anticipación mínima</label><select class="select" name="leadMinutes">${[[0, 'Sin mínimo'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [1440, '1 día']].map(([v, l]) => `<option value="${v}" ${Number(B.leadMinutes) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Hasta cuántos días adelante</label><select class="select" name="daysAhead">${[3, 7, 14, 21, 30].map((v) => `<option value="${v}" ${Number(B.daysAhead) === v ? 'selected' : ''}>${v} días</option>`).join('')}</select></div>
          <div class="field full"><label>Dirección de tu página</label><div class="input-group"><span class="prefix">/reservar/</span><input class="input" name="slug" value="${esc(B.slug || '')}" maxlength="40"></div><span class="hint">Solo letras, números y guiones. Ej.: barberia-el-bigote</span></div>
          <div class="field full"><label>Mensaje en la página</label><input class="input" name="note" value="${esc(B.note || '')}" placeholder="Ej.: Estacionamiento gratis · Aceptamos pago móvil"></div>
        </div>
        <div class="error-msg" data-err></div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} Guardar</button></div></form>
        <div class="card stack center" id="b-share">${url ? `<div class="card-title" style="justify-content:center">${icon('qr')} Tu enlace</div><div class="small" style="word-break:break-all"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></div><div data-qr class="center"></div>
          <div class="row" style="gap:6px;justify-content:center;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" id="b-copy">${icon('copy')} Copiar</button><button class="btn btn-secondary btn-sm" id="b-share-go">${icon('users')} Enviar a clientes</button></div>
          <p class="small muted" style="margin:0">Agrégalo a la bio de Instagram y al estado de WhatsApp.</p>` : emptyState('globe', 'Reserva en línea apagada', 'Actívala para tener tu enlace y tu código QR.')}</div></div>`;
      if (url) {
        qrDataURL(url, 5).then((qr) => { const b = body.querySelector('[data-qr]'); if (b) b.innerHTML = `<img src="${qr}" alt="QR" style="width:180px;height:180px;image-rendering:pixelated"><div><a class="small" download="qr-reservas.png" href="${qr}">${icon('download')} Descargar QR</a></div>`; });
        $('#b-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { toast(url, 'info', 6000); } };
        $('#b-share-go').onclick = () => navigate('fidelizar');
      }
      $('#f-book').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = e.target.querySelector('[data-err]'); err.textContent = '';
        const slug = slugify(F.slug.value);
        if (slug.length < 4) { err.textContent = 'La dirección debe tener al menos 4 caracteres.'; return; }
        const btn = e.target.querySelector('button.btn-primary'); setBusy(btn, true);
        try {
          const old = B.slug;
          if (slug !== old) {
            const taken = await getBookingPage(slug).catch(() => null);
            if (taken && taken.tenantId !== store.tenantId) { err.textContent = 'Esa dirección ya la usa otra barbería. Prueba con otra.'; setBusy(btn, false); return; }
          }
          await store.saveSettings({ booking: { ...B, enabled: F.enabled.checked, autoAccept: F.autoAccept.checked, leadMinutes: Number(F.leadMinutes.value) || 0, daysAhead: Number(F.daysAhead.value) || 14, slug, note: F.note.value.trim() } });
          resetPublished(); await publishBooking({ force: true });
          if (old && slug !== old) { const b = store.batch(); b.delete(store.bookingRef(old)); await store.commit(b); }
          toast('Reserva en línea guardada');
        } catch (ex) { err.textContent = ex.code === 'permission-denied' ? 'Esa dirección no está disponible. Prueba con otra.' : ex.message; }
        setBusy(btn, false);
      };
    }

    if (sec === 'servicios') {
      const svcs = s().services || [];
      const groups = SERVICE_CATEGORIES.map((c) => [c, svcs.filter((x) => (x.category || 'Extras') === c)]).filter(([, l]) => l.length);
      body.innerHTML = `<div class="card stack">
        <div class="between row-wrap"><div><div class="card-title">${icon('scissors')} Servicios y precios</div><p class="small muted" style="margin:4px 0 0">La duración define el espacio en la agenda. Marca cuáles se pueden reservar en línea.</p></div>
          <div class="row"><button class="btn btn-ghost btn-sm" id="sv-def">${icon('refresh')} Sugeridos</button><button class="btn btn-primary" id="sv-add">${icon('plus')} Nuevo servicio</button></div></div>
        ${groups.map(([c, l]) => `<div><div class="small bold muted mt-sm">${esc(c)}</div><div class="list">${l.map((x) => `<div class="list-item" style="${x.active === false ? 'opacity:.5' : ''}"><span class="plan-dot" style="background:${x.color || 'var(--brand)'}"></span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub">${x.minutes} min${x.online === false ? ' · solo en local' : ' · se reserva en línea'}${x.active === false ? ' · inactivo' : ''}</div></div><b class="num">${usd(x.price)}</b><button class="btn btn-ghost btn-sm" data-sv="${esc(x.id)}">${icon('edit')}</button></div>`).join('')}</div></div>`).join('') || emptyState('scissors', 'Sin servicios', 'Agrega tus servicios o carga los sugeridos.')}
      </div>`;
      $('#sv-add').onclick = () => serviceForm(null);
      $('#sv-def').onclick = async () => {
        if (!(await confirmDialog({ title: 'Cargar servicios sugeridos', message: 'Se agregan los servicios sugeridos que no tengas (corte, fade, barba, combos, VIP, niño, cejas, tinte…). Los tuyos no se tocan.', confirmText: 'Agregar' }))) return;
        const have = new Set(svcs.map((x) => x.id));
        const add = DEFAULT_SERVICES.filter((x) => !have.has(x.id)).map((x) => ({ ...x, price: scaleUSD(x.price) }));
        await store.saveSettings({ services: [...svcs, ...add] }); toast(`${add.length} servicio(s) agregados`);
      };
      body.querySelectorAll('[data-sv]').forEach((b) => b.onclick = () => serviceForm(svcs.find((x) => x.id === b.dataset.sv)));
    }

    if (sec === 'club') {
      const plans = s().plans || [];
      body.innerHTML = `<div class="card stack">
        <div class="between row-wrap"><div><div class="card-title">${icon('crown')} Club de la barbería</div><p class="small muted" style="margin:4px 0 0">Paquetes prepagados: el cliente paga por adelantado varios servicios con descuento y los usa durante un tiempo. Tú cobras antes y él vuelve seguro.</p></div><button class="btn btn-primary" id="p-add">${icon('plus')} Nuevo plan</button></div>
        ${plans.length ? `<div class="list">${plans.map((p) => `<div class="list-item" style="${p.active === false ? 'opacity:.5' : ''}"><span class="kpi-icon tone-violet" style="width:34px;height:34px">${icon('crown')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(p.name)}${p.active === false ? ' <span class="badge badge-neutral">inactivo</span>' : ''}</b><div class="t-sub">${p.visits} servicio(s) · ${p.days} días · ${(p.services || []).map((id) => esc(store.service(id)?.name || '')).filter(Boolean).join(', ') || 'cualquier servicio'}</div></div><b class="num">${usd(p.price)}</b><button class="btn btn-ghost btn-sm" data-ep="${esc(p.id)}">${icon('edit')}</button></div>`).join('')}</div>`
          : `${emptyState('crown', 'Sin planes', 'Crea tu primer plan o carga los de ejemplo.')}<button class="btn btn-secondary" id="p-def">${icon('star')} Cargar planes de ejemplo</button>`}
        <p class="small muted" style="margin:0">Los servicios del club se le pagan al barbero sobre el precio normal (en la liquidación).</p></div>`;
      $('#p-add').onclick = () => planForm();
      $('#p-def')?.addEventListener('click', async () => { await store.saveSettings({ plans: DEFAULT_PLANS.map((p) => ({ ...p, price: scaleUSD(p.price) })) }); toast('Planes de ejemplo cargados'); });
      body.querySelectorAll('[data-ep]').forEach((b) => b.onclick = () => planForm(plans.find((p) => p.id === b.dataset.ep)));
    }

    if (sec === 'fidelidad') {
      const L = { ...LOYALTY_DEFAULT, ...(s().loyalty || {}) };
      body.innerHTML = `<form class="card stack" id="f-loy"><div class="card-title">${icon('stamp')} Tarjeta de sellos</div>
        <p class="small muted" style="margin:0">Cada visita con un servicio pagado suma un sello. Al completar la tarjeta el cliente gana un premio que se aplica al cobrar. Él ve sus sellos en su tarjeta digital.</p>
        ${sw('enabled', L.enabled !== false, 'Tarjeta de sellos activa', 'Los servicios del club y los premios no suman sello.')}
        <div class="form-grid">
          <div class="field"><label>Sellos para ganar el premio</label><select class="select" name="every">${[5, 6, 8, 10, 12].map((v) => `<option value="${v}" ${Number(L.every) === v ? 'selected' : ''}>${v} visitas</option>`).join('')}</select></div>
          <div class="field"><label>Premio</label><input class="input" name="reward" value="${esc(L.reward)}" placeholder="Corte gratis"></div>
          <div class="field"><label>Servicio que cubre el premio</label><select class="select" name="rewardServiceId">${store.activeServices.map((x) => `<option value="${x.id}" ${L.rewardServiceId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        </div>
        <div class="card-title mt-sm">${icon('gift')} Mensajes de regreso</div>
        <div class="form-grid">
          <div class="field full"><label>Oferta para clientes perdidos</label><input class="input" name="comebackOffer" value="${esc(s().comebackOffer || 'Esta semana tienes un 10 % de descuento en tu corte.')}"></div>
          <div class="field full"><label>Regalo de cumpleaños</label><input class="input" name="birthdayOffer" value="${esc(s().birthdayOffer || 'Tu regalo: la barba gratis con tu próximo corte este mes.')}"></div>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} Guardar</button></div></form>`;
      $('#f-loy').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ loyalty: { enabled: F.enabled.checked, every: Number(F.every.value) || 10, reward: F.reward.value.trim() || 'Corte gratis', rewardServiceId: F.rewardServiceId.value }, comebackOffer: F.comebackOffer.value.trim(), birthdayOffer: F.birthdayOffer.value.trim() });
        toast('Fidelidad guardada');
      };
    }

    if (sec === 'recibos') {
      body.innerHTML = `<form class="card stack" id="f-docs">
        <div class="form-grid">
          <div class="field"><label>Título del recibo</label><input class="input" name="docTitle" value="${esc(s().docTitle || 'RECIBO')}"><span class="hint">Ej.: RECIBO, NOTA DE COBRO, FACTURA.</span></div>
          <div class="field"><label>Formato</label><select class="select" name="receiptFormat">${[['80mm', 'Ticket 80 mm'], ['58mm', 'Ticket 58 mm'], ['carta', 'Hoja carta']].map(([v, l]) => `<option value="${v}" ${s().receiptFormat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Prefijo de numeración</label><input class="input" name="invoicePrefix" value="${esc(s().invoicePrefix || 'R')}" maxlength="4"></div>
          <div class="field"><label>Impuesto incluido en los precios (%)</label><input class="input" name="iva" inputmode="decimal" value="${num(s().iva || 0, 0)}"><span class="hint">Solo se muestra desglosado. 0 para no mostrarlo.</span></div>
          <div class="field full"><label>Mensaje al pie del recibo</label><input class="input" name="receiptFooter" value="${esc(s().receiptFooter)}"></div>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} Guardar</button></div></form>`;
      $('#f-docs').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ docTitle: F.docTitle.value.trim().toUpperCase() || 'RECIBO', receiptFormat: F.receiptFormat.value, invoicePrefix: F.invoicePrefix.value.trim().toUpperCase() || 'R', iva: parseNum(F.iva.value), receiptFooter: F.receiptFooter.value.trim() });
        toast('Recibos guardados');
      };
    }

    if (sec === 'seguridad') {
      body.innerHTML = `<div class="grid-2">
        <form class="card stack" id="f-pin"><div class="card-title">${icon('lock')} PIN de administrador</div><p class="small muted" style="margin:0">Protege reportes, anulaciones, descuentos, pagos a barberos, ajustes de sellos, gastos, cierre de caja y salir de la pantalla de turnos.</p>
          <div class="field"><label>Nuevo PIN (4 a 12 dígitos)</label><input class="input" name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <div class="field"><label>Repetir PIN</label><input class="input" name="pin2" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <button class="btn btn-primary">${icon('check')} Cambiar PIN</button></form>
        ${session.user?.isAnonymous ? `<div class="card stack"><div class="card-title">${icon('shield')} Contraseña</div><p class="muted" style="margin:0">En la demo no hay contraseña. Contrata SanoCortes para tener tu propia cuenta.</p><a class="btn btn-whatsapp" href="${salesWa()}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>`
          : `<form class="card stack" id="f-pass"><div class="card-title">${icon('shield')} Contraseña de acceso</div>
          <div class="field"><label>Contraseña actual</label><input class="input" name="cur" type="password" autocomplete="current-password"></div>
          <div class="field"><label>Nueva contraseña (mínimo 8)</label><input class="input" name="next" type="password" autocomplete="new-password"></div>
          <div class="error-msg" data-err></div>
          <button class="btn btn-primary">${icon('check')} Cambiar contraseña</button></form>`}
      </div>
      <div class="box small mt-lg">${icon('shieldCheck')} Los datos de tus clientes solo son visibles con tu usuario. La tarjeta digital pública muestra solo nombre, sellos, club y próxima cita; la página de reservas solo muestra horarios ocupados, nunca nombres.</div>`;
      $('#f-pin').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        if (store.isDemo) { toast('En la demo el PIN siempre es 1234.', 'info'); return; }
        if (!/^\d{4,12}$/.test(F.pin.value)) { toast('El PIN debe tener de 4 a 12 dígitos', 'warning'); return; }
        if (F.pin.value !== F.pin2.value) { toast('Los PIN no coinciden', 'warning'); return; }
        if (store.hasPin() && !(await requirePin('Cambiar el PIN', { always: true }))) return;
        await store.setPin(F.pin.value); e.target.reset(); toast('PIN actualizado');
      };
      const fp = $('#f-pass');
      if (fp) fp.onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = fp.querySelector('[data-err]'); err.textContent = '';
        if (F.next.value.length < 8) { err.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
        const btn = fp.querySelector('button'); setBusy(btn, true);
        try { await changePassword(F.cur.value, F.next.value); e.target.reset(); toast('Contraseña actualizada'); }
        catch (ex) { err.textContent = authErrorMessage(ex); }
        setBusy(btn, false);
      };
    }

    if (sec === 'apps') {
      body.innerHTML = `<div class="grid-2">
        <div class="card stack"><div class="card-title">${icon('install')} Instalar la app</div>
          <p class="small muted" style="margin:0">Instala SanoCortes en la computadora o tablet de la recepción, en el teléfono de cada barbero y en un televisor para la pantalla de turnos. Todo conectado en tiempo real.</p>
          ${isStandalone() ? `<div class="pay-status ok"><span>${icon('check')} Estás usando la app instalada</span><span></span></div>` : `<button class="btn btn-primary btn-lg" data-install>${icon('install')} Instalar en este equipo</button>`}
          <div class="list">
            <div class="list-item"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>Android</b><div class="t-sub">Chrome › menú ⋮ › Instalar app</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-info" style="width:34px;height:34px">${icon('laptop')}</span><div class="grow"><b>Computadora</b><div class="t-sub">Chrome o Edge › ícono de instalar en la barra de direcciones</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-violet" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>iPhone / iPad</b><div class="t-sub">Safari › Compartir › Agregar a inicio</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-warning" style="width:34px;height:34px">${icon('tv')}</span><div class="grow"><b>Televisor de la sala</b><div class="t-sub">Abre la app en el navegador del TV o en un TV Box y entra a “Pantalla de turnos”.</div></div></div>
          </div></div>
        <div class="card stack"><div class="card-title">${icon('download')} Respaldo de datos</div>
          <p class="small muted" style="margin:0">Descarga una copia de clientes, citas, cortes, club, ventas, pagos a barberos, productos y ajustes (archivo JSON). Protegido con PIN.</p>
          <button class="btn btn-secondary" id="s-backup">${icon('download')} Descargar respaldo completo</button>
          <div class="divider"></div>
          <div class="card-title">${icon('whatsapp')} Soporte</div>
          <p class="small muted" style="margin:0">¿Dudas o sugerencias? Escríbenos.</p>
          <a class="btn btn-whatsapp" href="${salesWa('Hola, necesito soporte con SanoCortes.')}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>
      </div>`;
      bindInstallButtons(body);
      $('#s-backup').onclick = async (e) => {
        const btn = e.currentTarget;
        if (!(await requirePin('Descargar el respaldo'))) return;
        setBusy(btn, true, 'Preparando…');
        try {
          const { getDocs } = await import('../firebase.js');
          const all = async (n) => (await getDocs(store.col(n))).docs.map((d) => ({ id: d.id, ...d.data() }));
          const names = ['appointments', 'visits', 'memberships', 'sales', 'payouts', 'cash_shifts', 'cash_movements', 'inventory_logs'];
          const got = await Promise.all(names.map(all));
          const data = { app: 'SanoCortes', exportedAt: nowISO(), business: store.businessName, settings: store.settings, clients: store.clients, products: store.products };
          names.forEach((n, i) => { data[n] = got[i]; });
          download(`respaldo-${slugify(store.businessName || 'sanocortes')}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
          toast('Respaldo descargado');
        } catch (ex) { toast('No se pudo generar el respaldo: ' + ex.message, 'danger'); }
        setBusy(btn, false);
      };
    }
  }

  // ---------- Servicios ----------
  function serviceForm(x0 = null) {
    const x = x0 || { id: '', name: '', category: 'Cortes', minutes: 30, price: 0, color: BARBER_COLORS[0], active: true, online: true };
    const m = openModal({
      title: x0 ? 'Editar servicio' : 'Nuevo servicio', size: 'md',
      body: `<form class="stack" data-f><div class="form-grid">
        <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(x.name)}" placeholder="Ej.: Corte + cejas" autofocus></div>
        <div class="field"><label>Categoría</label><select class="select" name="category">${SERVICE_CATEGORIES.map((c) => `<option ${x.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Precio (${esc(loc().sym)}) *</label><input class="input" name="price" inputmode="decimal" value="${num(x.price || 0, loc().dec)}"></div>
        <div class="field"><label>Duración (minutos)</label><select class="select" name="minutes">${[10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180].map((v) => `<option value="${v}" ${Number(x.minutes) === v ? 'selected' : ''}>${v} min</option>`).join('')}</select></div>
        <div class="field"><label>Color</label><div class="row" style="gap:6px;flex-wrap:wrap">${BARBER_COLORS.map((c) => `<label class="color-dot-r"><input type="radio" name="color" value="${c}" ${x.color === c ? 'checked' : ''} hidden><span style="background:${c}"></span></label>`).join('')}</div></div>
      </div>
      <label class="check"><input type="checkbox" name="online" ${x.online !== false ? 'checked' : ''}> Se puede reservar en línea</label>
      <label class="check"><input type="checkbox" name="active" ${x.active !== false ? 'checked' : ''}> Activo</label>
      <div class="error-msg" data-err></div></form>`,
      footer: `${x0 ? `<button class="btn btn-ghost text-danger" data-del>${icon('trash')} Eliminar</button>` : ''}<span class="grow"></span><button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    m.el.querySelector('[data-ok]').onclick = async () => {
      const name = F.name.value.trim();
      if (!name) { m.el.querySelector('[data-err]').textContent = 'Escribe el nombre.'; return; }
      const item = { ...x, id: x.id || 's' + shortId(6), name, category: F.category.value, price: round2(parseNum(F.price.value)), minutes: Number(F.minutes.value) || 30, color: F.color.value || x.color, online: F.online.checked, active: F.active.checked };
      const list = x0 ? s().services.map((y) => (y.id === x0.id ? item : y)) : [...s().services, item];
      await store.saveSettings({ services: list }); m.close(); toast('Servicio guardado');
    };
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Eliminar servicio', message: `¿Eliminar “${x0.name}”? El historial se conserva. Si solo no lo ofreces por ahora, desmarca “Activo”.`, confirmText: 'Eliminar', danger: true }))) return;
      await store.saveSettings({ services: s().services.filter((y) => y.id !== x0.id) }); m.close(); toast('Servicio eliminado');
    });
  }

  // ---------- Planes del club ----------
  function planForm(p = null) {
    const x = p || { id: '', name: '', price: 0, visits: 4, days: 30, services: ['corte'], active: true, note: '' };
    const m = openModal({
      title: p ? 'Editar plan del club' : 'Nuevo plan del club', size: 'md',
      body: `<form class="stack" data-f><div class="form-grid">
        <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(x.name)}" placeholder="Ej.: Club mensual 4 cortes" autofocus></div>
        <div class="field"><label>Precio (${esc(loc().sym)}) *</label><input class="input" name="price" inputmode="decimal" value="${num(x.price || 0, loc().dec)}"></div>
        <div class="field"><label>Servicios incluidos</label><input class="input" name="visits" inputmode="numeric" value="${esc(x.visits)}"></div>
        <div class="field"><label>Vigencia (días)</label><input class="input" name="days" inputmode="numeric" value="${esc(x.days)}"></div>
        <div class="field"><label>Nota (se muestra al vender)</label><input class="input" name="note" value="${esc(x.note || '')}" placeholder="Ej.: Ahorra 2 cortes"></div>
        <div class="field full"><label>¿Qué servicios cubre? (ninguno marcado = cualquiera)</label><div class="chips chips-wrap">${store.activeServices.map((sv) => `<label class="chip ${(x.services || []).includes(sv.id) ? 'on' : ''}"><input type="checkbox" name="sv" value="${sv.id}" ${(x.services || []).includes(sv.id) ? 'checked' : ''} hidden>${esc(sv.name)}</label>`).join('')}</div></div>
      </div>
      <label class="check"><input type="checkbox" name="active" ${x.active !== false ? 'checked' : ''}> Activo (se ofrece al vender)</label>
      <div class="box small" data-calc></div><div class="error-msg" data-err></div></form>`,
      footer: `${p ? `<button class="btn btn-ghost text-danger" data-del>${icon('trash')} Eliminar</button>` : ''}<span class="grow"></span><button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const f = m.el.querySelector('[data-f]'); const F = f.elements;
    const chosen = () => [...f.querySelectorAll('input[name="sv"]:checked')].map((i) => i.value);
    const calc = () => {
      const ids = chosen(); const ref = ids.length ? Math.max(...ids.map((id) => store.service(id)?.price || 0)) : Math.max(...store.activeServices.map((y) => y.price || 0), 0);
      const n = Math.max(1, Math.round(parseNum(F.visits.value)) || 1); const price = parseNum(F.price.value) || 0;
      const normal = ref * n;
      m.el.querySelector('[data-calc]').innerHTML = normal > 0 ? `Precio normal aprox.: <b>${usd(normal)}</b> · el cliente ${normal > price ? `ahorra <b class="text-success">${usd(normal - price)}</b>` : '<b class="text-danger">no ahorra</b>'} · cada servicio le sale a <b>${usd(price / n)}</b>` : '';
    };
    f.querySelectorAll('label.chip input').forEach((i) => i.onchange = () => { i.parentElement.classList.toggle('on', i.checked); calc(); });
    F.price.oninput = F.visits.oninput = calc; calc();
    m.el.querySelector('[data-ok]').onclick = async () => {
      const name = F.name.value.trim(); const err = m.el.querySelector('[data-err]');
      if (!name) { err.textContent = 'Escribe el nombre del plan.'; return; }
      const plan = { ...(p || {}), id: p?.id || 'p' + shortId(6), name, price: round2(parseNum(F.price.value)), visits: Math.max(1, Math.round(parseNum(F.visits.value)) || 1), days: Math.max(1, Math.round(parseNum(F.days.value)) || 30), services: chosen(), note: F.note.value.trim(), active: F.active.checked };
      const plans = p ? s().plans.map((y) => (y.id === p.id ? plan : y)) : [...s().plans, plan];
      await store.saveSettings({ plans }); m.close(); toast('Plan guardado');
    };
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Eliminar plan', message: `¿Eliminar “${p.name}”? Los clientes que ya lo tienen lo siguen usando hasta que venza.`, confirmText: 'Eliminar', danger: true }))) return;
      await store.saveSettings({ plans: s().plans.filter((y) => y.id !== p.id) }); m.close(); toast('Plan eliminado');
    });
  }

  el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sec = b.dataset.s; render(); });
  render();
  return store.on('*', (evt) => { if (evt === 'settings' && ['servicios', 'club', 'reserva'].includes(sec)) render(); });
}
