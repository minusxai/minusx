# Audit-only plan. Do not build or register without root review.
FROM golang:1.25.3-alpine@sha256:aee43c3ccbf24fdffb7295693b6e33b21e01baec1b2a55acc351fde345e9ec34 AS delegate
WORKDIR /candidate
COPY go.mod main.go main_test.go syscall-names.txt ./
COPY debian-phase ./debian-phase
COPY ubuntu-phase ./ubuntu-phase
RUN go test ./... && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /delegate .
COPY personality-probe /probe-source
RUN cd /probe-source && go test ./... && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags="-s -w -buildid=" -o /personality-probe .
FROM moby/buildkit:v0.25.1@sha256:79cc6476ab1a3371c9afd8b44e7c55610057c43e18d9b39b68e2b0c2475cc1b6
# The original runtime is retained byte-for-byte; all other driver files unchanged.
RUN mv /usr/bin/buildkit-runc /usr/bin/buildkit-runc.real
COPY --from=delegate /delegate /usr/bin/buildkit-runc
COPY --from=delegate /personality-probe /usr/bin/util-personality-probe
