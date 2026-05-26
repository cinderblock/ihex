# ihex

Parse Intel HEX files and load them into a `Buffer`.

- Zero runtime dependencies (drops the abandoned `line-reader`).
- ESM, with full TypeScript declarations.
- Handles all standard record types (data, EOF, ESA, ELA, start-segment, start-linear).
- Throws on malformed lines, checksum failures, and bounds violations (configurable).

## Install

```sh
npm install ihex
```

## Quick start

```ts
import { parseFile, applyRecordsToBuffer, loadFileIntoBuffer } from 'ihex';

// One-liner: parse a .hex and write it into a Buffer.
const buf = Buffer.alloc(64 * 1024);
const highWaterMark = await loadFileIntoBuffer('firmware.hex', buf);
console.log(`Wrote ${highWaterMark} bytes`);

// Or operate on records directly.
const records = await parseFile('firmware.hex');
for (const r of records) {
  // r.byteCount, r.address, r.type, r.data
}
applyRecordsToBuffer(records, buf);
```

## API

### `parseFile(filename): Promise<IHexRecord[]>`
Read a HEX file from disk and parse its records.

### `parseString(content): IHexRecord[]`
Parse HEX content from a `string` or `Buffer`. Blank lines are skipped.

### `parseLine(line, lineNumber?): IHexRecord`
Parse a single trimmed HEX line. Throws an `IHexParseError` on bad input.

### `applyRecordsToBuffer(records, buffer, opts?): number`
Apply parsed records to a `Buffer`, honoring `ExtendedLinearAddress` and
`ExtendedSegmentAddress` records. Stops at the first `EndOfFile` record by
default. Returns the highest byte offset written.

Options:
- `stopAtEOF` (default `true`): stop processing at the EOF record.
- `strictBounds` (default `true`): throw if a data record would write past the
  buffer; when `false`, the offending bytes are silently truncated.

### `loadFileIntoBuffer(filename, buffer, opts?): Promise<number>`
Convenience: `parseFile` + `applyRecordsToBuffer` in one call.

### `IHexRecordType`
Enum-like object: `Data`, `EndOfFile`, `ExtendedSegmentAddress`,
`StartSegmentAddress`, `ExtendedLinearAddress`, `StartLinearAddress`.

### `IHexParseError`
Subclass of `Error` carrying `lineNumber` and `line` fields.

## Migrating from 0.x

The 0.x API was a single callback-style function:

```js
const ihex = require('ihex');
ihex('firmware.hex', buf, () => { /* done */ });
```

In 1.0:

```ts
import { loadFileIntoBuffer } from 'ihex';
await loadFileIntoBuffer('firmware.hex', buf);
```

Beyond the surface change, 1.0 also fixes several bugs in the original:
- Uses `Buffer.from()` instead of the deprecated and unsafe `new Buffer()`.
- Honors `ExtendedLinearAddress` records, so files larger than 64 KB load
  to the correct addresses (the 0.x code silently ignored them).
- Throws on malformed lines and checksum failures instead of `console.log`-ing
  and continuing.
- Stops at the `EndOfFile` record instead of silently mishandling it.

## Requirements

- Node.js >= 22.

## License

ISC.
