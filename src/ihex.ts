import { readFile } from 'node:fs/promises';

/** A parsed Intel HEX record. */
export interface IHexRecord {
  /** Byte count of the data field. */
  byteCount: number;
  /** 16-bit address from the record. For data records this is the low 16 bits
   *  of the destination address (combined with any active extended-linear-address
   *  or extended-segment-address offset to form the full address). */
  address: number;
  /** Record type. See {@link IHexRecordType}. */
  type: number;
  /** Data bytes. Length === byteCount. */
  data: Buffer;
}

/** Standard Intel HEX record types. */
export const IHexRecordType = {
  Data: 0x00,
  EndOfFile: 0x01,
  ExtendedSegmentAddress: 0x02,
  StartSegmentAddress: 0x03,
  ExtendedLinearAddress: 0x04,
  StartLinearAddress: 0x05,
} as const;

export type IHexRecordType = (typeof IHexRecordType)[keyof typeof IHexRecordType];

export class IHexParseError extends Error {
  constructor(message: string, public readonly lineNumber: number, public readonly line: string) {
    super(`Line ${lineNumber}: ${message} (${JSON.stringify(line)})`);
    this.name = 'IHexParseError';
  }
}

/** Parse an Intel HEX file into an array of records. */
export async function parseFile(filename: string): Promise<IHexRecord[]> {
  const content = await readFile(filename, 'utf8');
  return parseString(content);
}

/** Parse Intel HEX content (string or Buffer) into an array of records.
 *  Empty/whitespace-only lines are skipped. */
export function parseString(content: string | Buffer): IHexRecord[] {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  const records: IHexRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    records.push(parseLine(line, i + 1));
  }
  return records;
}

/** Parse a single Intel HEX line. The line must already be trimmed and non-empty. */
export function parseLine(line: string, lineNumber = 1): IHexRecord {
  if (line[0] !== ':') {
    throw new IHexParseError('does not start with ":"', lineNumber, line);
  }
  const body = line.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(body)) {
    throw new IHexParseError('contains non-hex characters', lineNumber, line);
  }
  if (body.length % 2 !== 0) {
    throw new IHexParseError('odd number of hex digits', lineNumber, line);
  }
  if (body.length < 10) {
    throw new IHexParseError('too short (need at least byte-count + address + type + checksum)', lineNumber, line);
  }
  const bytes = Buffer.from(body, 'hex');
  const byteCount = bytes[0];
  if (bytes.length !== byteCount + 5) {
    throw new IHexParseError(`byte count mismatch (header says ${byteCount}, got ${bytes.length - 5} data bytes)`, lineNumber, line);
  }
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  if (sum !== 0) {
    throw new IHexParseError(`checksum failure (mod-256 sum = 0x${sum.toString(16).padStart(2, '0')})`, lineNumber, line);
  }
  const address = bytes.readUInt16BE(1);
  const type = bytes[3];
  const data = bytes.subarray(4, 4 + byteCount);
  return { byteCount, address, type, data: Buffer.from(data) };
}

export interface LoadIntoBufferOptions {
  /** If true, stop at the End-Of-File record (default true). If false, continue
   *  processing records past EOF (non-standard, but matches some legacy parsers). */
  stopAtEOF?: boolean;
  /** If true (default), throw if a data record's destination address would
   *  fall outside the buffer. If false, those bytes are silently skipped. */
  strictBounds?: boolean;
}

/** Apply parsed Intel HEX records to a Buffer, honoring extended-address records.
 *  Returns the highest byte index actually written (exclusive), or 0 if nothing was written. */
export function applyRecordsToBuffer(records: IHexRecord[], buffer: Buffer, opts: LoadIntoBufferOptions = {}): number {
  const { stopAtEOF = true, strictBounds = true } = opts;
  let upperAddress = 0;
  let highWaterMark = 0;
  for (const r of records) {
    switch (r.type) {
      case IHexRecordType.Data: {
        const start = upperAddress + r.address;
        const end = start + r.byteCount;
        if (end > buffer.length) {
          if (strictBounds) {
            throw new RangeError(`Data record ends at 0x${end.toString(16)} which is past buffer length 0x${buffer.length.toString(16)}`);
          }
          const writable = Math.max(0, buffer.length - start);
          if (writable > 0) r.data.copy(buffer, start, 0, writable);
          highWaterMark = Math.max(highWaterMark, Math.min(end, buffer.length));
        } else {
          r.data.copy(buffer, start);
          highWaterMark = Math.max(highWaterMark, end);
        }
        break;
      }
      case IHexRecordType.EndOfFile:
        if (stopAtEOF) return highWaterMark;
        break;
      case IHexRecordType.ExtendedLinearAddress:
        if (r.data.length !== 2) {
          throw new Error('Extended Linear Address record must carry 2 data bytes');
        }
        upperAddress = r.data.readUInt16BE(0) << 16;
        break;
      case IHexRecordType.ExtendedSegmentAddress:
        if (r.data.length !== 2) {
          throw new Error('Extended Segment Address record must carry 2 data bytes');
        }
        upperAddress = r.data.readUInt16BE(0) << 4;
        break;
      case IHexRecordType.StartSegmentAddress:
      case IHexRecordType.StartLinearAddress:
        // Entry-point records; ignored for buffer loading.
        break;
      default:
        throw new Error(`Unknown Intel HEX record type 0x${r.type.toString(16).padStart(2, '0')}`);
    }
  }
  return highWaterMark;
}

/** Convenience: parse an Intel HEX file and apply it directly to a Buffer.
 *  Returns the highest byte index written. */
export async function loadFileIntoBuffer(filename: string, buffer: Buffer, opts?: LoadIntoBufferOptions): Promise<number> {
  const records = await parseFile(filename);
  return applyRecordsToBuffer(records, buffer, opts);
}
