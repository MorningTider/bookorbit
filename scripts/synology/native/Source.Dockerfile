ARG BUILD_IMAGE=node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567
FROM ${BUILD_IMAGE} AS builder
COPY pnpm.tgz /tmp/pnpm.tgz
RUN mkdir /opt/pnpm && tar -xzf /tmp/pnpm.tgz -C /opt/pnpm --strip-components=1 && rm /tmp/pnpm.tgz && chmod 755 /opt/pnpm/bin/*.cjs && ln -s /opt/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm && pnpm --version
ENV PATH="/opt/pnpm/bin:${PATH}"
ENV npm_config_verify_deps_before_run=false
WORKDIR /source
ADD source.tar /source/
RUN --mount=type=cache,id=bookorbit-native-pnpm-v11-amd64,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store --fetch-timeout 300000 --network-concurrency 8
RUN pnpm --filter client run build-only
RUN pnpm --filter server run build
RUN pnpm --config.allow-unused-patches=true --filter server deploy --prod --legacy /out/app
RUN mkdir -p /out/app/dist /out/app/migrations /out/app/public && cp -a server/dist/. /out/app/dist/ && cp -a server/src/db/migrations/. /out/app/migrations/ && cp -a client/dist/. /out/app/public/
RUN cp LICENSE NOTICE ADDITIONAL_TERMS.md /out/app/ && mkdir -p /out/app/bin /out/app/koreader-plugin && cp -a server/bin/kepubify /out/app/bin/ && cp -a koreader-plugin/bookorbit.koplugin /out/app/koreader-plugin/
COPY source-build.json /out/source-build.json
COPY source.tar /out/sources/bookorbit-source.tar
RUN node scripts/synology/native/finalize-source-build.mjs /out
FROM scratch AS artifact
COPY --from=builder /out/ /
