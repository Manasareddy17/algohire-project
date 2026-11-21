import { MAX_CANDIDATES_PER_BATCH } from '../enums';
import { CandidateSheetParserService } from './candidate-sheet-parser.service';

describe('CandidateSheetParserService', () => {
  const service = new CandidateSheetParserService();
  const HEADER = ['enrolment_id', 'name', 'phone', 'score'];
  const validRow = (overrides: Partial<Record<'enrolment_id' | 'name' | 'phone' | 'score', string>> = {}) => {
    const row = { enrolment_id: 'psm-001', name: 'Ravi Kumar', phone: '9876543210', score: '75', ...overrides };
    return [row.enrolment_id, row.name, row.phone, row.score];
  };

  describe('readRows', () => {
    it('reads a CSV file into rows of text', async () => {
      const rows = await service.readRows(Buffer.from('﻿enrolment_id,name\nPSM-1, Ravi Kumar \n'), 'Batch.CSV');

      expect(rows).toEqual([['enrolment_id', 'name'], ['PSM-1', 'Ravi Kumar']]);
    });

    // Bug: a stray quote inside a cell made the CSV library throw, and the upload returned 500.
    it('keeps a cell with a stray quote as text so it becomes a row error instead of a crash', async () => {
      const rows = await service.readRows(Buffer.from('name\n=HYPERLINK("x")\n'), 'batch.csv');

      expect(rows[1]).toEqual(['=HYPERLINK("x")']);
    });

    it('returns no rows for a file type it does not support', async () => {
      expect(await service.readRows(Buffer.from('x'), 'batch.pdf')).toEqual([]);
    });
  });

  describe('validateRows', () => {
    it('returns normalised candidates and no errors for a valid file', () => {
      const result = service.validateRows([HEADER, validRow()]);

      expect(result.errors).toEqual([]);
      expect(result.candidates).toEqual([
        { rowNumber: 2, enrolmentId: 'PSM-001', name: 'Ravi Kumar', phone: '+919876543210', score: 75 },
      ]);
    });

    it.each([
      ['an empty file', []],
      ['a header without rows', [HEADER]],
    ])('reports %s', (_label, rows) => {
      expect(service.validateRows(rows).errors).toEqual([{ row: 1, column: '-', message: 'The file has no candidates' }]);
    });

    it('reports every missing column', () => {
      const result = service.validateRows([['name', 'phone'], ['Ravi Kumar', '9876543210']]);

      expect(result.candidates).toEqual([]);
      expect(result.errors).toEqual([
        { row: 1, column: 'enrolment_id', message: 'Missing column "enrolment_id"' },
        { row: 1, column: 'score', message: 'Missing column "score"' },
      ]);
    });

    it('accepts headers with different case, spacing and order', () => {
      const result = service.validateRows([
        ['Score', 'Phone', 'Name', 'Enrolment ID'],
        ['80', '9876543210', 'Priya Sharma', 'PSM-002'],
      ]);

      expect(result.errors).toEqual([]);
      expect(result.candidates[0]).toMatchObject({ enrolmentId: 'PSM-002', name: 'Priya Sharma', score: 80 });
    });

    it.each([
      ['name', { name: 'R' }],
      ['name', { name: 'Ravi 2' }],
      // A spreadsheet formula must never reach the database or the PDF.
      ['name', { name: '=HYPERLINK("http://evil")' }],
      ['phone', { phone: '12345' }],
      ['phone', { phone: '5876543210' }],
      ['enrolment_id', { enrolment_id: 'a' }],
      ['enrolment_id', { enrolment_id: 'PSM 001' }],
      ['score', { score: 'abc' }],
      ['score', { score: '101' }],
      ['score', { score: '-5' }],
    ])('rejects an invalid %s (%o)', (column, overrides) => {
      const result = service.validateRows([HEADER, validRow(overrides)]);

      expect(result.candidates).toEqual([]);
      expect(result.errors).toEqual([expect.objectContaining({ row: 2, column })]);
    });

    it('rejects a score below the pass mark with a message the centre understands', () => {
      const result = service.validateRows([HEADER, validRow({ score: '39' })]);

      expect(result.errors).toEqual([
        {
          row: 2,
          column: 'score',
          message: 'Score is below the pass mark (40); only passed candidates can be certified',
        },
      ]);
    });

    it.each(['40', '100'])('accepts the boundary score %s', (score) => {
      expect(service.validateRows([HEADER, validRow({ score })]).errors).toEqual([]);
    });

    it.each(['9876543210', '+919876543210', '919876543210', '09876543210', '98765 43210', '98765-43210'])(
      'normalises the phone format %s to +919876543210',
      (phone) => {
        expect(service.validateRows([HEADER, validRow({ phone })]).candidates[0].phone).toBe('+919876543210');
      },
    );

    it('rejects a duplicate enrolment id and points to the first row', () => {
      const result = service.validateRows([
        HEADER,
        validRow({ enrolment_id: 'PSM-001', phone: '9876543210' }),
        validRow({ enrolment_id: 'psm-001', phone: '9876543211' }),
      ]);

      expect(result.errors).toEqual([{ row: 3, column: 'enrolment_id', message: 'Duplicate of row 2' }]);
    });

    it('rejects a duplicate phone number written in a different format', () => {
      const result = service.validateRows([
        HEADER,
        validRow({ enrolment_id: 'PSM-001', phone: '9876543210' }),
        validRow({ enrolment_id: 'PSM-002', phone: '+91 98765 43210' }),
      ]);

      expect(result.errors).toEqual([{ row: 3, column: 'phone', message: 'Duplicate of row 2' }]);
    });

    it('collects errors from every bad row and every bad column instead of stopping at the first', () => {
      const result = service.validateRows([
        HEADER,
        validRow({ name: '1', phone: '1' }),
        validRow({ enrolment_id: 'PSM-002', phone: '9876543211' }),
        validRow({ enrolment_id: 'PSM-003', phone: '9876543212', score: '10' }),
      ]);

      expect(result.errors.map((error) => [error.row, error.column])).toEqual([
        [2, 'name'],
        [2, 'phone'],
        [4, 'score'],
      ]);
      expect(result.candidates).toHaveLength(1);
    });

    it('rejects a file with more rows than a batch allows', () => {
      const rows = [HEADER, ...Array.from({ length: MAX_CANDIDATES_PER_BATCH + 1 }, () => validRow())];

      expect(service.validateRows(rows).errors).toEqual([
        { row: 1, column: '-', message: `A batch can have at most ${MAX_CANDIDATES_PER_BATCH} candidates` },
      ]);
    });
  });
});
