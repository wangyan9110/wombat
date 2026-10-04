import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {checkWindowsImports} from './native-binary.ts';
test('Windows release imports reject compiler DLLs and malformed PE images',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'wombat-pe-')),file=path.join(root,'synthetic.exe');
 const image=Buffer.alloc(1024);image.writeUInt16LE(0x5a4d);image.writeUInt32LE(64,0x3c);image.writeUInt32LE(0x4550,64);image.writeUInt16LE(0x8664,68);image.writeUInt16LE(1,70);image.writeUInt16LE(240,84);image.writeUInt16LE(0x20b,88);image.writeUInt32LE(16,196);
 image.writeUInt32LE(0x1000,208);image.writeUInt32LE(40,212);image.writeUInt32LE(0x1000,340);image.writeUInt32LE(512,344);image.writeUInt32LE(512,348);image.writeUInt32LE(0x1040,524);
 try {
  for(const name of ['KERNEL32.dll','api-ms-win-crt-runtime-l1-1-0.dll','VCRUNTIME140.dll','MSVCP140.dll']) {
   image.fill(0,576);image.write(name,576);writeFileSync(file,image);
   if(/VCRUNTIME|MSVCP/.test(name))assert.throws(()=>checkWindowsImports(file),/compiler runtime/);else checkWindowsImports(file);
  }
  writeFileSync(file,image.subarray(0,100));assert.throws(()=>checkWindowsImports(file),/Invalid Windows/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
