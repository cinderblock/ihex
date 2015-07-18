
var lineReader = require('line-reader');



module.exports = function(filename, buffer, callback) {
 this.lineNumber = 0;
 var self = this;
 this.parseLine = function(line) {
  self.lineNumber++;
  line = line.trim();

  var data = line.match(/^:(([0-9a-fA-F]{2}){5,})$/);

  if (!data) {
   console.log("Can't parse line " + self.lineNumber + ': "' + line + '"')
   return;
  }

  var bytes = new Buffer(data[1], 'hex');

  var count = bytes[0];
  var address = bytes.readUInt16BE(1);
  var type = bytes[3];

  if (bytes.length - 5 != count) {
   console.log('Line ' + self.lineNumber + ' wrong data length');
   return;
  }

  var sum = 0;

  for (var i = 0; i < bytes.length; i++)
   sum += bytes[i];

  if (sum % 256 != 0) {
   console.log('Line ' + self.lineNumber + ' checksum error');
   return;
  }

  bytes.copy(buffer, address, 4, 4 + count);

 }

 lineReader.eachLine(filename, this.parseLine).then(callback);
}
