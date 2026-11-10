FROM node:26.7.0-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts/worker.mjs ./scripts/worker.mjs
# Presentatorteksten en personages voor de tv-modus; geen vragen of antwoorden.
COPY internal/catalog/host.nl.json ./internal/catalog/host.nl.json
RUN npm run build

FROM golang:1.27.3-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY internal ./internal
COPY --from=web /app/dist ./dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /bluffery .
RUN mkdir /data && chown 99:100 /data && chmod 0700 /data

FROM scratch
COPY --from=build /bluffery /bluffery
COPY --from=build --chown=99:100 /data /data
USER 99:100
ENV LISTEN_ADDR=:8080 DATA_DIR=/data PUBLIC_BASE_URL=https://bluffery.roesink.dev
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/bluffery", "healthcheck"]
ENTRYPOINT ["/bluffery"]
