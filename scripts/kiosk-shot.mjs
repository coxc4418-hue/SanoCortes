// SanoCortes — Capturas de la Pantalla de turnos (sala y autoservicio) en teléfono y tablet, usando la demo.
// Uso: node kiosk-shot.mjs [url=https://sano-cortes.web.app] [carpeta]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'https://sano-cortes.web.app';
const OUT = process.argv[3] || 'shots/kiosk';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[360, 760, true], [390, 844, true], [768, 1024, true], [844, 390, true]];

const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await p.goto(BASE, { waitUntil: 'networkidle2' });
await p.click('#lg-demo');
await p.waitForSelector('.country-grid [data-c="VE"]', { timeout: 60000 });
await p.click('.country-grid [data-c="VE"]'); await sleep(300);
await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
await p.waitForFunction(() => document.querySelector('#demo-end') && !document.getElementById('boot'), { timeout: 120000 });
await p.waitForSelector('.tour-tip', { timeout: 20000 }).catch(() => {});
await p.evaluate(async () => { (await import('/js/tour.js')).stopTour(); localStorage.setItem('sc_kiosk_mode', 'tv'); });
await sleep(800);
await p.evaluate(() => { location.hash = '#/pantalla'; });
await p.waitForSelector('.tvk', { timeout: 20000 });
await sleep(1500);
const measure = (W) => ({ sw: document.documentElement.scrollWidth, over: [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > W + 1 && ![...el.children].some((c) => c.getBoundingClientRect().right > W + 1); }).slice(0, 6).map((el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' → ' + Math.round(el.getBoundingClientRect().right)) });
for (const [w, h, m] of SIZES) {
  await p.setViewport({ width: w, height: h, isMobile: m, hasTouch: m, deviceScaleFactor: 2 });
  await sleep(900);
  await p.evaluate(() => document.querySelector('[data-mode="tv"]')?.click()); await sleep(900);
  console.log(w + 'x' + h, 'sala', JSON.stringify(await p.evaluate(measure, w)));
  await p.screenshot({ path: path.join(OUT, `${w}x${h}-sala.png`), fullPage: true });
  await p.evaluate(() => document.querySelector('[data-mode="self"]')?.click()); await sleep(900);
  console.log(w + 'x' + h, 'auto', JSON.stringify(await p.evaluate(measure, w)));
  await p.screenshot({ path: path.join(OUT, `${w}x${h}-auto.png`), fullPage: true });
}
await p.evaluate(() => localStorage.setItem('sc_kiosk_mode', 'tv'));
// Termina la demo (se borra)
await p.evaluate(() => document.getElementById('k-exit').click()); await p.waitForSelector('.modal [data-pin]'); await p.type('.modal [data-pin]', '1234');
await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click()); await sleep(1500);
await p.evaluate(() => document.getElementById('demo-end').click());
await p.waitForSelector('.modal [data-yes]'); await p.click('.modal [data-yes]');
await p.waitForSelector('#login-form', { timeout: 60000 });
console.log('errores:', errs.length ? errs : 'ninguno');
await b.close();
