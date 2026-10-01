import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Basis,amount,timestamp,Token } from '../src/components.js';
import type { UsageSummary } from '@wombat/client';
const summary:UsageSummary={measurementCount:2,inputTotal:100,tokens:{input:80,cacheRead:20,cacheCreate:0,output:10,total:110},price:{currency:'USD',policy:'synthetic',priceRevision:'test',cost:null,knownCost:'0.125',status:'partial',components:[{category:'input',tokens:80,cost:'0.125',knownCost:'0.125',status:'priced',ratePerMillion:null}],basis:[],issues:[]}};
test('unknown and known-subtotal costs are distinct, and mixed-rate aggregates do not invent a rate',()=>{
 assert.equal(amount(summary),'$0.1250*');
 assert.doesNotMatch(amount({...summary,price:{...summary.price,status:'unknown'}}),/\$0/);
 const html=renderToStaticMarkup(createElement(Basis,{summary,onPrices:()=>{}}));
 assert.doesNotMatch(html,/×/);assert.match(html,/\$0\.125/);
});
test('compact tokens retain exact accessible values and date-only evidence does not invent times',()=>{
 const html=renderToStaticMarkup(createElement(Token,{value:1234567,interactive:true}));
 assert.match(html,/1\.23M/);assert.match(html,/1,234,567 Token/);
 assert.equal(timestamp('2026-09-29','America/Los_Angeles','date'),'2026-09-29');
});
