#!/bin/sh
# Bump cache-busting versions on CSS/JS for both apps before each release
V=$(date +%Y%m%d%H%M)
sed -i -E "s#(style\.css|app\.js|shop\.css|shop\.js)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html shop/index.html
echo "version $V"
