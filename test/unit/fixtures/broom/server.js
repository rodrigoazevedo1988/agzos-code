#!/usr/bin/env node
/* eslint-disable */
'use strict';
// @ts-check
const http = require('http');

/* bloco de comentário
   em várias linhas */
function handler(req, res) {
  console.debug('req', req.url);
  const msg = "console.log(1) // não é comentário";
  const tpl = `${console.log('x')} e console.log(2)`;
  const ok = req && console.log('valor');
  res.end(msg + tpl + ok);
  return;
  console.log('morto');
  function hoisted() {}
}

switch (process.argv[2]) {
  case 'a':
    handler();
    break;
    console.log('morto também');
  default:
    if (0) {
      console.log('nunca');
    } else {
      console.info('sempre');
    }
}

http.createServer(handler).listen(3000); // porta
