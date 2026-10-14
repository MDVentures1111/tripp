/** Strict, fail-closed document inspector core.
 * Run in an OS-isolated worker without network, filesystem or subprocess access.
 * This is a deliberately narrow policy: unsupported features are indeterminate.
 */
import { validatePdf, validateDocx } from "../supabase/functions/_shared/file-validation.ts";
export type WorkerVerdict = "safe" | "unsafe" | "indeterminate";
const decoder = new TextDecoder();
const forbiddenXml = /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\?mso-application/i;
const forbiddenRel = /TargetMode\s*=\s*["']External["']|(?:https?:|file:|javascript:)/i;
const forbiddenPdf = /\/(?:JS|JavaScript|AA|OpenAction|Launch|EmbeddedFile|RichMedia|XFA|AcroForm|ObjStm|Encrypt)(?![A-Za-z0-9])/i;
const u16=(b:Uint8Array,p:number)=>b[p]+b[p+1]*256;
const u32=(b:Uint8Array,p:number)=>((b[p]+b[p+1]*256+b[p+2]*65536+b[p+3]*16777216)>>>0);
function pdf(b:Uint8Array):WorkerVerdict {
 if(!validatePdf(b)) return "unsafe";
 const s=decoder.decode(b);
 if(forbiddenPdf.test(s)) return "unsafe";
 // Only certify a tightly bounded plain-text PDF subset; compressed streams,
 // incremental revisions and complex cross-reference structures are not cleared.
 if(/\/Filter\b|\/XRef\b|\/Type\s*\/XRef|\/Prev\b|\/Linearized\b|\/Encrypt\b/i.test(s)) return "indeterminate";
 if((s.match(/%%EOF/g)||[]).length!==1 || (s.match(/startxref/g)||[]).length!==1) return "indeterminate";
 const match=/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s);
 if(!match) return "indeterminate";
 const offset=Number(match[1]);
 if(!Number.isSafeInteger(offset)||offset<0||offset>=b.length||s.slice(offset,offset+5)!=="xref\n") return "indeterminate";
 if(!/trailer\s*<<[\s\S]{0,4096}\/Root\s+\d+\s+\d+\s+R[\s\S]{0,4096}>>\s*startxref/.test(s)) return "indeterminate";
 // A real parser must resolve every indirect object, stream and reference before
 // issuing clearance. This subset is therefore still indeterminate.
 return "indeterminate";
}
function docx(b:Uint8Array):WorkerVerdict {
 if(!validateDocx(b)) return "unsafe";
 let e=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(u32(b,i)===0x06054b50&&i+22+u16(b,i+20)===b.length){e=i;break;}
 if(e<0)return "unsafe";
 let p=u32(b,e+16);
 const count=u16(b,e+10);
 let sawContent=false,sawDocument=false,sawRels=false;
 for(let i=0;i<count;i++){
  if(p+46>e||u32(b,p)!==0x02014b50)return "unsafe";
  const method=u16(b,p+10),compressed=u32(b,p+20),expanded=u32(b,p+24);
  const n=u16(b,p+28),extra=u16(b,p+30),comment=u16(b,p+32);
  const name=decoder.decode(b.subarray(p+46,p+46+n));
  const local=u32(b,p+42);
  const dataStart=local+30+u16(b,local+26)+u16(b,local+28);
  if(method!==0)return "indeterminate"; // Deflate needs a bounded decompressor.
  if(compressed!==expanded||expanded>2_000_000)return "indeterminate";
  const xml=decoder.decode(b.subarray(dataStart,dataStart+compressed));
  if(name.endsWith(".xml")||name.endsWith(".rels")){
   if(forbiddenXml.test(xml)||forbiddenRel.test(xml))return "unsafe";
   if(!xml.trimStart().startsWith("<?xml")&&!xml.trimStart().startsWith("<"))return "indeterminate";
  }
  if(name==="[Content_Types].xml")sawContent=xml.includes("wordprocessingml.document.main+xml");
  if(name==="word/document.xml")sawDocument=xml.includes("wordprocessingml/2006/main");
  if(name==="_rels/.rels")sawRels=xml.includes("officeDocument");
  p+=46+n+extra+comment;
 }
 // XML/OPC schema, namespace, relationship and signature checks are not yet
 // exhaustive. Do not issue a safe verdict from structural validation alone.
 return sawContent&&sawDocument&&sawRels?"indeterminate":"unsafe";
}
export function inspectBoundedDocument(bytes:Uint8Array,mime:string):WorkerVerdict {
 if(!bytes.length||bytes.length>20_971_520)return "unsafe";
 if(mime==="application/pdf")return pdf(bytes);
 if(mime==="application/vnd.openxmlformats-officedocument.wordprocessingml.document")return docx(bytes);
 return "unsafe";
}
