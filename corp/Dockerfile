# Build KeepMind Corp image from the repo root:
#   docker build -f corp/Dockerfile -t keepmind-corp .
FROM node:22-alpine AS brain
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.corp.config.mts electron.vite.config.ts ./
COPY src src
RUN npm run corp:build-brain

FROM node:22-alpine
WORKDIR /app
COPY corp /app/corp
COPY --from=brain /app/corp/brain-dist /app/corp/brain-dist
ENV KEEPMIND_CORP_HOST=0.0.0.0
ENV KEEPMIND_CORP_PORT=8787
ENV KEEPMIND_CORP_DATA=/data
ENV KEEPMIND_VAULT=/data/vault
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.KEEPMIND_CORP_PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "corp/server.mjs"]
