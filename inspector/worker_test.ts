import { inspectBoundedDocument } from "./worker.ts";
const assert=(condition:boolean,message:string)=>{if(!condition)throw Error(message)};
Deno.test("inspector rejects unsupported formats",()=>{
 assert(inspectBoundedDocument(new Uint8Array([1,2,3]),"image/png")==="unsafe","unsupported MIME");
 assert(inspectBoundedDocument(new Uint8Array(), "application/pdf")==="unsafe","empty");
});
Deno.test("inspector refuses to clear superficial PDF header",()=>{
 const b=new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
 assert(inspectBoundedDocument(b,"application/pdf")!=="safe","PDF superficial");
});
Deno.test("inspector rejects active PDF actions",()=>{
 const b=new TextEncoder().encode("%PDF-1.4\n1 0 obj << /OpenAction 2 0 R >> endobj\n%%EOF");
 assert(inspectBoundedDocument(b,"application/pdf")==="unsafe","PDF active action");
});
Deno.test("inspector rejects invalid DOCX archive",()=>{
 const b=new Uint8Array(128);b.set([0x50,0x4b,3,4]);
 assert(inspectBoundedDocument(b,"application/vnd.openxmlformats-officedocument.wordprocessingml.document")==="unsafe","ZIP invalid");
});
