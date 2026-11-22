'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'onreza-output');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

fs.copyFileSync(path.join(root, 'server.js'), path.join(output, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(output, 'package.json'));
fs.cpSync(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });

console.log('ONREZA output prepared:', output);
