import { describe, expect, it } from 'vitest';
import { appendCsvColumns, csvRecords } from './results-csv';

describe('results CSV column migration', () => {
 it('preserves literal multiline decisions and doubled quotation marks as one record', () => {
  const text = 'model,decisionText\r\nfake,"first line\r\nsecond ""quoted"" line"\r\nother,"no admission"\r\n';
  expect(csvRecords(text)).toEqual(['model,decisionText',
   'fake,"first line\r\nsecond ""quoted"" line"', 'other,"no admission"']);
  const migrated = appendCsvColumns(text, ['admittedTotal', 'admissionsByYear']);
  expect(csvRecords(migrated)).toEqual(['model,decisionText,admittedTotal,admissionsByYear',
   'fake,"first line\r\nsecond ""quoted"" line",,', 'other,"no admission",,']);
 });
 it('adds only missing columns and retains already migrated text exactly', () => {
  const text = 'model,admittedTotal\nfake,20\n';
  const migrated = appendCsvColumns(text, ['admittedTotal', 'admissionsByYear']);
  expect(migrated).toBe('model,admittedTotal,admissionsByYear\nfake,20,\n');
  expect(appendCsvColumns(migrated, ['admittedTotal', 'admissionsByYear'])).toBe(migrated);
 });
 it('fails explicitly on missing headers and unterminated fields', () => {
  expect(() => appendCsvColumns('', ['admittedTotal'])).toThrow('header');
  expect(() => csvRecords('model,decision\nfake,"unterminated\n')).toThrow('unterminated');
 });
});
