#!/bin/sh
# Reinicia los datos del emulador, crea 3 sedes de prueba y corre la prueba E2E.
cd "$(dirname "$0")"
curl -s -X DELETE "http://127.0.0.1:8580/emulator/v1/projects/sano-cortes/databases/(default)/documents" > /dev/null
curl -s -X DELETE "http://127.0.0.1:9599/emulator/v1/projects/sano-cortes/accounts" > /dev/null
rm -f .accounts-emu.json
node provision.mjs 3 --emu > /dev/null && node e2e.mjs "http://127.0.0.1:5111" "${1:-shots}"
