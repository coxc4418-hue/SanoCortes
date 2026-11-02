# SanoCortes 💈

Software de gestión para barberías de la línea **Sano** (SanoGym, SanoDental, SanoDoctor, SanoTecnico, SanoGestion).
PWA instalable (PC, tablet, Android, iPhone) y mundial: el país se elige la primera vez y define moneda,
formas de pago y código de WhatsApp (los precios sugeridos se adaptan a la moneda).

**Producción:** https://sano-cortes.web.app · **Credenciales:** `CREDENCIALES_SANO_CORTES.txt` (no se sube a git)

## Qué hace

| Módulo | Detalle |
|---|---|
| Agenda por barbero | Columnas por barbero con su horario, descanso y color; vista de día y de 7 días; detecta choques de horario; recordatorios por WhatsApp; citas que no vinieron y reprogramadas. |
| Reserva en línea | `/reservar/NOMBRE`: el cliente elige servicios, barbero (o el primero libre), día y hora libre real y deja su WhatsApp, sin cuenta. La barbería la acepta en un toque o la acepta sola. |
| Sala de espera | Turnos sin cita numerados, tiempo estimado por barbero, “el primero libre”, pasar a la silla, llamar al siguiente y reasignar. |
| Pantalla de turnos | Para un TV: quién está en cada silla, la fila y las próximas citas con aviso sonoro. Modo autoservicio en tablet: el cliente toma su turno con su teléfono. Salir pide PIN. |
| Clientes | Ficha con foto, ficha de estilo (degradado, número de máquina, arriba, barba, nuca, tipo de cabello, piel), foto del corte, historial de cortes, citas y pagos, barbero preferido y ciclo de corte. Importar/exportar CSV. |
| Fidelización | “Les toca corte” según su ciclo real, clientes perdidos, cumpleaños, club por vencer, premios y saldos, con el mensaje de WhatsApp listo y registro de a quién ya se le escribió. |
| Sellos y club | Tarjeta de sellos (ej. 10 cortes = 1 gratis) y club de cortes prepagados (ej. 4 cortes al mes). Tarjeta digital `/tarjeta/CÓDIGO` con QR, sellos, club, próxima cita y botón de reservar. |
| Cobrar | Servicios y productos por barbero, propinas por barbero, club y premios automáticos, fiado, varias formas de pago y vuelto, guarda la receta del corte. |
| Barberos y pagos | Comisión, alquiler de silla o sueldo; comisión por productos; liquidación del periodo con propinas, adelantos y alquiler; pago con recibo e historial. |
| Caja, recibos y productos | Apertura, gastos y cierre de caja; recibos y anulaciones con PIN; inventario de ceras, aceites y bebidas con alertas de stock. |
| Reportes | Facturación, cortes, ocupación de sillas, ranking de barberos, horas pico, servicios, retención, origen de las citas, productos y gastos (con PIN). |
| Demo | 30 minutos sin registro con una barbería completa de ejemplo (PIN 1234) y recorrido guiado; todo se borra al terminar. |

## Estructura

- `public/` — la app (JavaScript sin compilación + Firebase 10.14.1). `js/views/` una pantalla por archivo; `js/ops.js` reglas de negocio; `js/barber.js` servicios, planes, ficha de estilo y horarios; `js/store.js` datos en tiempo real.
- `firestore.rules` — cada barbería solo ve lo suyo (`tenants/{uid}`); `cards/{código}` y `booking/{nombre}` se leen solo por clave exacta; `requests` valida cada solicitud de reserva.
- `scripts/` — aprovisionamiento y pruebas.

## Comandos (desde `scripts/`)

```sh
# Emuladores (en la carpeta del proyecto)
firebase emulators:start --only auth,firestore,hosting --project sano-cortes   # app en http://127.0.0.1:5111/?emu=1

sh test-emu.sh                 # crea 3 cuentas en el emulador y corre la prueba E2E (44 verificaciones)
node mobile-check.mjs          # sin scroll lateral de 320 px a 1366 px
node prod-smoke.mjs shots      # prueba rápida en producción (la demo se limpia sola)
node pwa-check.mjs             # instalable en PC y Android

node provision.mjs 20          # crea/actualiza las cuentas en producción
node icons.mjs                 # regenera íconos y logos desde public/assets/logo.svg
firebase deploy --only firestore,hosting --project sano-cortes
```
