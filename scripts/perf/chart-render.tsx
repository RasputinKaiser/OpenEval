import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { performance } from 'node:perf_hooks';
import { CostVsOutcome } from '../../components/CostVsOutcome';
const points = Array.from({length:400},(_,i)=>({c:Math.pow(10,-4+(i%80)/10),o:(i%11)/10,p:i%3?'heuristic':'judged'}));
const evidence={n:10000,denominator:12000,coverage:10000/12000};
let bytes=0; const samples:number[]=[];
for(let i=0;i<30;i++){const start=performance.now();const html=renderToStaticMarkup(<CostVsOutcome points={points} evidence={evidence}/>);if(i>=5)samples.push(performance.now()-start);bytes=Buffer.byteLength(html);}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({workload:'400 scatter points, 5 warmups, 25 renders',medianRenderMs:samples[12],p95RenderMs:samples[23],htmlBytes:bytes}));
