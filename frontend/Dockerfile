# The Next.js frontend, as a deployable image.
#
# ── WHY THE PUBLIC ENV VARS ARE BUILD ARGS AND NOT RUNTIME CONFIG ─────────
#
# `NEXT_PUBLIC_*` are INLINED INTO THE BUNDLE at build time. Passing them as
# runtime environment variables does nothing at all — the strings are already
# compiled into the JavaScript the browser downloads, so a container started
# with a corrected `NEXT_PUBLIC_API_BASE_URL` still calls the old one. They are
# build args here so that is impossible to get wrong, and `lib/api/config.ts`
# throws during a production build when they are missing, which turns a silently
# wrong deployment into a failed one.
#
# It also means CHANGING THEM REQUIRES A REBUILD, not a restart. That is stated
# in DEPLOY_ORACLE.md beside the step that sets them.
#
# ── MULTI-ARCH ────────────────────────────────────────────────────────────
#
# `node:20-alpine` is published for both amd64 and arm64, so this builds
# unchanged on an Oracle Ampere A1 (aarch64) and on an x86 laptop. Nothing here
# pins a platform; let the daemon pick its own.

# ── deps: install once, cached on the lockfile alone ──────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# Only the manifests, so a source edit does not invalidate the install layer.
COPY package.json package-lock.json ./
# `npm ci` and not `npm install`: it installs exactly the lockfile, and fails
# rather than silently resolving something newer on a deploy host.
RUN npm ci

# ── build: compile the standalone server ──────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Baked into the bundle — see the note at the top of this file.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_MEDIA_BASE_URL
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_MEDIA_BASE_URL=$NEXT_PUBLIC_MEDIA_BASE_URL \
    NEXT_PUBLIC_RAZORPAY_KEY_ID=$NEXT_PUBLIC_RAZORPAY_KEY_ID \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build

# ── BUILD TOOLS MUST NOT REACH THE RUNTIME IMAGE ──────────────────────────
#
# Next's output tracing pulled `esbuild` into `.next/standalone/node_modules`.
# esbuild is a BUILD-time bundler and a Go binary, so the runtime image carried
# Go's stdlib — and with it 16 advisories, one CRITICAL, none of which have
# anything to do with running this server. It was the single largest source of
# findings in the image scan.
#
# Verified before removing, rather than assumed: `server.js` contains no
# reference to esbuild, and the standalone server was started with these
# directories moved aside and served both `/` and `/events` with HTTP 200.
# A Next standalone server does not bundle anything at runtime; it only serves
# what was already compiled.
RUN rm -rf .next/standalone/node_modules/esbuild \
           .next/standalone/node_modules/@esbuild

# ── runner: the traced server and nothing else ────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# A non-root user, because this process is reachable from the internet and has
# no reason to be able to write to its own image.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# ── A RUNTIME IMAGE HAS NO BUSINESS SHIPPING A PACKAGE MANAGER ────────────
#
# Every one of the 19 Node.js advisories in the image scan — tar, minimatch,
# glob, cross-spawn, brace-expansion, sigstore, ip-address — came from npm's
# OWN bundled dependencies inside the base image, not from this application.
# The container's entrypoint is `node server.js`; npm is never invoked, so the
# whole tree is unreachable code that only supplies CVEs and a scanner backlog
# somebody has to triage forever.
#
# Deleting it fixes all 19 at once, permanently and independently of whichever
# npm the base image happens to ship, and removes an arbitrary-code-execution
# tool from a container exposed to the internet. It also makes the image
# smaller. `corepack` goes for the same reason.
#
# `apk upgrade` is the OS half: libcrypto3/libssl3 in the base layer were
# behind on CVE-2026-45447. Node's TLS is statically linked against its own
# OpenSSL, so this patches the system copy the rest of the image links to.
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack && \
    node --version

# `public` and the static chunks are NOT included in the traced output — the
# standalone server expects to find them beside it, and a missing `.next/static`
# is a page that renders unstyled rather than an error anybody notices.
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Compose owns the healthcheck for this service (see docker-compose.oci.yml):
# the image should not assume a route exists that the app might rename.
CMD ["node", "server.js"]
