BEGIN TRANSACTION READ ONLY;
SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('deals','deal_documents','document_upload_admissions') ORDER BY table_name,ordinal_position;
SELECT schemaname,tablename,policyname,cmd FROM pg_policies WHERE (schemaname='public' AND tablename IN ('deals','deal_documents','document_upload_admissions')) OR (schemaname='storage' AND tablename='objects') ORDER BY schemaname,tablename,policyname;
SELECT c.relname,con.conname,con.contype FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('deals','deal_documents','document_upload_admissions');
SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='tripp-deal-documents';
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
COMMIT;
