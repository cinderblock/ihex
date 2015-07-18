#iHex file reader

Read an Intel Hex `.hex` file into an existing buffer.

## Install

`npm install --save -q ihex`

## Use

```
var ihex = require('ihex');

var buff = new Buffer(32*1024);
buff.fill(0xff);
ihex('/path/to/file.ihex', buff, function() {
 // All done!
 console.log(buff);
});
```
