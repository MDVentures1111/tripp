FROM denoland/deno:2.5.6
WORKDIR /app
COPY scanner/gateway.ts ./gateway.ts
USER deno
ENV PORT=8080 CLAMD_HOST=clamav CLAMD_PORT=3310
EXPOSE 8080
CMD ["run","--no-check","--allow-net","--allow-env=SCANNER_BEARER_SECRET,CLAMD_HOST,CLAMD_PORT,PORT","gateway.ts"]
