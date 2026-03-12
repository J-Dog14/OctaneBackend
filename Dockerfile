# Multi-runtime container: Node.js 20 + Python 3.11 + R 4.x
# Deployed to Railway. Runs the Next.js app with the ability to spawn
# UAIS Python and R scripts as subprocesses.

FROM node:20-bookworm-slim

# ── System dependencies + R packages (all via apt — pre-compiled, fast) ────────
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
    r-cran-dbi \
    r-cran-rsqlite \
    r-cran-dplyr \
    r-cran-readr \
    r-cran-stringr \
    r-cran-tibble \
    r-cran-tidyr \
    r-cran-purrr \
    r-cran-ggplot2 \
    r-cran-forcats \
    r-cran-lubridate \
    r-cran-xml2 \
    r-cran-yaml \
    r-cran-fs \
    r-cran-uuid \
    && rm -rf /var/lib/apt/lists/* \
    && Rscript -e "options(repos=c(CRAN='https://packagemanager.posit.co/cran/__linux__/bookworm/latest')); install.packages('RPostgres', dependencies=FALSE)"

WORKDIR /app

# ── Node dependencies (cached layer) ──────────────────────────────────────────
COPY package*.json ./
RUN npm ci

# ── Python dependencies ────────────────────────────────────────────────────────
COPY uais/python/requirements.txt ./uais-python-requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r uais-python-requirements.txt

# ── Application code ───────────────────────────────────────────────────────────
COPY . .

# Generate Prisma client and build Next.js
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
