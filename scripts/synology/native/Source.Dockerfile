ARG BUILD_IMAGE=node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567
FROM ${BUILD_IMAGE} AS builder
COPY pnpm.tgz /tmp/pnpm.tgz
RUN mkdir /opt/pnpm && tar -xzf /tmp/pnpm.tgz -C /opt/pnpm --strip-components=1 && rm /tmp/pnpm.tgz && chmod 755 /opt/pnpm/bin/*.cjs && ln -s /opt/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm && pnpm --version
ENV PATH="/opt/pnpm/bin:${PATH}"
ENV npm_config_verify_deps_before_run=false
WORKDIR /source
ADD dependencies.tar /source/
COPY preload-store.tgz /tmp/preload-store.tgz
ARG STORE_CACHE=bookorbit-native-source-v11-none
RUN --mount=type=cache,id=${STORE_CACHE},target=/pnpm/store,sharing=locked if [ ! -f /pnpm/store/v11/index.db ]; then tar -xzf /tmp/preload-store.tgz -C /pnpm/store; fi && pnpm --filter client... --filter server... install --frozen-lockfile --config.allow-unused-patches=true --store-dir /pnpm/store --fetch-timeout 300000 --network-concurrency 8
ADD source.tar /source/
RUN pnpm --filter client run build-only
RUN pnpm --filter server run build
RUN --mount=type=cache,id=${STORE_CACHE},target=/pnpm/store,sharing=locked pnpm --config.store-dir=/pnpm/store --config.allow-unused-patches=true --config.inject-workspace-packages=true --filter server deploy --prod /out/app
RUN mkdir -p /out/app/dist /out/app/migrations /out/app/public && cp -a server/dist/. /out/app/dist/ && cp -a server/src/db/migrations/. /out/app/migrations/ && cp -a client/dist/. /out/app/public/
RUN cp LICENSE NOTICE ADDITIONAL_TERMS.md /out/app/ && mkdir -p /out/app/bin /out/app/koreader-plugin && cp -a server/bin/kepubify /out/app/bin/ && cp -a koreader-plugin/bookorbit.koplugin /out/app/koreader-plugin/
COPY source-build.json /out/source-build.json
COPY source.tar /out/sources/bookorbit-source.tar
RUN node scripts/synology/native/finalize-source-build.mjs /out
FROM scratch AS artifact
COPY --from=builder /out/ /
