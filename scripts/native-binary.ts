import {readFileSync} from 'node:fs';

/** Reject redistributable/compiler DLL imports: Windows cores must use the static CRT. */
export function checkWindowsImports(file: string): void {
  const data = readFileSync(file);
  const fail = () => {throw new Error('Invalid Windows PE image: '+file);};
  const span = (offset: number,length: number) => {if (!Number.isSafeInteger(offset)||offset<0||offset+length>data.length) fail();};
  span(0,64);if(data.readUInt16LE(0)!==0x5a4d)fail();
  const pe=data.readUInt32LE(0x3c);span(pe,24);if(data.readUInt32LE(pe)!==0x4550)fail();
  if(data.readUInt16LE(pe+4)!==0x8664)fail();
  const count=data.readUInt16LE(pe+6),size=data.readUInt16LE(pe+20),optional=pe+24;
  span(optional,size);if(size<224||data.readUInt16LE(optional)!==0x20b)fail();
  if(data.readUInt32LE(optional+108)<14)fail();
  if(data.readUInt32LE(optional+216)||data.readUInt32LE(optional+220))throw new Error('Unexpected delayed DLL imports; audit before distribution');
  const sections=optional+size;span(sections,count*40);
  const offsetFor=(rva:number,length:number) => {
    for(let i=0;i<count;i++) {
      const section=sections+i*40,base=data.readUInt32LE(section+12),rawSize=data.readUInt32LE(section+16),raw=data.readUInt32LE(section+20);
      if(rva>=base&&rva-base+length<=rawSize) {const offset=raw+rva-base;span(offset,length);return offset;}
    }
    fail();return 0;
  };
  const imports=data.readUInt32LE(optional+120),importSize=data.readUInt32LE(optional+124);
  if(!imports&&!importSize)return;
  if(!imports||importSize<20||importSize>1024*1024)fail();
  const start=offsetFor(imports,importSize);let ended=false;
  for(let i=0;i+20<=importSize;i+=20) {
    const descriptor=start+i;
    if(data.subarray(descriptor,descriptor+20).every(byte=>byte===0)) {ended=true;break;}
    const nameRva=data.readUInt32LE(descriptor+12);let name='',terminated=false;
    for(let j=0;j<256;j++) {const byte=data[offsetFor(nameRva+j,1)];if(byte===0){terminated=true;break;}name+=String.fromCharCode(byte);}
    if(!terminated||!/^[\w.-]+\.dll$/i.test(name))fail();
    if(/^(?:vcruntime|msvcp|msvcr|concrt|ucrtbased)/i.test(name))throw new Error('Windows core requires an external compiler runtime: '+name);
  }
  if(!ended)fail();
}
