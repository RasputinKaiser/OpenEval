/** RFC-4180 cell: always quoted, embedded quotes doubled. */
export function csvCell(val: unknown): string {
  const str = val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    // Escape the header row too — a column key with a comma/quote/newline would
    // otherwise misalign it against the quoted data cells below.
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(",")),
  ].join("\n");
  download(filename, csv, "text/csv");
}

export function exportJson(filename: string, data: unknown): void {
  download(filename, JSON.stringify(data, null, 2), "application/json");
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}