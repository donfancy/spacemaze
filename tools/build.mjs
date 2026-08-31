// Deployment-Build: stellt dist/ zusammen, 1:1 hochladbar in den WEBROOT
// von mazestorm.io/.de (zero dependencies, kein Bundling -- ES-Module laufen
// direkt im Browser, genau wie beim Dev-Server).
//
//   node tools/build.mjs     (oder: npm run build)
//
// dist/ spiegelt die Dev-Struktur, denn index.html referenziert /public/...
// und /src/... ABSOLUT von der Domain-Wurzel:
//   dist/index.html   <- public/index.html (der Server-Alias "/" wird real)
//   dist/favicon.ico  <- public/favicon.ico (Browser fragen /favicon.ico an
//                        der Wurzel an; beim Dev-Server erledigt das der
//                        public-Fallback)
//   dist/public/      <- public/ OHNE index.html und proto2026 (Prototyp
//                        bleibt Werkstatt, kommt nicht mit ins Netz)
//   dist/src/         <- src/
// WICHTIG: wegen der absoluten Pfade MUSS dist/ in die DOMAIN-WURZEL,
// ein Unterverzeichnis (mazestorm.de/spiel/) funktioniert nicht.

import { cp, rm, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);

await copyFile(join(ROOT, 'public', 'index.html'), join(DIST, 'index.html'));
await copyFile(join(ROOT, 'public', 'favicon.ico'), join(DIST, 'favicon.ico'));
const clean = (src) => !src.endsWith('.DS_Store');
await cp(join(ROOT, 'src'), join(DIST, 'src'), { recursive: true, filter: clean });
await cp(join(ROOT, 'public'), join(DIST, 'public'), {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(join(ROOT, 'public').length);
    return !rel.startsWith(sep + 'proto2026') && rel !== sep + 'index.html' && clean(src);
  },
});

console.log('dist/ steht -- Inhalt komplett in den Webroot laden (Domain-Wurzel!).');
