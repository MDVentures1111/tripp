/** B4-B.6 inspection HTTP gateway.
 * Security boundary: deploy only behind private TLS ingress in a restricted
 * container (nonroot, read-only filesystem, no outbound network, seccomp,
 * memory/CPU/pid limits). Deno permissions alone are not a sandbox.
 * The conservative worker does not yet certify any document as safe.
 */
import { inspectBoundedDocument } from "./worker.ts";
const secret=Deno.env.get("INSPECTOR_BEARER_SECRET")??"";
if(secret.length<32)throw Error("INSPECTOR_BEARER_SECRET must be at least 32 characters");
const maxBytes=20*1024*1024;
const allowed=new Set(["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const response=(status:number,data:unknown)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});
const hex=(data:Uint8Array)=>Array.from(data,x=>x.toString(16).padStart(2,"0")).join("");
let active=0;
Deno.serve({hostname:Deno.env.get("INSPECTOR_HOST")??"127.0.0.1",port:Number(Deno.env.get("INSPECTOR_PORT")??"8090")},async(req)=>{
 if(req.method!=="POST"||new URL(req.url).pathname!=="/inspect")return response(404,{error:"not_found"});
 if(req.headers.get("authorization")!==`Bearer ${secret}`)return response(401,{error:"unauthorized"});
 const mime=req.headers.get("content-type")??"";
 if(!allowed.has(mime))return response(415,{error:"unsupported_media_type"});
 const expected=req.headers.get("x-content-sha256");
 if(!expected||!/^[a-f0-9]{64}$/.test(expected))return response(400,{error:"invalid_digest"});
 const length=Number(req.headers.get("content-length")??"0");
 if(!Number.isFinite(length)||length>maxBytes)return response(413,{error:"too_large"});
 if(active>=2)return response(503,{error:"busy"});
 active++;
 try {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  let bytes:Uint8Array;
  try {
   if(!req.body)return response(400,{error:"empty"});
   const reader=req.body.getReader();
   const chunks:Uint8Array[]=[];let size=0;
   try {
    while(true){
     const part=await Promise.race([reader.read(),new Promise<never>((_,reject)=>controller.signal.addEventListener("abort",()=>reject(Error("timeout")),{once:true}))]);
     if(part.done)break;
     size+=part.value.length;
     if(size>maxBytes){controller.abort();return response(413,{error:"too_large"});}
     chunks.push(part.value);
    }
   }finally{reader.releaseLock();}
   if(!size)return response(400,{error:"empty"});
   bytes=new Uint8Array(size);let p=0;for(const chunk of chunks){bytes.set(chunk,p);p+=chunk.length;}
  }catch{return response(408,{error:"body_timeout"});}
  finally{clearTimeout(timer);}
  const digest=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)));
  if(digest!==expected)return response(422,{error:"digest_mismatch"});
  const verdict=inspectBoundedDocument(bytes,mime);
  return response(200,{verdict,sha256:digest,engine:"tripp-conservative-inspector",policyVersion:"b4b6-restrictive-v1"});
 }finally{active--;}
});
