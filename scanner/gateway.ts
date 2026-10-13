// Dedicated scanner gateway. Run behind TLS/private ingress; never expose clamd to clients.
// Only the gateway connects to clamd. Documents are processed in memory, never logged.
const secret = Deno.env.get("SCANNER_BEARER_SECRET") ?? "";
const clamdHost = Deno.env.get("CLAMD_HOST") ?? "clamav";
const clamdPort = Number(Deno.env.get("CLAMD_PORT") ?? "3310");
const maxBytes = 20 * 1024 * 1024;
const timeoutMs = 12000;
const maxConcurrent = 2;
let activeScans = 0;
const encoder = new TextEncoder();
const response = (status:number,body:unknown) => Response.json(body,{status,headers:{"cache-control":"no-store"}});
const hex = (data:Uint8Array) => Array.from(data).map(x=>x.toString(16).padStart(2,"0")).join("");
async function scan(bytes:Uint8Array, signal:AbortSignal):Promise<{verdict:"clean"|"malicious"|"indeterminate";engine:string}> {
 const socket = await Deno.connect({hostname:clamdHost,port:clamdPort,transport:"tcp"});
 const onAbort = () => { try { socket.close(); } catch { /* closed */ } };
 signal.addEventListener("abort",onAbort,{once:true});
 try {
  const writer = socket.writable.getWriter();
  const header = encoder.encode("zINSTREAM\0");
  await writer.write(header);
  for(let offset=0;offset<bytes.length;offset+=65536){
   const chunk=bytes.subarray(offset,Math.min(offset+65536,bytes.length));
   const frame=new Uint8Array(4+chunk.length);
   new DataView(frame.buffer).setUint32(0,chunk.length,false);
   frame.set(chunk,4);
   await writer.write(frame);
  }
  await writer.write(new Uint8Array(4));
  writer.releaseLock();
  const reader=socket.readable.getReader();
  let message="";
  while(message.length<4096){
   const {value,done}=await reader.read();
   if(done)break;
   message+=new TextDecoder().decode(value);
   if(message.includes("\0")||message.includes("\n"))break;
  }
  reader.releaseLock();
  if(message.trim().startsWith("stream: ") && message.trim().endsWith(" FOUND"))return {verdict:"malicious",engine:"clamav"};
  if(message.trim()==="stream: OK")return {verdict:"clean",engine:"clamav"};
  return {verdict:"indeterminate",engine:"clamav"};
 } finally { signal.removeEventListener("abort",onAbort); try{socket.close()}catch{ /* already closed */ } }
}
if(secret.length<32)throw Error("SCANNER_BEARER_SECRET must be at least 32 characters");
Deno.serve({hostname:"0.0.0.0",port:Number(Deno.env.get("PORT")??"8080")},async req=>{
 if(req.method!=="POST"||new URL(req.url).pathname!=="/scan")return response(404,{error:"not_found"});
 if(req.headers.get("authorization")!==`Bearer ${secret}`)return response(401,{error:"unauthorized"});
 const length=Number(req.headers.get("content-length")??"0");
 if(length>maxBytes)return response(413,{error:"too_large"});
 const expected=req.headers.get("x-content-sha256");
 if(!expected||!/^[0-9a-f]{64}$/.test(expected))return response(400,{error:"digest_required"});
 if(activeScans>=maxConcurrent)return response(503,{error:"scanner_busy"});
 activeScans++;
 try {
  // Enforce the size cap while streaming; Content-Length is never trusted.
  const reader=req.body?.getReader();
  if(!reader)return response(400,{error:"body_unavailable"});
  const chunks:Uint8Array[]=[];
  let total=0;
  const bodyDeadline=AbortSignal.timeout(10000);
  try {
   while(true){
    const part=await Promise.race([
      reader.read(),
      new Promise<never>((_,reject)=>bodyDeadline.addEventListener("abort",()=>reject(Error("body_timeout")),{once:true}))
    ]);
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>maxBytes)return response(413,{error:"too_large"});
    chunks.push(part.value);
   }
  }catch{return response(408,{error:"body_timeout_or_unavailable"})}
  finally {try{await reader.cancel()}catch{/* reader closed */}}
  if(total===0)return response(400,{error:"empty_body"});
  const bytes=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const digest=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)));
  if(digest!==expected)return response(422,{error:"digest_mismatch"});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const result=await scan(bytes,controller.signal);
   if(controller.signal.aborted)return response(503,{error:"scanner_timeout"});
   return response(200,{...result,sha256:digest});
  }catch{return response(503,{error:"scanner_unavailable"})}
  finally {clearTimeout(timer);controller.abort()}
 }finally{activeScans--;}

});
