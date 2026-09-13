const root = document.documentElement;
const themeButton = document.querySelector('#theme');
function applyTheme(theme) {
  root.dataset.theme = theme;
  themeButton.setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
}
try { applyTheme(localStorage.getItem('openeval-site-theme') === 'light' ? 'light' : 'dark'); } catch { applyTheme('dark'); }
themeButton.addEventListener('click', () => {
  const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem('openeval-site-theme', theme); } catch { /* Theme still works without persistence. */ }
});
const runs = [
  { name: 'Baseline', passed: 24, time: 48, tokens: 120000 },
  { name: 'Prompt revision', passed: 30, time: 41, tokens: 110000 },
  { name: 'Tool revision', passed: 34, time: 36, tokens: 98000 },
];
const rows = [...document.querySelectorAll('[data-run]')];
let metric = 'pass', pinned = 0;
function detail(index, temporary = false) {
  document.querySelector('#selection-label').textContent = `${runs[index].name} · ${temporary ? 'INSPECTION' : 'PINNED INSPECTION'}`;
  const run = runs[index];
  document.querySelector('#selection-detail').textContent = metric === 'pass' ? `${run.passed} of 40 example attempts passed. Same illustrative case cohort.` : metric === 'time' ? `${run.time} seconds median duration across 40 example attempts. Lower is faster.` : `${run.tokens.toLocaleString('en-US')} input + output tokens across 40 example attempts. Cost is unavailable.`;
}
function paint() {
  rows.forEach((row, index) => {
    const run = runs[index];
    const value = metric === 'pass' ? `${run.passed / 40 * 100}%` : metric === 'time' ? `${run.time} s` : `${run.tokens / 1000}k`;
    const amount = metric === 'pass' ? run.passed / 40 : metric === 'time' ? run.time / 60 : run.tokens / 140000;
    row.querySelector('.bar').style.setProperty('--amount', `${amount * 100}%`);
    row.querySelector('strong').textContent = value;
    row.setAttribute('aria-pressed', String(pinned === index));
    row.setAttribute('aria-label', `${run.name}, ${metric === 'pass' ? 'pass rate' : metric}, ${value}. Pin inspection`);
  });
  if (pinned !== null) detail(pinned);
}
rows.forEach((row, index) => {
  row.addEventListener('mouseenter', () => detail(index, true));
  row.addEventListener('focus', () => detail(index, true));
  const restore = () => { if (pinned !== null) detail(pinned); };
  row.addEventListener('mouseleave', restore); row.addEventListener('blur', restore);
  row.addEventListener('click', () => { pinned = index; paint(); });
});
document.querySelectorAll('[data-metric]').forEach(button => button.addEventListener('click', () => {
  metric = button.dataset.metric;
  document.querySelectorAll('[data-metric]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
  paint();
  if (pinned === null) { document.querySelector('#selection-detail').textContent = 'Hover, focus, or select a run to inspect this metric.'; }
}));
document.querySelector('.preview').addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  pinned = null; paint();
  document.querySelector('#selection-label').textContent = 'INSPECTION CLEARED';
  document.querySelector('#selection-detail').textContent = 'Hover, focus, or select a run to inspect its values.';
});
paint();
document.querySelector('#copy-install').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#install-command').textContent);
    status.textContent = 'Commands copied. Paste them into your terminal.';
  } catch { status.textContent = 'Clipboard unavailable. Select the commands above and copy them manually.'; }
});

// A bounded synthetic cohort makes the complete chart-to-message journey explorable.
const dialog = document.querySelector('#evidence-dialog');
const runSelect = document.querySelector('#evidence-run');
const filterSelect = document.querySelector('#evidence-filter');
const tasks = ['Route planner', 'Data story', 'Log summary', 'Configuration edit', 'Sortable results', 'Test repair', 'Accessible form', 'Chart labels'];
let selectedAttempt = 0;
function attempts() {
  const run = runs[Number(runSelect.value)];
  return Array.from({ length: 40 }, (_, index) => ({ index, task: tasks[index % tasks.length], passed: index < run.passed, duration: run.time, tokens: run.tokens / 40 }));
}
function renderMessages(attempt) {
  document.querySelector('#transcript-title').textContent = `Attempt ${String(attempt.index + 1).padStart(2, '0')} · ${attempt.task}`;
  const outcome = document.querySelector('#attempt-outcome');
  outcome.textContent = attempt.passed ? '✓ Passed' : '× Failed';
  outcome.style.color = attempt.passed ? 'var(--teal)' : 'var(--fail)';
  document.querySelector('#attempt-metrics').textContent = `${attempt.duration} s · ${attempt.tokens.toLocaleString('en-US')} I/O tokens · Cost unavailable`;
  const messages = document.querySelector('#example-messages');
  messages.replaceChildren();
  const addMessage = (role, text) => {
    const card = document.createElement('article'); card.className = `message ${role.toLowerCase()}`;
    const label = document.createElement('span'); label.className = 'role'; label.textContent = role;
    const body = document.createElement('p'); body.textContent = text;
    card.append(label, body); messages.append(card);
  };
  addMessage('USER', `Complete the ${attempt.task.toLowerCase()} task. Keep the existing contract, handle empty input, and run the checks before finishing.`);
  addMessage('ASSISTANT', 'I’ll inspect the fixture, make a focused change, and verify the expected behavior.');
  const tool = document.createElement('details'); tool.className = 'message';
  const summary = document.createElement('summary'); summary.textContent = `Tool result · ${attempt.passed ? '6/6 checks passed' : '4/6 checks passed — inspect failures'}`;
  const output = document.createElement('pre'); output.textContent = attempt.passed ? 'tests_pass\n✓ expected output\n✓ empty input\n✓ keyboard behavior\n✓ stable ordering\n✓ file boundaries\n✓ malformed input\n\nExit code: 0' : 'tests_pass\n✓ expected output\n× empty input: expected an explicit empty state\n✓ keyboard behavior\n✓ stable ordering\n✓ file boundaries\n× malformed input: expected a useful error\n\nExit code: 1';
  tool.append(summary, output); messages.append(tool);
  addMessage('ASSISTANT', attempt.passed ? 'The requested behavior is implemented and all six example checks pass.' : 'The primary path works, but empty and malformed input still fail. This attempt is incomplete.');
}
function renderAttempts() {
  const cohort = attempts();
  const visible = cohort.filter(a => filterSelect.value === 'all' || (filterSelect.value === 'passed') === a.passed);
  if (!visible.some(a => a.index === selectedAttempt)) selectedAttempt = visible[0]?.index ?? 0;
  const run = runs[Number(runSelect.value)];
  document.querySelector('#evidence-summary').textContent = `${visible.length} shown · ${run.passed}/40 passed · ${40 - run.passed} failed`;
  const grid = document.querySelector('#attempt-grid'); grid.replaceChildren();
  visible.forEach(attempt => {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.outcome = attempt.passed ? 'passed' : 'failed';
    button.textContent = `${attempt.passed ? '✓' : '×'} ${String(attempt.index + 1).padStart(2, '0')}`;
    button.setAttribute('aria-label', `Attempt ${attempt.index + 1}, ${attempt.task}, ${attempt.passed ? 'passed' : 'failed'}`);
    button.setAttribute('aria-pressed', String(attempt.index === selectedAttempt));
    button.addEventListener('click', () => {
      selectedAttempt = attempt.index;
      [...grid.children].forEach(control => control.setAttribute('aria-pressed', String(control === button)));
      renderMessages(attempt);
    });
    grid.append(button);
  });
  renderMessages(cohort[selectedAttempt]);
}
function openEvidence() {
  runSelect.value = String(pinned ?? 0); filterSelect.value = 'all'; selectedAttempt = 0;
  renderAttempts(); dialog.showModal();
}
document.querySelector('#open-evidence').addEventListener('click', openEvidence);
document.querySelector('#tour-evidence').addEventListener('click', openEvidence);
document.querySelector('#close-evidence').addEventListener('click', () => dialog.close());
document.querySelector('#evidence-install').addEventListener('click', () => dialog.close());
runSelect.addEventListener('change', renderAttempts); filterSelect.addEventListener('change', renderAttempts);

const demos = {
  route: { name: 'Route planner', file: 'map-route-planner-v2.html', description: 'Choose a landmark. Step through the route. Watch the tour.' },
  marbles: { name: 'Kinetic Marble Lab', file: 'kinetic-marble-lab.html', description: 'Add an impulse. Change the tempo. Watch gravity do its work.' },
  fireflies: { name: 'Firefly garden', file: 'firefly-garden.html', description: 'Stir the garden and follow its wandering lights.' },
};
let demo = 'route';
const stage = document.querySelector('#demo-stage');
const routePlaceholder = stage.firstElementChild.cloneNode(true);
const playButton = document.querySelector('#play-demo');
const stopButton = document.querySelector('#stop-demo');
function stopDemo() {
  stage.replaceChildren();
  if (demo === 'route') stage.append(routePlaceholder.cloneNode(true));
  else {
    const placeholder = document.createElement('div'); placeholder.className = 'demo-placeholder';
    const orbs = document.createElement('div'); orbs.className = 'demo-orbs'; orbs.setAttribute('aria-hidden','true');
    for (let i=0;i<3;i++) orbs.append(document.createElement('i'));
    const heading = document.createElement('strong'); heading.textContent = demos[demo].name;
    const description = document.createElement('p'); description.textContent = demos[demo].description;
    placeholder.append(orbs, heading, description); stage.append(placeholder);
  }
  playButton.hidden = false; stopButton.hidden = true;
  document.querySelector('#demo-state').textContent = 'Ready when you are. No account or install.';
}
document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => {
  demo = button.dataset.demo;
  document.querySelectorAll('[data-demo]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
  stopDemo();
}));
playButton.addEventListener('click', () => {
  const frame = document.createElement('iframe');
  frame.title = `${demos[demo].name} reference demo`;
  frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
  frame.src = `demos/${demos[demo].file}`;
  stage.replaceChildren(frame); playButton.hidden = true; stopButton.hidden = false;
  document.querySelector('#demo-state').textContent = `${demos[demo].name} running. Use its controls below; Stop unloads it.`;
  stopButton.focus();
});
stopButton.addEventListener('click', () => { stopDemo(); playButton.focus(); });
