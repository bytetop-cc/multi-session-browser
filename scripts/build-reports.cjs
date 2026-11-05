const esbuild = require('esbuild');
esbuild.buildSync({entryPoints:['renderer/pages.jsx'],bundle:true,minify:true,sourcemap:false,outdir:'report-assets',entryNames:'pages',format:'iife',platform:'browser',target:['chrome130'],define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
const fs = require('node:fs');
const licensePath = 'report-assets/pages.js.LEGAL.txt';
if (fs.existsSync(licensePath)) fs.writeFileSync(licensePath, fs.readFileSync(licensePath, 'utf8').split('\n').map(line => line.trimEnd()).join('\n'));
console.log('Report UI built in report-assets/');
