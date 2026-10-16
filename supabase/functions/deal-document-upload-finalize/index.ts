import { authorize, json, preflight, readJsonBody, UUID } from "../_shared/documents.ts";
import { checkDocument, MAX_DOCUMENT_BYTES } from "../_shared/file-validation.ts";
const BUCKET = "tripp-deal-documents";
Deno.serve(async (req) => {
  const options = preflight(req); if (options) return options;
  if (req.method !== "POST") return json(req,{error:"Method not allowed."},405);
  let raw:unknown; try { raw=await readJsonBody(req); } catch { return json(req,{error:"Invalid request."},400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json(req,{error:"Invalid request."},400);
  const b=raw as Record<string,unknown>;
  if(typeof b.organizationId!=="string"||typeof b.dealId!=="string"||typeof b.documentId!=="string"||!UUID.test(b.documentId)) return json(req,{error:"Invalid request."},400);
  try {
    const scope=await authorize(req,b.organizationId,b.dealId,true);
    if(scope instanceof Response) return scope;
    const {data:doc,error}=await scope.admin.from("deal_documents").select("id,storage_path,mime_type,file_size_bytes,upload_status,uploaded_by").eq("id",b.documentId).eq("organization_id",scope.orgId).eq("deal_id",scope.dealId).maybeSingle();
    if(error)return json(req,{error:"Service unavailable."},503);
    if(!doc||doc.uploaded_by!==scope.userId)return json(req,{error:"Not found."},404);
    if(doc.upload_status!=="pending")return json(req,{error:"Document is not pending.",uploadStatus:doc.upload_status},409);
    const ext=doc.mime_type==="application/pdf"?"pdf":doc.mime_type==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"?"docx":null;
    if(!ext||doc.storage_path!==`${scope.orgId}/${scope.dealId}/${doc.id}/source.${ext}`)return json(req,{error:"Invalid document metadata."},503);
    const quarantine=`${scope.orgId}/${scope.dealId}/${doc.id}/quarantine.${ext}`;
    const reject=async(reason:string)=>{
      const {error:updateError}=await scope.admin.from("deal_documents").update({upload_status:"failed"}).eq("id",doc.id).eq("upload_status","pending");
      if(updateError)return json(req,{error:"Unable to persist document rejection."},503);
      await scope.admin.storage.from(BUCKET).remove([quarantine]);
      return json(req,{error:"Document failed structural validation.",failureReason:reason,uploadStatus:"failed"},422);
    };
    const {data:file,error:readError}=await scope.admin.storage.from(BUCKET).download(quarantine);
    if(readError||!file)return json(req,{error:"Uploaded file not found."},404);
    if(file.size>MAX_DOCUMENT_BYTES||file.size!==doc.file_size_bytes)return await reject("size_mismatch");
    const bytes=new Uint8Array(await file.arrayBuffer());
    const validation=checkDocument(ext,bytes);
    if(!validation.ok)return await reject(validation.reason);
    const {error:uploadError}=await scope.admin.storage.from(BUCKET).upload(doc.storage_path,bytes,{contentType:doc.mime_type,upsert:false});
    if(uploadError)return json(req,{error:"Unable to store validated document."},503);
    const {data:updated,error:updateError}=await scope.admin.from("deal_documents").update({upload_status:"ready"}).eq("id",doc.id).eq("organization_id",scope.orgId).eq("deal_id",scope.dealId).eq("upload_status","pending").select("id").maybeSingle();
    if(updateError||!updated)return json(req,{error:"Unable to finalize document."},503);
    await scope.admin.storage.from(BUCKET).remove([quarantine]);
    return json(req,{documentId:doc.id,uploadStatus:"ready",validation:"structural_only"});
  } catch {return json(req,{error:"Unexpected server error."},500);}
});
