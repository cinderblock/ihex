import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseLine,
  parseString,
  parseFile,
  applyRecordsToBuffer,
  loadFileIntoBuffer,
  IHexRecordType,
  IHexParseError,
} from './ihex.js';

const SAMPLE_HEX = ':1000000048656C6C6F2C20576F726C642100000087\n:00000001FF\n';

describe('parseLine', () => {
  it('parses a valid data record', () => {
    const r = parseLine(':1000000048656C6C6F2C20576F726C642100000087');
    assert.equal(r.byteCount, 16);
    assert.equal(r.address, 0);
    assert.equal(r.type, IHexRecordType.Data);
    assert.equal(r.data.toString('utf8', 0, 13), 'Hello, World!');
    assert.equal(r.data.length, 16);
  });

  it('parses an EOF record', () => {
    const r = parseLine(':00000001FF');
    assert.equal(r.type, IHexRecordType.EndOfFile);
    assert.equal(r.byteCount, 0);
    assert.equal(r.data.length, 0);
  });

  it('parses an Extended Linear Address record', () => {
    const r = parseLine(':020000040001F9');
    assert.equal(r.type, IHexRecordType.ExtendedLinearAddress);
    assert.deepEqual([...r.data], [0x00, 0x01]);
  });

  it('rejects lines without leading colon', () => {
    assert.throws(() => parseLine('1000000048656C6C6F2C20576F726C642100000087'), IHexParseError);
  });

  it('rejects non-hex characters', () => {
    assert.throws(() => parseLine(':XXXX0001FF'), IHexParseError);
  });

  it('rejects odd hex-digit count', () => {
    assert.throws(() => parseLine(':00000001F'), IHexParseError);
  });

  it('rejects a bad checksum', () => {
    // Flip the last byte of the EOF checksum: FF -> FE.
    assert.throws(() => parseLine(':00000001FE'), IHexParseError);
  });

  it('rejects a byte-count mismatch', () => {
    // Header says 0x10 bytes but only 1 data byte is supplied.
    assert.throws(() => parseLine(':1000000048B7'), IHexParseError);
  });

  it('exposes lineNumber and line on the error', () => {
    try {
      parseLine('nope', 42);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof IHexParseError);
      assert.equal(err.lineNumber, 42);
      assert.equal(err.line, 'nope');
    }
  });
});

describe('parseString', () => {
  it('parses multiple records', () => {
    const records = parseString(SAMPLE_HEX);
    assert.equal(records.length, 2);
    assert.equal(records[0].type, IHexRecordType.Data);
    assert.equal(records[1].type, IHexRecordType.EndOfFile);
  });

  it('skips blank lines and trims whitespace', () => {
    const records = parseString('\n  :00000001FF  \n\n');
    assert.equal(records.length, 1);
    assert.equal(records[0].type, IHexRecordType.EndOfFile);
  });

  it('accepts a Buffer input', () => {
    const records = parseString(Buffer.from(':00000001FF\n', 'utf8'));
    assert.equal(records.length, 1);
  });

  it('reports the source line number in errors', () => {
    try {
      parseString(':00000001FF\nnope');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof IHexParseError);
      assert.equal(err.lineNumber, 2);
    }
  });
});

describe('parseFile', () => {
  it('reads a HEX file from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ihex-test-'));
    try {
      const path = join(dir, 'sample.hex');
      await writeFile(path, SAMPLE_HEX);
      const records = await parseFile(path);
      assert.equal(records.length, 2);
      assert.equal(records[0].type, IHexRecordType.Data);
      assert.equal(records[1].type, IHexRecordType.EndOfFile);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('applyRecordsToBuffer', () => {
  it('writes data records into the buffer at the right address', () => {
    const buf = Buffer.alloc(64);
    const records = parseString(SAMPLE_HEX);
    const high = applyRecordsToBuffer(records, buf);
    assert.equal(high, 16);
    assert.equal(buf.toString('utf8', 0, 13), 'Hello, World!');
    // Beyond the data, the buffer is still zeros from alloc().
    assert.equal(buf[16], 0);
  });

  it('stops at EOF by default', () => {
    // Put a data record AFTER the EOF; it should not be applied.
    const buf = Buffer.alloc(64);
    const records = parseString(':00000001FF\n:1000000048656C6C6F2C20576F726C642100000087');
    applyRecordsToBuffer(records, buf);
    assert.equal(buf[0], 0); // Hello not written
  });

  it('continues past EOF when stopAtEOF is false', () => {
    const buf = Buffer.alloc(64);
    const records = parseString(':00000001FF\n:1000000048656C6C6F2C20576F726C642100000087');
    applyRecordsToBuffer(records, buf, { stopAtEOF: false });
    assert.equal(buf.toString('utf8', 0, 5), 'Hello');
  });

  it('throws when a record would write past the end of the buffer', () => {
    const buf = Buffer.alloc(8);
    const records = parseString(':1000000048656C6C6F2C20576F726C642100000087');
    assert.throws(() => applyRecordsToBuffer(records, buf), RangeError);
  });

  it('silently truncates when strictBounds is false', () => {
    const buf = Buffer.alloc(8);
    const records = parseString(':1000000048656C6C6F2C20576F726C642100000087');
    const high = applyRecordsToBuffer(records, buf, { strictBounds: false });
    assert.equal(high, 8);
    assert.equal(buf.toString('utf8', 0, 8), 'Hello, W');
  });

  it('honors Extended Linear Address', () => {
    // ELA sets upper 16 bits, so a subsequent address-0 data record writes high.
    // ":04 0000 00 48656C6C 77" — 4 bytes "Hell" at address 0 (under ELA 0x0001).
    const buf = Buffer.alloc(0x10010);
    const records = parseString(':020000040001F9\n:0400000048656C6C77\n:00000001FF');
    const high = applyRecordsToBuffer(records, buf);
    assert.equal(high, 0x10004);
    assert.equal(buf.toString('utf8', 0x10000, 0x10004), 'Hell');
    // Address 0 should still be empty.
    assert.equal(buf[0], 0);
  });

  it('rejects unknown record types', () => {
    // Type 0x99: bytes 00 00 00 99 -> sum 0x99 -> checksum 0x67.
    const records = parseString(':0000009967');
    const buf = Buffer.alloc(16);
    assert.throws(() => applyRecordsToBuffer(records, buf), /Unknown Intel HEX record type/);
  });
});

describe('loadFileIntoBuffer', () => {
  it('reads and applies in one call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ihex-test-'));
    try {
      const path = join(dir, 'sample.hex');
      await writeFile(path, SAMPLE_HEX);
      const buf = Buffer.alloc(64);
      const high = await loadFileIntoBuffer(path, buf);
      assert.equal(high, 16);
      assert.equal(buf.toString('utf8', 0, 13), 'Hello, World!');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
