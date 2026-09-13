import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CaseDefinitionSchema } from '../lib/cases';
import { previewDocument } from '../lib/preview-document';

test('playback policy precedes artifact content and keeps scripts opt-in', () => {
 const content = '<script>window.example=1</script>';
 const still = previewDocument(content, false), active = previewDocument(content, true);
 assert.ok(still.indexOf('Content-Security-Policy') < still.indexOf(content));
 assert.match(still, /script-src 'none'/);
 assert.match(still, /animation-play-state:paused/);
 assert.match(active, /script-src 'unsafe-inline'/);
 assert.match(active, /connect-src 'none'/);
 assert.match(active, /frame-src 'none'/);
 assert.match(active, /form-action 'none'/);
});
for (const id of ['kinetic-marble-lab','firefly-garden','pocket-rhythm','map-route-planner-v2','data-story-card-v2']) {
 test(`${id}: reference motion, interaction and reset pass; placeholder fails`, async () => {
  const base=path.resolve('cases/visual-code');
  const spec=CaseDefinitionSchema.parse(JSON.parse(await fs.readFile(path.join(base, `visual-${id}.case.json`),'utf8')));
  const grader=spec.graders.find(g=>g.type==='exit_code'); assert.ok(grader && grader.type==='exit_code');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oe-playground-'));
  try {
   execFileSync('bash',[path.join(base,spec.oracle!.solve!)],{cwd:dir});
   execFileSync('bash',['-c',grader.command],{cwd:dir,timeout:5000});
   assert.equal(await fs.readFile(path.join(dir,`${id}.html`),'utf8'),await fs.readFile(path.join(base,'reference',`${id}.html`),'utf8')+'\n');
   for (const bad of spec.oracle!.known_bad!) {
    execFileSync('bash',[path.join(base,bad)],{cwd:dir});
    assert.throws(()=>execFileSync('bash',['-c',grader.command],{cwd:dir,timeout:5000,stdio:'pipe'}));
   }
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
 });
}

test('reference demos start paused when reduced motion is requested', async () => {
 const vm = await import('node:vm');
 for (const id of ['kinetic-marble-lab','firefly-garden','pocket-rhythm']) {
  const html=await fs.readFile(`cases/visual-code/reference/${id}.html`,'utf8');
  const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  const nodes=new Map<string, any>();
  const noop=()=>{};
  const get=(key:string)=>{if(!nodes.has(key))nodes.set(key,{getContext:()=>new Proxy({}, {get:()=>noop,set:()=>true}),textContent:''});return nodes.get(key);};
  const context={window:{}, document:{querySelector:get,addEventListener:noop},requestAnimationFrame:noop,matchMedia:()=>({matches:true}),Math};
  vm.runInNewContext(script,context,{timeout:1000});
  assert.equal(get('#pause').textContent,'Resume');
  assert.equal(get('#clock').textContent,'0.0s');
 }
});
