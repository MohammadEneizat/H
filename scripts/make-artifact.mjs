// Packs the artifact build (dist-artifact/app.js + app.css) into one HTML page
// that loads React from cdnjs. Used to publish the app as a hosted page.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('dist-artifact');
const js = readFileSync(resolve(dir, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(resolve(dir, 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');

const html = `<title>Ampacity Workbench</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="IEC 60287 current rating calculator for single-core power cable circuits">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${css}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>
${js}
</script>
`;
const out = resolve(dir, 'ampacity-workbench.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} kB)`);
