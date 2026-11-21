import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { BadRequestException } from '../../core/exceptions';
import { MAX_CANDIDATES_PER_BATCH, PASS_MARK } from '../enums';

export interface ParsedCandidate {
  rowNumber: number;
  enrolmentId: string;
  name: string;
  phone: string;
  score: number;
}

export interface RowError {
  row: number;
  column: string;
  message: string;
}

export interface SheetParseResult {
  candidates: ParsedCandidate[];
  errors: RowError[];
}

const REQUIRED_COLUMNS = ['enrolment_id', 'name', 'phone', 'score'];
const NAME_PATTERN = /^\p{L}[\p{L}\p{M} .'-]{1,99}$/u; // letters only: also blocks "=FORMULA()" injection
const ENROLMENT_PATTERN = /^[A-Za-z0-9-]{3,40}$/;
const PHONE_PATTERN = /^(?:\+91|91|0)?([6-9]\d{9})$/; // Indian mobile, optional +91 / 91 / 0 prefix

export class CandidateSheetParserService {
  /** Reads a .csv or .xlsx file into rows of text. Row 0 is the header. */
  async readRows(buffer: Buffer, fileName: string): Promise<string[][]> {
    const name = fileName.toLowerCase();

    if (name.endsWith('.csv')) {
      try {
        // relax_quotes: a stray quote inside a cell (e.g. =HYPERLINK("x")) becomes a row error, not a crash.
        return parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true });
      } catch (err) {
        throw new BadRequestException(`The CSV file could not be read: ${(err as Error).message}`);
      }
    }

    if (name.endsWith('.xlsx')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      const rows: string[][] = [];
      sheet?.eachRow((row) => {
        const cells: string[] = [];
        for (let col = 1; col <= row.cellCount; col++) cells.push(row.getCell(col).text.trim());
        rows.push(cells);
      });
      return rows;
    }

    return [];
  }

  /**
   * Checks every row and returns ALL problems, not just the first one,
   * so the centre can fix the whole file in one go.
   */
  validateRows(rows: string[][]): SheetParseResult {
    if (rows.length < 2) {
      return { candidates: [], errors: [{ row: 1, column: '-', message: 'The file has no candidates' }] };
    }

    // 1. Header: find which column holds which field ("Enrolment ID" -> "enrolment_id").
    const header = rows[0].map((cell) => cell.trim().toLowerCase().replace(/\s+/g, '_'));
    const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
    if (missing.length > 0) {
      return {
        candidates: [],
        errors: missing.map((column) => ({ row: 1, column, message: `Missing column "${column}"` })),
      };
    }
    if (rows.length - 1 > MAX_CANDIDATES_PER_BATCH) {
      return {
        candidates: [],
        errors: [{ row: 1, column: '-', message: `A batch can have at most ${MAX_CANDIDATES_PER_BATCH} candidates` }],
      };
    }
    const col = (column: string) => header.indexOf(column);

    // 2. Each data row.
    const candidates: ParsedCandidate[] = [];
    const errors: RowError[] = [];
    const enrolmentSeenInRow = new Map<string, number>();
    const phoneSeenInRow = new Map<string, number>();

    rows.slice(1).forEach((cells, index) => {
      const row = index + 2; // the number the centre sees in Excel (header is row 1)
      const enrolmentId = (cells[col('enrolment_id')] ?? '').trim().toUpperCase();
      const name = (cells[col('name')] ?? '').trim();
      const rawPhone = (cells[col('phone')] ?? '').replace(/[\s-]/g, '');
      const rawScore = (cells[col('score')] ?? '').trim();
      const rowErrors: RowError[] = [];

      if (!ENROLMENT_PATTERN.test(enrolmentId)) {
        rowErrors.push({ row, column: 'enrolment_id', message: 'Enrolment ID must be 3-40 letters, digits or "-"' });
      } else if (enrolmentSeenInRow.has(enrolmentId)) {
        rowErrors.push({ row, column: 'enrolment_id', message: `Duplicate of row ${enrolmentSeenInRow.get(enrolmentId)}` });
      }

      if (!NAME_PATTERN.test(name)) {
        rowErrors.push({ row, column: 'name', message: 'Name must be 2-100 letters (spaces, dots, hyphens allowed)' });
      }

      const phoneMatch = PHONE_PATTERN.exec(rawPhone);
      const phone = phoneMatch ? `+91${phoneMatch[1]}` : '';
      if (!phoneMatch) {
        rowErrors.push({ row, column: 'phone', message: 'Phone must be a valid 10-digit Indian mobile number' });
      } else if (phoneSeenInRow.has(phone)) {
        rowErrors.push({ row, column: 'phone', message: `Duplicate of row ${phoneSeenInRow.get(phone)}` });
      }

      const score = Number(rawScore);
      if (!/^\d{1,3}$/.test(rawScore) || score > 100) {
        rowErrors.push({ row, column: 'score', message: 'Score must be a whole number from 0 to 100' });
      } else if (score < PASS_MARK) {
        rowErrors.push({ row, column: 'score', message: `Score is below the pass mark (${PASS_MARK}); only passed candidates can be certified` });
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        return;
      }
      enrolmentSeenInRow.set(enrolmentId, row);
      phoneSeenInRow.set(phone, row);
      candidates.push({ rowNumber: row, enrolmentId, name, phone, score });
    });

    return { candidates, errors };
  }
}
