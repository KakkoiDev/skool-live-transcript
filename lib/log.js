const fs = require('fs');

let logStream = null;

function init(filePath) {
  logStream = fs.createWriteStream(filePath, { flags: 'a' });
}

function ts() {
  return new Date().toISOString();
}

function info(...args) {
  const line = `${ts()} ${args.join(' ')}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

function error(...args) {
  const line = `${ts()} ERROR ${args.join(' ')}`;
  console.error(line);
  if (logStream) logStream.write(line + '\n');
}

function close() {
  if (logStream) logStream.end();
}

module.exports = { init, info, error, close };
