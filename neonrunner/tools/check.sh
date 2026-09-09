#!/bin/sh
# Витягує JS із index.html і перевіряє синтаксис.
D=$(mktemp -d)
awk '/^"use strict";/{f=1} f{if($0=="</script>")exit; print}' index.html > "$D/game.js"
node --check "$D/game.js" && echo "СИНТАКСИС OK ($(wc -l < "$D/game.js") рядків JS)"
rm -rf "$D"
