import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.pages-dist');
const allowed = ['demos','.nojekyll','404.html','icon.svg','index.html','robots.txt','site.js','sitemap.xml','social.svg','social.png','styles.css'];
assert.deepEqual(fs.readdirSync(out).sort(), allowed.sort(), 'Only public website assets may be deployed');
const html = fs.readFileSync(path.join(out,'index.html'),'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
for (const [,target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (target.startsWith('#')) { if(target.length>1) assert.ok(ids.includes(target.slice(1)), `Missing anchor ${target}`); continue; }
  if (/^https:\/\//.test(target)) {
    const url = new URL(target);
    if(url.hostname === 'github.com' && url.pathname.includes('/blob/')) {
      const parts = url.pathname.split('/');
      const file = parts.slice(5).join('/');
      assert.ok(fs.existsSync(path.join(root,file)), `Missing documentation ${file}`);
    }
    continue;
  }
  assert.ok(fs.existsSync(path.join(out,target.split('?')[0])), `Missing local asset ${target}`);
}
assert.ok(!html.includes('{{'), 'No unresolved placeholders');
assert.ok(html.includes('EXAMPLE DATA') && html.includes('not a benchmark result'), 'Illustration provenance must be explicit');
assert.ok(html.includes('id="install-command"'), 'Install commands must be available without JavaScript');
console.log(`Pages checks passed: ${allowed.length} allowlisted entries, links, anchors, release substitutions, example provenance.`);

assert.deepEqual(fs.readdirSync(path.join(out, 'demos')).sort(), ['firefly-garden.html', 'kinetic-marble-lab.html', 'map-route-planner-v2.html']);
for (const name of fs.readdirSync(path.join(out,'demos'))) {
  const demo = fs.readFileSync(path.join(out,'demos',name),'utf8');
  assert.ok(demo.includes('Content-Security-Policy'), 'Reference demos require a network-restricting policy');
  assert.ok(demo.includes("connect-src 'none'"), 'Demo network requests must be blocked');
}
console.log('Reference demo allowlist and network policies passed.');
