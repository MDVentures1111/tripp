// Integration probe against the real clamd gateway, not the simulated scanner.
const endpoint=Deno.env.get("SCANNER_TEST_URL")??"http://127.0.0.1:8081/scan";
const secret=Deno.env.get("SCANNER_BEARER_SECRET")??"";
if(secret.length<32)throw Error("Missing test scanner secret");
const encode=(s:string)=>new TextEncoder().encode(s);
const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
async function probe(bytes:Uint8Array,expected:string){
 const digest=await sha(bytes);
 const res=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${secret}`,"content-type":"application/pdf","x-content-sha256":digest},body:new Uint8Array(bytes)});
 const body=await res.json();
 if(res.status!==200||body.verdict!==expected||body.sha256!==digest)throw Error(`Expected ${expected}, received ${res.status}: ${JSON.stringify(body)}`);
}
const clean=encode("%PDF-1.4\n1 0 obj\n%%EOF\n");
if(Deno.env.get("SCANNER_TEST_OUTAGE")!=="true") await probe(clean,"clean");
// EICAR is a standardized benign antivirus test signature, not actual malware.
const eicar=encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
if(Deno.env.get("SCANNER_TEST_OUTAGE")!=="true") await probe(eicar,"malicious");
const unauth=await fetch(endpoint,{method:"POST",body:clean});
if(unauth.status!==401)throw Error("Unauthenticated scanner request accepted");
const mismatch=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${secret}`,"x-content-sha256":"0".repeat(64)},body:clean});
if(mismatch.status!==422)throw Error("Digest mismatch accepted");
console.log("Real ClamAV gateway: clean, EICAR, authorization, and digest checks passed");

if(Deno.env.get("SCANNER_TEST_OUTAGE")==="true"){
 const digest=await sha(clean);
 const res=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${secret}`,"x-content-sha256":digest},body:new Uint8Array(clean)});
 if(res.status!==503)throw Error(`Scanner outage must fail closed with 503, got ${res.status}`);
 console.log("Real ClamAV gateway outage fails closed");
}
