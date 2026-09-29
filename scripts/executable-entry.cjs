const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { getAsset, isSea } = require('node:sea');

if (isSea()) {
    const nativeBinary = Buffer.from(getAsset('turso.node'));
    const fingerprint = createHash('sha256').update(nativeBinary).digest('hex');
    const directory = path.join(tmpdir(), 'collection-zarplata', fingerprint);
    const nativePath = path.join(directory, 'turso.win32-x64-msvc.node');
    mkdirSync(directory, { recursive: true });
    if (!existsSync(nativePath)
        || createHash('sha256').update(readFileSync(nativePath)).digest('hex') !== fingerprint) {
        writeFileSync(nativePath, nativeBinary);
    }
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
}

require('../dist/server/main.js');
