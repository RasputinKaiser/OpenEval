import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.pages-dist');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Pages requires a stable package version');
function countCases(dir) { return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => n + (entry.isDirectory() ? countCases(path.join(dir, entry.name)) : entry.name.endsWith('.case.json') ? 1 : 0), 0); }
fs.mkdirSync(out, { recursive: true });
// Only these public website files are published; never package the checkout or runtime data.
for (const name of ['index.html', '404.html', 'styles.css', 'site.js', 'social.svg']) {
  const content = fs.readFileSync(path.join(root, 'site', name), 'utf8').replaceAll('{{VERSION}}', version).replaceAll('{{CASE_COUNT}}', String(countCases(path.join(root, 'cases'))));
  if (/\{\{[A-Z_]+\}\}/.test(content)) throw new Error(`Unresolved template in ${name}`);
  fs.writeFileSync(path.join(out, name), content);
}
fs.copyFileSync(path.join(root, 'site/social.png'), path.join(out, 'social.png'));
fs.copyFileSync(path.join(root, 'public/icon.svg'), path.join(out, 'icon.svg'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://rasputinkaiser.github.io/OpenEval/sitemap.xml\n');
fs.writeFileSync(path.join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://rasputinkaiser.github.io/OpenEval/</loc></url></urlset>\n');
console.log(`Built OpenEval ${version} project site (${countCases(path.join(root, 'cases'))} cases).`);
