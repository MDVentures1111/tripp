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
