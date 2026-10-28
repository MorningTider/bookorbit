ARG BUILD_IMAGE=node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567
FROM ${BUILD_IMAGE} AS prepare
COPY prepare-support.sh requirements.in /build/
RUN sh /build/prepare-support.sh
COPY patch-poppler.py build-poppler.sh /build/
RUN sh /build/build-poppler.sh
COPY collect-support.py support-abi.py /build/
RUN python3.11 /build/collect-support.py
FROM scratch AS artifact
COPY --from=prepare /out/ /
