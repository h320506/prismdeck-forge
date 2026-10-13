#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -f "./node_modules/.bin/esbuild" ]; then
  ./node_modules/.bin/esbuild app.js --bundle --minify --format=esm --target=es2020 --outfile=app.bundle.js
  ./node_modules/.bin/esbuild site.js --bundle --minify --format=esm --target=es2020 --outfile=site.bundle.js
else
  npx --yes esbuild@0.25.0 app.js --bundle --minify --format=esm --target=es2020 --outfile=app.bundle.js
  npx --yes esbuild@0.25.0 site.js --bundle --minify --format=esm --target=es2020 --outfile=site.bundle.js
fi
