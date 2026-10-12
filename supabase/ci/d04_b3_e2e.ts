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
const pdf=new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF\n");
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
check(finalize.status===200,`Finalize: ${finalize.status} ${JSON.stringify(finalize.data)}`);
const list=await invoke("list",viewer.token,{},"GET");
check(list.status===200&&list.data.documents?.some((d:{id:string})=>d.id===documentId),"Viewer list failed");
check((await invoke("download",outsider.token,body)).status===404,"Cross-org download not denied");
const download=await invoke("download",viewer.token,body);
check(download.status===200&&typeof download.data.url==="string","Viewer download denied");
const {error:directError}=await publicClient.storage.from(bucket).download(`${orgA}/${dealA}/${documentId}/source.pdf`);
check(!!directError,"Anonymous direct Storage download unexpectedly permitted");
console.log("D04-B3 local HTTP authorization, signed upload, finalize, and download passed");


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
const badDownload=await invoke("download",owner.token,{...body,documentId:bad.documentId});
check(badDownload.status===404,"Rejected PDF is downloadable");
const wrongSize=await initiate(pdf);
await uploadQuarantine(wrongSize,new TextEncoder().encode("%PDF-1.4\\n%%EOF\\nextra"));
const mismatch=await invoke("upload-finalize",owner.token,{...body,documentId:wrongSize.documentId});
check(mismatch.status===422,`File size mismatch not rejected: ${mismatch.status}`);
check(await status(wrongSize.documentId)==="failed","Size mismatch did not fail closed");
const missing=await initiate(pdf);
const missingResult=await invoke("upload-finalize",owner.token,{...body,documentId:missing.documentId});
check(missingResult.status===409,"Missing quarantine object did not reject finalization");
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
const expiredTime=new Date(Date.now()-20*60_000).toISOString();
const {error:expiredError}=await admin.from("deal_documents").update({finalize_lease_until:expiredTime}).eq("id",recovering.documentId);
check(!expiredError,`Expire recovery lease: ${expiredError?.message}`);
const recoveryResults=await runReconciler();
check(recoveryResults.results?.some(r=>r.id===recovering.documentId&&r.outcome==="recovered_ready"),
 `Reconciler failed valid-source recovery: ${JSON.stringify(recoveryResults)}`);
check(recoveryResults.results?.some(r=>r.id===abandonedId&&r.outcome==="abandoned_failed"),
 `Reconciler failed abandoned upload: ${JSON.stringify(recoveryResults)}`);
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
check(tamperedReconcile.results?.some(r=>r.id===tamperedDoc.documentId&&r.outcome==="digest_mismatch_manual_review"),
 "Tampered same-size source was not rejected by reconciler");
check(await status(tamperedDoc.documentId)==="processing","Tampered document was published");
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
