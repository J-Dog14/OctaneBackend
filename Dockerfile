# Multi-runtime container: Node.js 20 + Python 3.11 + R 4.x
# Deployed to Railway. Runs the Next.js app with the ability to spawn
# UAIS Python and R scripts as subprocesses.

FROM node:20-bookworm-slim

# ── System dependencies ────────────────────────────────────────────────────────
# python3/pip: UAIS Python scripts
# r-base: UAIS R scripts (pitching, hitting)
# libssl/libcurl/libxml2: R package build deps (tidyverse, httr, xml2)
# libpq-dev: RPostgres + psycopg2 PostgreSQL client
# libsqlite3-dev: RSQLite
# fonts-dejavu: reportlab PDF generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    r-base \
    r-base-dev \
    libssl-dev \
    libcurl4-openssl-dev \
    libxml2-dev \
    libpq-dev \
    libsqlite3-dev \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Node dependencies (cached layer) ──────────────────────────────────────────
COPY package*.json ./
RUN npm ci

# ── Python dependencies ────────────────────────────────────────────────────────
COPY uais/python/requirements.txt ./uais-python-requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r uais-python-requirements.txt

# ── R packages ─────────────────────────────────────────────────────────────────
COPY uais/R/install_packages.R ./uais-install-packages.R
RUN Rscript uais-install-packages.R

# ── Application code ───────────────────────────────────────────────────────────
COPY . .

# Generate Prisma client and build Next.js
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
