FROM denoland/deno:2.5.6
WORKDIR /app
COPY inspector/ ./inspector/
COPY supabase/functions/_shared/file-validation-strict.ts ./supabase/functions/_shared/file-validation-strict.ts
USER deno
ENV INSPECTOR_HOST=0.0.0.0 INSPECTOR_PORT=8090
EXPOSE 8090
CMD ["run","--no-check","--allow-net=0.0.0.0:8090","--allow-env=INSPECTOR_HOST,INSPECTOR_PORT,INSPECTOR_BEARER_SECRET","inspector/gateway.ts"]
