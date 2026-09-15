import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4174;
const base = `http://127.0.0.1:${port}/word-connect-pwa/`;
const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite','preview','--host','127.0.0.1','--port',String(port)], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  for (let i=0;i<50;i++) { try { if ((await fetch(base)).ok) break; } catch {} await sleep(100); if(i===49) throw new Error('preview did not start'); }
  const browser = await chromium.launch({ headless: true });
  const cases = [[393,659],[320,568],[390,844],[360,640]];
  for (const [width,height] of cases) {
    const context = await browser.newContext({ viewport:{width,height}, isMobile:true, hasTouch:true });
    const page = await context.newPage(); const errors=[];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
    await page.goto(base,{waitUntil:'networkidle'});
    await page.evaluate(() => {
      const answers=document.querySelector('.answers');
      if (answers) answers.innerHTML=Array.from({length:5},()=>`<div class="slot">${'<span></span>'.repeat(6)}</div>`).join('');
      const main=document.querySelector('.app-shell>main');
      if (main && !document.querySelector('.complete')) { const complete=document.createElement('section'); complete.className='complete'; complete.innerHTML='<h2>Level complete!</h2><button id="next">Next level</button>'; main.append(complete); }
    });
    const result = await page.evaluate(() => {
      const selectors=['header','.progress','.answers','.candidate','.wheel','#submit','#clear','#shuffle','#hint','.bonus','.complete','#next','#export','.import','#reset'];
      const bad=[]; for(const selector of selectors){const el=document.querySelector(selector); if(!el){bad.push(`${selector}:missing`);continue} const r=el.getBoundingClientRect(); if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)bad.push(`${selector}:outside`); if(el.matches('button,.import')&&(r.width<44||r.height<44))bad.push(`${selector}:touch-target`);}
      if(document.documentElement.scrollHeight>innerHeight)bad.push('vertical-scroll'); if(document.documentElement.scrollWidth>innerWidth)bad.push('horizontal-scroll'); return {bad,scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],viewport:[innerWidth,innerHeight]};
    });
    if(errors.length||result.bad.length) throw new Error(`${width}x${height} layout failed: ${JSON.stringify({errors,...result})}`);
    console.log(`layout ${width}x${height}: PASS (${result.scroll[0]}x${result.scroll[1]})`); await context.close();
  }
  await browser.close();
} finally { preview.kill('SIGTERM'); }
