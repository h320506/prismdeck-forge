#!/usr/bin/env bash
cd "$(dirname "$0")"
npx --yes esbuild@0.25.0 app.js --bundle --minify --format=esm --target=es2020 --outfile=app.bundle.js
npx --yes esbuild@0.25.0 site.js --bundle --minify --format=esm --target=es2020 --outfile=site.bundle.js
