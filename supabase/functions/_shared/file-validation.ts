/** Bounded structural checks; no decompression or embedded content execution. */
export const MAX_DOCUMENT_BYTES = 20_971_520;
const ascii = (b: Uint8Array) => new TextDecoder("ascii").decode(b);
const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) => (b[p] + b[p+1]*256 + b[p+2]*65536 + b[p+3]*16777216) >>> 0;

export function validatePdf(b: Uint8Array): boolean {
  if (b.length < 16 || b.length > MAX_DOCUMENT_BYTES || ascii(b.subarray(0,5)) !== "%PDF-") return false;
  const end = ascii(b.subarray(Math.max(0,b.length-2048)));
  if (!end.includes("%%EOF") || !/%%EOF\s*$/.test(end)) return false;
  // Conservative defense-in-depth: reject recognizable active PDF features.
  // This does not inspect compressed streams or certify malware safety.
  const source = ascii(b);
  // PDF names permit #hh hex escapes, e.g. /J#61vaScript. Normalize before matching.
  const decodedNames = source.replace(/\/([A-Za-z0-9#]+)/g, (_match, raw: string) => "/" + raw.replace(/#([0-9a-fA-F]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16))));
  if (/\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia|XFA|AcroForm)(?![A-Za-z0-9])/i.test(decodedNames)) return false;
  return true;
}
/** Reject ZIP64, encryption, traversal, duplicates, macros and oversized ZIP entries. */
export function validateDocx(b: Uint8Array): boolean {
  if (b.length < 100 || b.length > MAX_DOCUMENT_BYTES) return false;
  const start = Math.max(0,b.length-65557);
  let eocd = -1;
  for(let i=b.length-22;i>=start;i--) {
    if (u32(b,i)===0x06054b50 && i+22+u16(b,i+20)===b.length) {eocd=i;break;}
  }
  if(eocd<0 || u16(b,eocd+4)!==0 || u16(b,eocd+6)!==0) return false;
  const count=u16(b,eocd+10), centralSize=u32(b,eocd+12), offset=u32(b,eocd+16);
  if(count<3 || count>1000 || centralSize>2_000_000 || offset+centralSize!==eocd) return false;
  const names=new Set<string>(); let pos=offset; let total=0; const ranges:Array<[number,number]>=[];
  for(let i=0;i<count;i++) {
    if(pos+46>eocd || u32(b,pos)!==0x02014b50) return false;
    const flags=u16(b,pos+8), method=u16(b,pos+10), compressed=u32(b,pos+20), expanded=u32(b,pos+24);
    const nameLen=u16(b,pos+28), extra=u16(b,pos+30), comment=u16(b,pos+32);
    const local=u32(b,pos+42), end=pos+46+nameLen+extra+comment;
    if(end>eocd || !nameLen || (flags&1)!==0 || (method!==0 && method!==8) ||
      compressed===0xffffffff || expanded===0xffffffff || local===0xffffffff ||
      expanded>10_000_000 || (compressed===0 && expanded>0) ||
      (compressed>0 && expanded/compressed>100)) return false;
    total+=expanded;
    if(total>40_000_000) return false;
    const name=ascii(b.subarray(pos+46,pos+46+nameLen));
    if(names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") ||
       /(?:^|\/)vbaProject\.bin$/i.test(name) || /(?:^|\/)embeddings\//i.test(name)) return false;
    names.add(name);
    if(local+30>offset || u32(b,local)!==0x04034b50) return false;
    const dataStart=local+30+u16(b,local+26)+u16(b,local+28);
    if(dataStart+compressed>offset || dataStart>offset) return false;
    if(u16(b,local+6)!==flags || u16(b,local+8)!==method || u16(b,local+26)!==nameLen) return false;
    if(!b.subarray(local+30,local+30+nameLen).every((v,j)=>v===b[pos+46+j])) return false;
    if(method===0 && compressed!==expanded) return false;
    ranges.push([local,dataStart+compressed]);
    pos=end;
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<ranges.length;i++) if(ranges[i][0]<ranges[i-1][1]) return false;
  return pos===eocd && names.has("[Content_Types].xml") && names.has("_rels/.rels") &&
    names.has("word/document.xml") && !names.has("word/vbaProject.bin");
}
