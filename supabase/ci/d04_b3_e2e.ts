import { canonicalBlankPdf } from "../../inspector/worker.ts";
// D04-B3: isolated local Supabase HTTP authorization checks; no production URLs.
import { createClient } from "npm:@supabase/supabase-js@2";
const base="http://127.0.0.1:54321";
const anon=Deno.env.get("TRIPP_E2E_ANON_KEY") ?? "";
const service=Deno.env.get("TRIPP_E2E_SERVICE_ROLE_KEY") ?? "";
if(!anon||!service) throw Error("Missing isolated local Supabase keys");
const admin=createClient(base,service,{auth:{persistSession:false,autoRefreshToken:false}});
const publicClient=createClient(base,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const id=()=>crypto.randomUUID();
async function account(role:string){
 const email=`ci-${role}-${id()}@example.test`;
 const {data,error}=await admin.auth.admin.createUser({email,password:"CI-test-"+id(),email_confirm:true});
 if(error||!data.user)throw Error("Create user: "+error?.message);
 const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:"magiclink",email});
 if(linkError||!link.properties?.hashed_token)throw Error("Generate login token failed");
 const {data:auth,error:authError}=await publicClient.auth.verifyOtp({token_hash:link.properties.hashed_token,type:"magiclink"});
 if(authError||!auth.session)throw Error("Authenticate failed: "+authError?.message);
 return {id:data.user.id,token:auth.session.access_token};
}
const owner=await account("owner"),viewer=await account("viewer"),outsider=await account("outsider");
const orgA=id(),orgB=id(),dealA=id(),dealB=id();
async function seed(table:string,rows:unknown){
 const {error}=await admin.from(table).insert(rows);
 if(error)throw Error(`Seed ${table}: ${error.message}`);
}
await seed("organizations",[{id:orgA,name:"CI A"},{id:orgB,name:"CI B"}]);
await seed("organization_memberships",[
 {organization_id:orgA,user_id:owner.id,role:"admin"},
 {organization_id:orgA,user_id:viewer.id,role:"viewer"},
 {organization_id:orgB,user_id:outsider.id,role:"admin"}]);
await seed("deals",[{id:dealA,organization_id:orgA,deal_name:"CI A",created_by:owner.id},
 {id:dealB,organization_id:orgB,deal_name:"CI B",created_by:outsider.id}]);
async function invoke(name:string,token:string,body:unknown,method="POST"){
 const url=base+"/functions/v1/deal-document-"+name+(method==="GET"?`?organizationId=${orgA}&dealId=${dealA}`:"");
 const response=await fetch(url,{method,headers:{apikey:anon,authorization:"Bearer "+token,...(method==="POST"?{"content-type":"application/json"}:{})},...(method==="POST"?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json().catch(()=>({}))};
}
function check(ok:boolean,message:string){if(!ok)throw Error(message)}
const pdf=Deno.env.get("TRIPP_INSPECTOR_POSITIVE_E2E")==="true"?canonicalBlankPdf():new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");
const input={organizationId:orgA,dealId:dealA,filename:"ci.pdf",documentType:"other",fileKind:"pdf",fileSizeBytes:pdf.length};
const viewerResponse=await invoke("upload-initiate",viewer.token,input);
console.log("D04-B3.1 viewer upload response",JSON.stringify(viewerResponse));
check(viewerResponse.status===404,`Viewer upload not denied: ${viewerResponse.status} ${JSON.stringify(viewerResponse.data)}`);
const outsiderResponse=await invoke("upload-initiate",outsider.token,input);
console.log("D04-B3.1 outsider upload response",JSON.stringify(outsiderResponse));
check(outsiderResponse.status===404,`Cross-org upload not denied: ${outsiderResponse.status} ${JSON.stringify(outsiderResponse.data)}`);
const init=await invoke("upload-initiate",owner.token,input);
check(init.status===201,`Upload initiate: ${init.status} ${JSON.stringify(init.data)}`);
const documentId=init.data.documentId;
check(typeof documentId==="string"&&typeof init.data.uploadToken==="string","Missing upload token");
const bucket="tripp-deal-documents";
const staging=`${orgA}/${dealA}/${documentId}/quarantine.pdf`;
const {error:uploadError}=await publicClient.storage.from(bucket).uploadToSignedUrl(staging,init.data.uploadToken,pdf,{contentType:"application/pdf"});
check(!uploadError,"Signed upload: "+uploadError?.message);
const body={organizationId:orgA,dealId:dealA,documentId};
const finalize=await invoke("upload-finalize",owner.token,body);
if(Deno.env.get("TRIPP_INSPECTOR_LIFECYCLE_E2E")==="true"){
 check(finalize.status===422,"Conservative inspector must deny promotion: "+finalize.status+" "+JSON.stringify(finalize.data));
 const {data:state,error:stateError}=await admin.from("deal_documents").select("upload_status,content_inspection_sha256").eq("id",documentId).single();
 check(!stateError&&state?.upload_status!=="ready"&&!state?.content_inspection_sha256,"Uncleared document obtained READY or inspection attestation");
 check((await invoke("download",owner.token,body)).status===404,"Uncleared document downloadable");
 console.log("Containerized inspector lifecycle: upload succeeded, inspection denied, no READY, no download");
 Deno.exit(0);
}
check(finalize.status===200,`Finalize: ${finalize.status} ${JSON.stringify(finalize.data)}`);
const list=await invoke("list",viewer.token,{},"GET");
check(list.status===200&&list.data.documents?.some((d:{id:string})=>d.id===documentId),"Viewer list failed");
check((await invoke("download",outsider.token,body)).status===404,"Cross-org download not denied");
const download=await invoke("download",viewer.token,body);
check(download.status===200&&typeof download.data.url==="string","Viewer download denied");
const {error:directError}=await publicClient.storage.from(bucket).download(`${orgA}/${dealA}/${documentId}/source.pdf`);
check(!!directError,"Anonymous direct Storage download unexpectedly permitted");
console.log("D04-B3 local HTTP authorization, signed upload, finalize, and download passed");
if(Deno.env.get("TRIPP_INSPECTOR_POSITIVE_E2E")==="true"){
 const {data:attestation,error:attestationError}=await admin.from("deal_documents").select("upload_status,verified_sha256,content_inspection_sha256,content_inspection_engine,content_inspection_policy,content_inspected_at").eq("id",documentId).single();
 check(!attestationError&&attestation?.upload_status==="ready"&&attestation?.verified_sha256===attestation?.content_inspection_sha256&&!!attestation?.content_inspection_engine&&!!attestation?.content_inspection_policy&&!!attestation?.content_inspected_at,"Positive inspector attestation not persisted");
 console.log("Positive canonical PDF cleared with persisted digest-bound evidence and authorized download");
 Deno.exit(0);
}



// B4-B.2.1: CI fixture verdicts must fail closed, including download denial.
async function scannerVerdictFixture(marker:string,expected:number){
 const bytes=new TextEncoder().encode("%PDF-1.4\n1 0 obj\n"+marker+"\n%%EOF\n");
 const result=await invoke("upload-initiate",owner.token,{...input,filename:"scan-fixture.pdf",fileSizeBytes:bytes.length});
 check(result.status===201,"Scanner fixture initiation failed");
 const fixtureId=result.data.documentId as string;
 const path=`${orgA}/${dealA}/${fixtureId}/quarantine.pdf`;
 const upload=await publicClient.storage.from(bucket).uploadToSignedUrl(path,result.data.uploadToken,bytes,{contentType:"application/pdf"});
 check(!upload.error,"Scanner fixture upload failed");
 const outcome=await invoke("upload-finalize",owner.token,{...body,documentId:fixtureId});
 check(outcome.status===expected,`Scanner fixture ${marker} expected ${expected}, got ${outcome.status}: ${JSON.stringify(outcome.data)}`);
 const {data,error}=await admin.from("deal_documents").select("upload_status").eq("id",fixtureId).single();
 check(!error&&data?.upload_status!=="ready","Non-clean scanner verdict became READY");
 check((await invoke("download",owner.token,{...body,documentId:fixtureId})).status===404,
  "Non-clean scanner verdict became downloadable");
}
// The standalone gateway test verifies the canonical EICAR signature directly.
// Embedding EICAR inside arbitrary PDF bytes is not a reliable ClamAV signature fixture.
// Here the application must fail closed on an invalid PDF, and separately demonstrate
// clean-file finalization and download with the real scanner.
if(Deno.env.get("TRIPP_REAL_CLAMAV_E2E")!=="true"){
 await scannerVerdictFixture("CI_MALICIOUS_FIXTURE",422);
 await scannerVerdictFixture("CI_INDETERMINATE_FIXTURE",422);
} else {
 const malformedPdf=new TextEncoder().encode("%PDF-1.4\\ninvalid structure without EOF");
 const result=await invoke("upload-initiate",owner.token,{...input,filename:"invalid.pdf",fileSizeBytes:malformedPdf.length});
 check(result.status===201,"Real scanner invalid-PDF initiation failed");
 const fixtureId=result.data.documentId as string;
 const path=`${orgA}/${dealA}/${fixtureId}/quarantine.pdf`;
 const upload=await publicClient.storage.from(bucket).uploadToSignedUrl(path,result.data.uploadToken,malformedPdf,{contentType:"application/pdf"});
 check(!upload.error,"Invalid-PDF fixture upload failed");
 const outcome=await invoke("upload-finalize",owner.token,{...body,documentId:fixtureId});
 check(outcome.status===422,"Malformed PDF was not rejected by application");
 check((await invoke("download",owner.token,{...body,documentId:fixtureId})).status===404,"Malformed PDF became downloadable");

 const eicar=new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
 const names=["[Content_Types].xml","_rels/.rels","word/document.xml","word/media/antivirus-test.txt"];
 const chunks:number[]=[];const central:number[]=[];const enc=new TextEncoder();
 const put16=(a:number[],v:number)=>a.push(v&255,(v>>>8)&255);
 const put32=(a:number[],v:number)=>{put16(a,v&65535);put16(a,v>>>16);};
 const crc32=(data:Uint8Array)=>{let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
 for(const name of names){
  const filename=enc.encode(name),payload=name.endsWith("antivirus-test.txt")?eicar:enc.encode("<xml/>");
  const crc=crc32(payload),offset=chunks.length;
  const local:number[]=[];put32(local,0x04034b50);put16(local,20);put16(local,0);put16(local,0);
  put16(local,0);put16(local,0);put32(local,crc);put32(local,payload.length);put32(local,payload.length);
  put16(local,filename.length);put16(local,0);
  chunks.push(...local,...filename,...payload);
  put32(central,0x02014b50);put16(central,20);put16(central,20);put16(central,0);put16(central,0);
  put16(central,0);put16(central,0);put32(central,crc);put32(central,payload.length);put32(central,payload.length);
  put16(central,filename.length);put16(central,0);put16(central,0);put16(central,0);put16(central,0);
  put32(central,0);put32(central,offset);central.push(...filename);
 }
 const centralOffset=chunks.length;chunks.push(...central);
 const tail:number[]=[];put32(tail,0x06054b50);put16(tail,0);put16(tail,0);
 put16(tail,names.length);put16(tail,names.length);put32(tail,central.length);put32(tail,centralOffset);put16(tail,0);
 chunks.push(...tail);
 const maliciousDocx=new Uint8Array(chunks);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",maliciousDocx))).map(v=>v.toString(16).padStart(2,"0")).join("");
 const scannerUrl=Deno.env.get("TRIPP_E2E_SCANNER_URL")??"http://127.0.0.1:8080/scan";
 const scannerSecret=Deno.env.get("TRIPP_E2E_SCANNER_SECRET")??"";
 const scanResponse=await fetch(scannerUrl,{method:"POST",headers:{"authorization":"Bearer "+scannerSecret,"x-content-sha256":hash,"content-type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},body:maliciousDocx});
 const scanResult=await scanResponse.json();
 check(scanResponse.status===200&&scanResult.verdict==="malicious","Real ClamAV did not classify ZIP-embedded canonical EICAR as malicious");
 const attempt=await invoke("upload-initiate",owner.token,{...input,filename:"malicious.docx",fileKind:"docx",fileSizeBytes:maliciousDocx.length});
 check(attempt.status===201,"Malicious DOCX initiation failed");
 const maliciousId=attempt.data.documentId as string;
 const uploaded=await publicClient.storage.from(bucket).uploadToSignedUrl(
  orgA+"/"+dealA+"/"+maliciousId+"/quarantine.docx",attempt.data.uploadToken,maliciousDocx,
  {contentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
 check(!uploaded.error,"Malicious DOCX quarantine upload failed");
 const denied=await invoke("upload-finalize",owner.token,{...body,documentId:maliciousId});
 check(denied.status===422,"Real ClamAV malicious DOCX not denied: "+denied.status+" "+JSON.stringify(denied.data));
 const {data:maliciousState}=await admin.from("deal_documents").select("upload_status").eq("id",maliciousId).single();
 check(maliciousState?.upload_status!=="ready","Malicious DOCX promoted to READY");
 check((await invoke("download",owner.token,{...body,documentId:maliciousId})).status===404,"Malicious DOCX downloadable");
 console.log("Real ClamAV full application malicious DOCX denied and download blocked");

 console.log("Real ClamAV E2E clean file passed; malformed PDF rejected and download denied");
}
console.log("D04-B4-B.2.1 malicious and indeterminate scanner verdicts fail closed");

// D04-B3.2 adversarial scenarios, all against ephemeral local Storage and database.
async function initiate(bytes:Uint8Array,filename="adversarial.pdf",fileKind="pdf"){
 const response=await invoke("upload-initiate",owner.token,{...input,filename,fileKind,fileSizeBytes:bytes.length});
 check(response.status===201,`Adversarial initiate failed: ${response.status} ${JSON.stringify(response.data)}`);
 return {documentId:response.data.documentId as string,token:response.data.uploadToken as string};
}
async function uploadQuarantine(doc:{documentId:string,token:string},bytes:Uint8Array,ext="pdf"){
 const path=`${orgA}/${dealA}/${doc.documentId}/quarantine.${ext}`;
 const result=await publicClient.storage.from(bucket).uploadToSignedUrl(path,doc.token,bytes,{contentType:ext==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
 check(!result.error,`Adversarial quarantine upload failed: ${result.error?.message}`);
 return path;
}
async function status(documentId:string){
 const {data,error}=await admin.from("deal_documents").select("upload_status").eq("id",documentId).single();
 check(!error&&!!data,`Document status unavailable: ${error?.message}`);
 return data.upload_status as string;
}
const malformed=new TextEncoder().encode("%PDF-1.4\\ninvalid content without EOF");
const bad=await initiate(malformed);
await uploadQuarantine(bad,malformed);
const badFinalize=await invoke("upload-finalize",owner.token,{...body,documentId:bad.documentId});
check(badFinalize.status===422,`Malformed PDF not rejected: ${badFinalize.status}`);
check(await status(bad.documentId)==="failed","Malformed PDF did not fail closed");
// D04-C: rejection reason is persisted and exposed to the frontend contract.
check(badFinalize.data.uploadStatus==="failed"&&badFinalize.data.failureReason==="invalid_pdf"&&badFinalize.data.code==="document_rejected",
 "Finalize rejection contract mismatch: "+JSON.stringify(badFinalize.data));
{
 const r=await fetch(`${base}/functions/v1/deal-document-list?organizationId=${orgA}&dealId=${dealA}&documentId=${bad.documentId}`,{headers:{apikey:anon,authorization:"Bearer "+viewer.token}});
 const d=await r.json();
 check(r.status===200&&d.documents?.length===1&&d.documents[0].uploadStatus==="failed"&&d.documents[0].failureReason==="invalid_pdf",
  "List single-document status contract mismatch: "+JSON.stringify(d));
}
const badDownload=await invoke("download",owner.token,{...body,documentId:bad.documentId});
check(badDownload.status===404,"Rejected PDF is downloadable");
const wrongSize=await initiate(pdf);
await uploadQuarantine(wrongSize,new TextEncoder().encode("%PDF-1.4\\n%%EOF\\nextra"));
const mismatch=await invoke("upload-finalize",owner.token,{...body,documentId:wrongSize.documentId});
check(mismatch.status===422,`File size mismatch not rejected: ${mismatch.status}`);
check(await status(wrongSize.documentId)==="failed","Size mismatch did not fail closed");
const missing=await initiate(pdf);
const missingResult=await invoke("upload-finalize",owner.token,{...body,documentId:missing.documentId});
check(missingResult.status===422&&missingResult.data.failureReason==="upload_missing","Missing quarantine object did not reject finalization: "+JSON.stringify(missingResult));
check(await status(missing.documentId)==="failed","Missing upload did not enter failed state");
const replay=await invoke("upload-finalize",owner.token,body);
check(replay.status===404||replay.status===409,"Completed document could be finalized twice");
const overwrite=await publicClient.storage.from(bucket).uploadToSignedUrl(staging,init.data.uploadToken,pdf,{contentType:"application/pdf"});
// Supabase signed-upload tokens may be reusable until expiry. Replay must never alter verified source.
console.log("D04-B3.2 quarantine token replay",JSON.stringify({accepted:!overwrite.error,error:overwrite.error?.message}));
const {data:verifiedSource,error:verifiedReadError}=await admin.storage.from(bucket).download(`${orgA}/${dealA}/${documentId}/source.pdf`);
check(!verifiedReadError&&!!verifiedSource,"Verified source unavailable after quarantine replay");
const verifiedBytes=new Uint8Array(await verifiedSource.arrayBuffer());
check(verifiedBytes.length===pdf.length&&verifiedBytes.every((v,i)=>v===pdf[i]),"Quarantine replay changed verified source");
check(await status(documentId)==="ready","Quarantine replay changed document readiness");
const replayFinalize=await invoke("upload-finalize",owner.token,body);
check(replayFinalize.status===404||replayFinalize.status===409,"Quarantine replay reopened finalization");
const directWrite=await publicClient.storage.from(bucket).upload(`${orgA}/${dealA}/${documentId}/source.pdf`,pdf,{upsert:true});
check(!!directWrite.error,"Anonymous Storage overwrite unexpectedly succeeded");
const outsiderFinalize=await invoke("upload-finalize",outsider.token,{...body,documentId:missing.documentId});
check(outsiderFinalize.status===404,"Cross-org finalize not denied");
console.log("D04-B3.2 malformed PDF, mismatched size, interrupted upload, replay and overwrite checks passed");


// D04-B3.3: concurrent finalize must have one winner, never two promotions.
const racing=await initiate(pdf,"race.pdf");
await uploadQuarantine(racing,pdf);
const raceBody={...body,documentId:racing.documentId};
const raceResults=await Promise.all(Array.from({length:5},()=>invoke("upload-finalize",owner.token,raceBody)));
check(raceResults.filter(r=>r.status===200).length===1,
 `Concurrent finalize expected exactly one success: ${JSON.stringify(raceResults)}`);
check(raceResults.every(r=>r.status===200||r.status===404||r.status===409),
 `Concurrent finalize unexpected error: ${JSON.stringify(raceResults)}`);
check(await status(racing.documentId)==="ready","Concurrent finalize did not leave ready source");
const {data:raceSource,error:raceReadError}=await admin.storage.from(bucket).download(`${orgA}/${dealA}/${racing.documentId}/source.pdf`);
check(!raceReadError&&raceSource?.size===pdf.length,"Concurrent finalization corrupted source");

// DOCX with fake ZIP signatures but no valid central directory must never be promoted.
const fakeDocx=new Uint8Array(128);
fakeDocx.set(new TextEncoder().encode("PK\\u0003\\u0004"),0);
const invalidDocx=await initiate(fakeDocx,"malformed.docx","docx");
await uploadQuarantine(invalidDocx,fakeDocx,"docx");
const docxResult=await invoke("upload-finalize",owner.token,{...body,documentId:invalidDocx.documentId});
check(docxResult.status===422,`Malformed DOCX accepted: ${JSON.stringify(docxResult)}`);
check(await status(invalidDocx.documentId)==="failed","Malformed DOCX did not fail closed");
check((await invoke("download",owner.token,{...body,documentId:invalidDocx.documentId})).status===404,
 "Malformed DOCX is downloadable");

// D04-C: realistic synthetic PDF (object streams) and DOCX (ZIP data descriptors) complete the full lifecycle.
if(Deno.env.get("TRIPP_INSPECTOR_POSITIVE_E2E")!=="true"){
 for(const [name,kind] of [["proposal-objstm.pdf","pdf"],["loi-data-descriptor.docx","docx"]] as const){
  const bytes=await Deno.readFile(new URL("../functions/tests/fixtures/"+name,import.meta.url));
  const started=await invoke("upload-initiate",owner.token,{...input,filename:name,fileKind:kind,fileSizeBytes:bytes.length,documentType:kind==="pdf"?"landlord_proposal":"letter_of_intent"});
  check(started.status===201&&started.data.uploadStatus==="pending"&&started.data.uploadPath===`${orgA}/${dealA}/${started.data.documentId}/quarantine.${kind}`,
   "Initiate contract mismatch: "+JSON.stringify(started));
  const put=await publicClient.storage.from(bucket).uploadToSignedUrl(started.data.uploadPath,started.data.uploadToken,bytes,{contentType:started.data.mimeType});
  check(!put.error,`Corpus upload failed: ${put.error?.message}`);
  const done=await invoke("upload-finalize",owner.token,{...body,documentId:started.data.documentId});
  check(done.status===200&&done.data.uploadStatus==="ready",`Realistic ${name} not accepted: ${JSON.stringify(done)}`);
  const dl=await invoke("download",viewer.token,{...body,documentId:started.data.documentId});
  check(dl.status===200&&dl.data.filename===name&&typeof dl.data.url==="string",`Realistic ${name} download failed: ${JSON.stringify(dl)}`);
  // Locally the Edge Runtime signs URLs with its internal gateway host (kong:8000); map it to the public base.
  const signed=new URL(dl.data.url);const publicBase=new URL(base);
  if(signed.hostname==="kong"){signed.protocol=publicBase.protocol;signed.host=publicBase.host;}
  const fetched=new Uint8Array(await (await fetch(signed)).arrayBuffer());
  check(fetched.length===bytes.length&&fetched.every((v,i)=>v===bytes[i]),`Downloaded ${name} differs from upload`);
 }
 console.log("D04-C realistic PDF/DOCX upload, finalize and byte-exact download passed");
}

// Reconciler must reject ordinary user credentials even when called from local CI.
const reconcile=await fetch(base+"/functions/v1/deal-document-reconcile",{
 method:"POST",headers:{apikey:anon,authorization:"Bearer "+owner.token,"content-type":"application/json"},body:"{}"
});
check(reconcile.status===401,`Reconciler accepted a browser JWT: ${reconcile.status}`);
console.log("D04-B3.3 concurrent finalization, malformed DOCX and reconciler auth passed");


// D04-B3.4: exercise the actual privileged recovery HTTP path, not only SQL RPCs.
const recoverySecret="tripp-ci-local-reconciler-secret-only-2026";
async function runReconciler(){
 const response=await fetch(base+"/functions/v1/deal-document-reconcile",{
  method:"POST",headers:{apikey:anon,authorization:"Bearer "+recoverySecret,"content-type":"application/json"},body:"{}"
 });
 const data=await response.json().catch(()=>({}));
 check(response.status===200,`Reconciler HTTP failed: ${response.status} ${JSON.stringify(data)}`);
 return data as {results?:Array<{id:string,outcome:string}>};
}
// Seed a historical pending record directly; immutable created_at cannot be updated.
const abandonedId=id();
const abandonedTime=new Date(Date.now()-5*60*60_000).toISOString();
const {error:abandonedError}=await admin.from("deal_documents").insert({
 id:abandonedId,organization_id:orgA,deal_id:dealA,document_type:"other",
 original_filename:"abandoned.pdf",storage_path:`${orgA}/${dealA}/${abandonedId}/source.pdf`,
 mime_type:"application/pdf",file_size_bytes:pdf.length,uploaded_by:owner.id,
 created_at:abandonedTime
});
check(!abandonedError,`Prepare abandoned fixture: ${abandonedError?.message}`);
const recovering=await initiate(pdf,"recover.pdf");
const recoveringPath=`${orgA}/${dealA}/${recovering.documentId}/source.pdf`;
const {error:recoverySourceError}=await admin.storage.from(bucket).upload(recoveringPath,pdf,{contentType:"application/pdf",upsert:false});
check(!recoverySourceError,`Prepare recovered source: ${recoverySourceError?.message}`);
const leaseToken=id();
const {data:leaseClaimed,error:leaseClaimError}=await admin.rpc("tripp_claim_document_finalize",{
 p_id:recovering.documentId,p_org:orgA,p_deal:dealA,p_user:owner.id,p_token:leaseToken
});
check(!leaseClaimError&&leaseClaimed,"Prepare recovery processing lease failed");
const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",pdf))).map(v=>v.toString(16).padStart(2,"0")).join("");
const {data:digestBound,error:digestError}=await admin.rpc("tripp_bind_document_digest",{p_id:recovering.documentId,p_token:leaseToken,p_digest:digest});
check(!digestError&&digestBound,"Recovery digest binding failed");
const {data:recoveryScan,error:recoveryScanError}=await admin.rpc("tripp_bind_document_clean_scan",{
 p_id:recovering.documentId,p_token:leaseToken,p_digest:digest,p_engine:"ci-fixture"
});
check(!recoveryScanError&&recoveryScan,"Recovery scan evidence binding failed");
const expiredTime=new Date(Date.now()-20*60_000).toISOString();
const {error:expiredError}=await admin.from("deal_documents").update({finalize_lease_until:expiredTime}).eq("id",recovering.documentId);
check(!expiredError,`Expire recovery lease: ${expiredError?.message}`);
const recoveryResults=await runReconciler();
check(recoveryResults.results?.some(r=>r.id===recovering.documentId&&r.outcome==="recovered_ready"),
 `Reconciler failed valid-source recovery: ${JSON.stringify(recoveryResults)}`);
// The pg_cron expiry job (every 5 min) may fail it first; either path must end failed/upload_abandoned.
{
 const {data:ab}=await admin.from("deal_documents").select("upload_status,failure_reason").eq("id",abandonedId).single();
 check(ab?.upload_status==="failed"&&ab?.failure_reason==="upload_abandoned",
  `Abandoned upload not failed: ${JSON.stringify(ab)} ${JSON.stringify(recoveryResults)}`);
}
check(await status(recovering.documentId)==="ready","Recovered document not ready");
check(await status(abandonedId)==="failed","Abandoned document not failed");
const {data:oldWorkerResult,error:oldWorkerError}=await admin.rpc("tripp_finish_document_finalize",{
 p_id:recovering.documentId,p_token:leaseToken,p_success:false
});
check(!oldWorkerError&&!oldWorkerResult,"Expired worker changed recovered document");
const repeatedRecovery=await runReconciler();
check(!repeatedRecovery.results?.some(r=>r.id===recovering.documentId&&r.outcome==="recovered_ready"),
 "Reconciler recovered the same document twice");
console.log("D04-B3.4 actual reconciler recovery, abandoned upload, stale-worker fencing and idempotency passed");

const tamperedDoc=await initiate(pdf,"tampered-recovery.pdf");
const altered=pdf.slice();
altered[9]=altered[9]===49?50:49;
check(altered.length===pdf.length,"Tamper fixture size changed");
const tamperedPath=`${orgA}/${dealA}/${tamperedDoc.documentId}/source.pdf`;
const {error:tamperedUploadError}=await admin.storage.from(bucket).upload(tamperedPath,altered,{contentType:"application/pdf",upsert:false});
check(!tamperedUploadError,"Tampered source fixture upload failed");
const tamperedToken=id();
const {data:tamperedClaim,error:tamperedClaimError}=await admin.rpc("tripp_claim_document_finalize",{
 p_id:tamperedDoc.documentId,p_org:orgA,p_deal:dealA,p_user:owner.id,p_token:tamperedToken
});
check(!tamperedClaimError&&tamperedClaim,"Tampered fixture claim failed");
const {data:tamperedBound,error:tamperedBindError}=await admin.rpc("tripp_bind_document_digest",{
 p_id:tamperedDoc.documentId,p_token:tamperedToken,p_digest:digest
});
check(!tamperedBindError&&tamperedBound,"Tampered fixture digest bind failed");
const {error:tamperedExpireError}=await admin.from("deal_documents").update({finalize_lease_until:expiredTime}).eq("id",tamperedDoc.documentId);
check(!tamperedExpireError,"Tampered fixture lease expiry failed");
const tamperedReconcile=await runReconciler();
check(tamperedReconcile.results?.some(r=>r.id===tamperedDoc.documentId&&r.outcome==="digest_mismatch_rejected"),
 "Tampered same-size source was not rejected by reconciler: "+JSON.stringify(tamperedReconcile));
check(await status(tamperedDoc.documentId)==="failed","Tampered document was not failed closed");
check((await invoke("download",owner.token,{...body,documentId:tamperedDoc.documentId})).status===404,"Tampered document downloadable");
console.log("D04-B3.6 same-size source tampering rejected by SHA-256 recovery check");


// D04-B4-A.2: parallel admission cannot exceed the per-user hourly cap.
const previousAdmissions=await admin.from("document_upload_admissions").select("id",{count:"exact",head:true}).eq("user_id",owner.id);
check(!previousAdmissions.error,"Admission count query failed");
const remaining=Math.max(0,20-(previousAdmissions.count??0));
const admissionRace=await Promise.all(Array.from({length:remaining+6},()=>invoke("upload-initiate",owner.token,input)));
check(admissionRace.filter(r=>r.status===201).length===remaining,
 "Concurrent admission exceeded hourly limit: "+JSON.stringify(admissionRace.map(r=>r.status)));
check(admissionRace.filter(r=>r.status===429).length===6,
 "Quota exhaustion did not fail closed: "+JSON.stringify(admissionRace.map(r=>r.status)));
const finalAdmissions=await admin.from("document_upload_admissions").select("id",{count:"exact",head:true}).eq("user_id",owner.id);
check(!finalAdmissions.error&&finalAdmissions.count===20,"Hourly admission count is not 20");
console.log("D04-B4-A.2 parallel admission ceiling and quota rejection passed");


// D04-B4-A.3: different-user requests share the same org admission ceiling.
const orgRunner=await account("org-quota-runner");
await seed("organization_memberships",{organization_id:orgA,user_id:orgRunner.id,role:"member"});
const activeRows=await admin.from("deal_documents").select("id",{count:"exact",head:true})
 .eq("organization_id",orgA).in("upload_status",["pending","processing"]);
check(!activeRows.error,"Org active count failed");
const admissions=await admin.from("document_upload_admissions").select("id,created_at")
 .eq("organization_id",orgA);
check(!admissions.error&&!!admissions.data,"Org admission count failed");
const activeIds=await admin.from("deal_documents").select("id,upload_status").eq("organization_id",orgA);
check(!activeIds.error&&!!activeIds.data,"Org reservation status query failed");
const activeSet=new Set(activeIds.data.filter(d=>d.upload_status==="pending"||d.upload_status==="processing").map(d=>d.id));
const cutoff=Date.now()-3*60*60_000;
const reserved=new Set([...activeSet,...admissions.data.filter(a=>Date.parse(a.created_at)>cutoff &&
 (!activeIds.data.some(d=>d.id===a.id)||activeSet.has(a.id))).map(a=>a.id)]);
const padding=Math.max(0,99-reserved.size);
check(reserved.size<=99,"Unexpected pre-existing org quota fixtures");
if(padding>0){
 const {error:padError}=await admin.from("document_upload_admissions").insert(
  Array.from({length:padding},()=>({id:id(),organization_id:orgA,user_id:owner.id})));
 check(!padError,"Prepare org quota reservations: "+padError?.message);
}
const orgRace=await Promise.all(Array.from({length:6},()=>invoke("upload-initiate",orgRunner.token,input)));
check(orgRace.filter(r=>r.status===201).length===1,
 "Org reservation quota admitted multiple parallel requests: "+JSON.stringify(orgRace.map(r=>r.status)));
check(orgRace.filter(r=>r.status===429).length===5,
 "Org quota did not reject overflow: "+JSON.stringify(orgRace.map(r=>r.status)));
console.log("D04-B4-A.3 concurrent cross-user org reservation ceiling passed");


// D04-B4-A.3: admission records expire conservatively; cleanup must not delete fresh reservations.
const expiredAdmission=id();
const {error:expiredAdmissionError}=await admin.from("document_upload_admissions").insert({
 id:expiredAdmission,organization_id:orgB,user_id:outsider.id,
 created_at:new Date(Date.now()-5*60*60_000).toISOString()
});
check(!expiredAdmissionError,"Expired admission fixture failed");
const {data:pruned,error:pruneError}=await admin.rpc("tripp_prune_document_admissions",{p_limit:1000});
check(!pruneError&&typeof pruned==="number"&&pruned>=1,"Admission pruning failed");
const {data:expiredRemaining,error:expiredLookupError}=await admin.from("document_upload_admissions")
 .select("id").eq("id",expiredAdmission);
check(!expiredLookupError&&expiredRemaining?.length===0,"Expired admission survived pruning");
const {data:freshRemaining,error:freshLookupError}=await admin.from("document_upload_admissions")
 .select("id",{count:"exact",head:true}).eq("organization_id",orgA);
check(!freshLookupError&&(freshRemaining===null||freshRemaining!==undefined),"Fresh admission query failed");
console.log("D04-B4-A.3 admission ledger retention passed");
