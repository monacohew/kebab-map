#!/bin/sh
# Bump the cache-busting version on style.css and app.js before each release
V=$(date +%Y%m%d%H%M)
sed -i -E "s#style.css(\?v=[0-9]+)?\"#style.css?v=$V\"#; s#app.js(\?v=[0-9]+)?\"#app.js?v=$V\"#" index.html
echo "version $V"
