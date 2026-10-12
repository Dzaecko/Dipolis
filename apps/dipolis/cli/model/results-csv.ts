export function csvRecords(text: string): string[] {
 const records: string[] = [];
 let quoted = false, start = 0;
 for (let index = 0; index < text.length; index++) {
  if (text[index] === '"') {
   if (quoted && text[index + 1] === '"') index++;
   else quoted = !quoted;
  } else if (text[index] === '\n' && !quoted) {
   const end = text[index - 1] === '\r' ? index - 1 : index;
   records.push(text.slice(start, end));
   start = index + 1;
  }
 }
 if (quoted) throw new Error('Results CSV contains an unterminated quoted field');
 if (start < text.length) records.push(text.slice(start));
 return records;
}

export function appendCsvColumns(text: string, columns: readonly string[]): string {
 const records = csvRecords(text);
 const header = records[0];
 if (!header) throw new Error('Results CSV header is missing');
 const existing = header.split(',');
 const missing = columns.filter(column => !existing.includes(column));
 if (!missing.length) return text;
 return [header + ',' + missing.join(','),
  ...records.slice(1).map(row => row + ','.repeat(missing.length))].join('\n') + '\n';
}
