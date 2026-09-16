import { spawn } from 'node:child_process';
import { chromium, webkit } from 'playwright';

const port = 4174;
const base = `http://127.0.0.1:${port}/word-connect-pwa/`;
const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite','preview','--host','127.0.0.1','--port',String(port)], { stdio: 'ignore', detached: process.platform !== 'win32' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  for (let i=0;i<50;i++) { try { if ((await fetch(base)).ok) break; } catch {} await sleep(100); if(i===49) throw new Error('preview did not start'); }
  const cases = [[393,659],[320,568],[390,844],[360,640]];
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
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
      const check = async (name, selectors) => page.evaluate(({name,selectors}) => {
        const bad=[]; for(const selector of selectors){const el=document.querySelector(selector); if(!el){bad.push(`${selector}:missing`);continue} const r=el.getBoundingClientRect(); if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)bad.push(`${selector}:outside`); if(el.matches('button,.import')&&(r.width<44||r.height<44))bad.push(`${selector}:touch-target`);}
        if(document.documentElement.scrollHeight>innerHeight)bad.push('vertical-scroll'); if(document.documentElement.scrollWidth>innerWidth)bad.push('horizontal-scroll'); return {name,bad,scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],viewport:[innerWidth,innerHeight]};
      }, {name, selectors});
      const gameplay = await check('gameplay', ['header','.progress','.answers','.candidate','.wheel','#submit','#clear','#shuffle','#hint','.bonus','.complete','#next','#settings']);
      await page.click('#hint');
      const hint = await check('hint', ['.sheet','.sheet-close','.hint-choice[data-hint-kind="letter"]','.hint-choice[data-hint-kind="first-letter"]','.hint-choice[data-hint-kind="word"]']);
      await page.click('.sheet-close');
      await page.click('#settings');
      const settings = await check('settings', ['.sheet','.sheet-close','#export','.import','#reset','.build-meta']);
      if(errors.length||gameplay.bad.length||hint.bad.length||settings.bad.length) throw new Error(`${engineName} ${width}x${height} layout failed: ${JSON.stringify({errors,gameplay,hint,settings})}`);
      console.log(`layout ${engineName} ${width}x${height}: PASS (${gameplay.scroll[0]}x${gameplay.scroll[1]})`); await context.close();
    }
    await browser.close();
  }
} finally {
  if (process.platform !== 'win32' && preview.pid) { try { process.kill(-preview.pid, 'SIGTERM'); } catch {} }
  else preview.kill('SIGTERM');
}
