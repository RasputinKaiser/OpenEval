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
