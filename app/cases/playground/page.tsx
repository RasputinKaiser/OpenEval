import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import ArtifactPreview from '@/components/ArtifactPreview';
import PageHeader from '@/components/PageHeader';
import { Sparkles } from 'lucide-react';

const scenes = [
  { id: 'map-route-planner-v2', name: 'Interactive Field Route', detail: 'Choose landmarks, follow connected stops, and watch a guided tour.' },
  { id: 'data-story-card-v2', name: 'Interactive Outcome Story', detail: 'Explore fixed cohort data with honest comparisons and missing-value handling.' },
  { id: 'kinetic-marble-lab', name: 'Kinetic Marble Lab', detail: 'Send a ripple through a colorful gravity playground.' },
  { id: 'firefly-garden', name: 'Firefly Garden', detail: 'Watch a glowing ecosystem breathe and drift.' },
  { id: 'pocket-rhythm', name: 'Pocket Rhythm', detail: 'Catch falling light with four lanes and keyboard or touch.' },
];
export default async function Playground() {
  const demos = await Promise.all(scenes.map(async scene => ({ ...scene, content: await fs.readFile(path.join(process.cwd(), 'cases/visual-code/reference', `${scene.id}.html`), 'utf8') })));
  return <main className="p-4 md:p-8 max-w-6xl mx-auto">
    <Link href="/cases" className="text-xs text-accent-soft">← Case library</Link>
    <PageHeader icon={Sparkles} title="Evaluation playground" subtitle="Games, living systems, and creative experiments you can watch and interact with." />
    <p className="text-sm text-fg-muted mb-6">These are reference demos, not agent outputs or benchmark results. Play one to explore the brief; then choose Build this challenge to configure a real evaluation.</p>
    <div className="space-y-8">{demos.map(scene => <section key={scene.id} className="card p-4 md:p-6" aria-labelledby={scene.id}>
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4"><div><h2 id={scene.id} className="text-lg font-semibold">{scene.name}</h2><p className="text-sm text-fg-muted mt-1">{scene.detail}</p></div><Link className="analysis-control" href={`/runs/new?caseIds=visual-${scene.id}`}>Build this challenge →</Link></div>
      <ArtifactPreview path={`${scene.id}.html`} content={scene.content} />
    </section>)}</div>
  </main>;
}
