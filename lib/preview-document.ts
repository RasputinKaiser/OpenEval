/** The policy precedes artifact bytes so an artifact cannot loosen it. */
export function previewDocument(content: string, active: boolean): string {
  const policy = `default-src 'none'; script-src ${active ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body>${content}${active ? '' : '<style>*,*::before,*::after{animation-play-state:paused!important}</style>'}</body></html>`;
}
