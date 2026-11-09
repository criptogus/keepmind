FROM node:22-alpine
WORKDIR /app
COPY . /app/corp
ENV KEEPMIND_CORP_HOST=0.0.0.0
ENV KEEPMIND_CORP_DATA=/data
ENV KEEPMIND_VAULT=/data/vault
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "corp/server.mjs"]
