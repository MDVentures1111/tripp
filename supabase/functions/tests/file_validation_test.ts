import { validatePdf, validateDocx } from "../_shared/file-validation.ts";
function check(condition: boolean, label: string) { if (!condition) throw new Error(label); }
Deno.test("PDF requires header and terminal EOF", () => {
  const enc = new TextEncoder();
  check(validatePdf(enc.encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n")), "valid header/EOF rejected");
  check(!validatePdf(enc.encode("not a pdf %%EOF")), "missing header accepted");
  check(!validatePdf(enc.encode("%PDF-1.7\ncontent without trailer")), "missing EOF accepted");
});
Deno.test("DOCX rejects non-ZIP and malformed central directory", () => {
  check(!validateDocx(new Uint8Array(256)), "zero bytes accepted");
  const b = new Uint8Array(256); b[0]=0x50; b[1]=0x4b;
  check(!validateDocx(b), "fake ZIP accepted");
});


Deno.test("DOCX ZIP local header consistency and overlapping entries", () => {
 const names=["[Content_Types].xml","_rels/.rels","word/document.xml"];
 const enc=new TextEncoder();
 const write16=(b:Uint8Array,p:number,n:number)=>{b[p]=n&255;b[p+1]=(n>>>8)&255;};
 const write32=(b:Uint8Array,p:number,n:number)=>{write16(b,p,n&65535);write16(b,p+2,n>>>16);};
 const bytes:number[]=[];const entries:{name:Uint8Array,offset:number}[]=[];
 for(const name of names){
  const n=enc.encode(name),offset=bytes.length;
  const header=new Uint8Array(30+n.length);
  write32(header,0,0x04034b50);write16(header,4,20);write16(header,26,n.length);
  header.set(n,30);bytes.push(...header);entries.push({name:n,offset});
 }
 const centralStart=bytes.length;
 for(const e of entries){
  const header=new Uint8Array(46+e.name.length);
  write32(header,0,0x02014b50);write16(header,4,20);write16(header,6,20);
  write16(header,28,e.name.length);write32(header,42,e.offset);
  header.set(e.name,46);bytes.push(...header);
 }
 const centralSize=bytes.length-centralStart;
 const eocd=new Uint8Array(22);
 write32(eocd,0,0x06054b50);write16(eocd,8,entries.length);write16(eocd,10,entries.length);
 write32(eocd,12,centralSize);write32(eocd,16,centralStart);bytes.push(...eocd);
 const valid=new Uint8Array(bytes);
 check(validateDocx(valid),"Minimal structurally consistent ZIP rejected");
 const mismatch=valid.slice();write16(mismatch,26,1);
 check(!validateDocx(mismatch),"Local filename length mismatch accepted");
 const wrongMethod=valid.slice();write16(wrongMethod,8,8);
 check(!validateDocx(wrongMethod),"Local compression method mismatch accepted");
 const overlap=valid.slice();
 const secondCentral=centralStart+46+entries[0].name.length;
 write32(overlap,secondCentral+42,0);
 check(!validateDocx(overlap),"Overlapping local entries accepted");
 const traversal=valid.slice();
 const firstName=centralStart+46;
 traversal[firstName]=46;traversal[firstName+1]=46;
 check(!validateDocx(traversal),"Unsafe central filename accepted");

 const zip64=valid.slice();write32(zip64,centralStart+20,0xffffffff);
 check(!validateDocx(zip64),"ZIP64 sentinel accepted");
 const encrypted=valid.slice();write16(encrypted,centralStart+8,1);
 check(!validateDocx(encrypted),"Encrypted ZIP entry accepted");
 const expanded=valid.slice();write32(expanded,centralStart+24,10_000_001);
 check(!validateDocx(expanded),"Oversized expanded ZIP entry accepted");
 const bomb=valid.slice();write32(bomb,centralStart+20,1);write32(bomb,centralStart+24,1000);
 check(!validateDocx(bomb),"Excessive compression ratio accepted");
 const offsetAttack=valid.slice();write32(offsetAttack,centralStart+42,0xfffffff0);
 check(!validateDocx(offsetAttack),"Out-of-bounds local header accepted");

});

Deno.test("B4-B.5 PDF adversarial markers and boundary cases", () => {
 const enc=new TextEncoder();
 const wrap=(s:string)=>enc.encode("%PDF-1.7\n1 0 obj\n"+s+"\nendobj\n%%EOF\n");
 for(const marker of ["/JavaScript","/JS","/OpenAction","/AA","/Launch","/EmbeddedFile","/RichMedia","/XFA","/AcroForm"]){
  check(!validatePdf(wrap(marker)),"Active PDF marker accepted: "+marker);
 }
 check(!validatePdf(wrap("safe").subarray(0,18)),"Truncated PDF accepted");
 check(!validatePdf(enc.encode("%PDF-1.7\n1 0 obj\n%%EOF\nTRAILING")),"Trailing PDF bytes accepted");
 const huge=new Uint8Array(20_971_521);huge.set(enc.encode("%PDF-1.7"),0);
 check(!validatePdf(huge),"Oversized PDF accepted");
});

Deno.test("B4-B.5 obfuscated PDF name tokens are rejected", () => {
 const enc=new TextEncoder();
 for(const token of ["/J#61vaScript","/Open#41ction","/Em#62eddedFile","/Laun#63h","/J#53"]){
  const bytes=enc.encode("%PDF-1.7\n1 0 obj\n<< "+token+" 1 >>\nendobj\n%%EOF\n");
  check(!validatePdf(bytes),"Escaped active-content token accepted: "+token);
 }
});
