import { inspectBoundedDocument, canonicalBlankPdf } from "./worker.ts";
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

Deno.test("canonical blank PDF profile clears only exact vetted bytes",()=>{
 const mime="application/pdf";
 const good=canonicalBlankPdf();
 assert(inspectBoundedDocument(good,mime)==="safe","canonical profile should clear");
 const altered=new Uint8Array(good);
 altered[altered.length-2]=0x20;
 assert(inspectBoundedDocument(altered,mime)!=="safe","mutated PDF must not clear");
 const active=new TextEncoder().encode(new TextDecoder().decode(good).replace("/Catalog","/Catalog /OpenAction 2 0 R"));
 assert(inspectBoundedDocument(active,mime)!=="safe","active PDF must not clear");
 const appended=new Uint8Array(good.length+9);
 appended.set(good);appended.set(new TextEncoder().encode("garbage!!"),good.length);
 assert(inspectBoundedDocument(appended,mime)!=="safe","appended data must not clear");
});
