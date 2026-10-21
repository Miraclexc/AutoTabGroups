// Real native-tab scope checks; no model request is needed to inspect these lists.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root=process.argv[3]||'window-scope';assert.match(root,/^[a-zA-Z0-9_-]+$/);
const out=resolve('output/playwright/ui',root);await mkdir(out,{recursive:true});
const report={rounds:[],screenshots:[],errors:[]};let modelRequests=0;
const server=createServer((req,res)=>{if(req.method==='POST'){modelRequests++;res.writeHead(500);res.end();return}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<title>'+ (req.url.includes('long')?'Chrome extension interaction reference '.repeat(12):'Browser guide '+req.url) +'</title><p>Local scope fixture</p>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const poll=async(fn,accept,label)=>{const end=Date.now()+20000;let value;while(Date.now()<end){value=await fn();if(accept(value))return value;await delay(35)}throw Error(label+': '+JSON.stringify(value))};
try{for(let round=1;round<=3;round++){
 const ext=resolve('.output/chrome-mv3');const ctx=await chromium.launchPersistentContext(resolve('.browser-test',root+'-'+round+'-'+Date.now()),{executablePath:process.argv[2],headless:false,args:['--headless=new','--disable-extensions-except='+ext,'--load-extension='+ext,'--no-first-run'],viewport:{width:400,height:900},reducedMotion:'reduce'});
 try{
  ctx.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const page=await ctx.newPage();await page.goto('chrome-extension://'+id+'/sidepanel.html');await page.locator('.window-tab-scope').waitFor();
  const rpc=async command=>{const r=await page.evaluate(command=>chrome.runtime.sendMessage(command),command);if(!r.ok)throw Error(r.error);return r.data};
  const windowId=await page.evaluate(async()=>(await chrome.windows.getCurrent()).id);const state=()=>rpc({type:'workspace-state',windowId});
  let s=await state();await rpc({type:'save-config',settings:{...s.settings,generator:{...s.settings.generator,model:'unused-mock',baseUrl:base+'/v1'}},revision:s.revision});
  const ids=await page.evaluate(async base=>{
   const make=async path=>(await chrome.tabs.create({url:base+path,active:false})).id;
   const eligible=await make('/eligible'),long=await make('/long'),pinned=await make('/pinned'),grouped=await make('/grouped');
   await chrome.tabs.update(pinned,{pinned:true});const group=await chrome.tabs.group({tabIds:[grouped]});await chrome.tabGroups.update(group,{title:'参考资料',color:'blue'});
   const browser=(await chrome.tabs.create({url:'chrome://version/',active:false})).id;
   const unsupported=(await chrome.tabs.create({url:'data:text/html,<title>Unsupported fixture</title>',active:false})).id;
   await chrome.tabs.update(eligible,{active:true});return {eligible,long,pinned,grouped,group,browser,unsupported};
  },base);
  await poll(state,s=>s.tabs.some(t=>t.id===ids.unsupported)&&s.tabs.filter(t=>t.eligible).length===2,'Initial native fixture');
  const scope=page.locator('.window-tab-scope'),buttons=scope.locator('.scope-count'),panel=scope.getByRole('region');
  const counts=async()=> (await buttons.locator('strong').allTextContents()).map(Number);
  const settle=async()=>{const s=await state();await poll(counts,v=>v[0]===s.tabs.filter(t=>t.eligible).length&&v[1]===s.tabs.filter(t=>!t.eligible).length,'Counts match the runner');return s};
  s=await settle();assert.equal(await panel.isVisible(),false);assert.equal((await counts()).reduce((a,b)=>a+b,0),s.tabs.length);
  await buttons.nth(0).focus();await page.keyboard.press('Enter');await panel.waitFor();
  assert.deepEqual((await panel.locator('li').evaluateAll(rows=>rows.map(row=>Number(row.dataset.tabId)))).sort((a,b)=>a-b),[ids.eligible,ids.long].sort((a,b)=>a-b));
  await buttons.nth(1).click();assert.equal(await buttons.nth(0).getAttribute('aria-expanded'),'false');
  for(const [tabId,reason]of [[ids.pinned,'已固定'],[ids.grouped,'已分组 · 参考资料'],[ids.browser,'浏览器页面'],[ids.unsupported,'不支持此类网址']])await poll(()=>panel.locator('[data-tab-id="'+tabId+'"]').innerText(),text=>text.includes(reason),'Per-page exclusion reason');
  assert(await panel.innerText().then(t=>t.includes('扩展页面')));
  await panel.focus();await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);assert.equal(await buttons.nth(1).evaluate(el=>el===globalThis.document.activeElement),true);
  if(round===3){for(const locale of ['zh-CN','en'])for(const theme of ['light','dark'])for(const width of [400,320]){
   await rpc({type:'save-ui-preferences',patch:{locale,theme}});await page.waitForFunction(({locale,theme})=>globalThis.document.documentElement.lang===locale&&globalThis.document.documentElement.dataset.theme===theme,{locale,theme});await page.setViewportSize({width,height:900});
   for(const selected of [-1,0,1]){
    for(const b of await buttons.all())if(await b.getAttribute('aria-expanded')==='true')await b.click();
    if(selected!==-1)await buttons.nth(selected).click();
    assert(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth));const name='sidebar-'+locale+'-'+theme+'-'+width+'-'+['closed','eligible','excluded'][selected+1];
    await page.screenshot({path:resolve(out,name+'.png'),fullPage:true,animations:'disabled',style:':root{scrollbar-gutter:stable!important}'});report.screenshots.push(name);
   }
  }}
  await rpc({type:'save-ui-preferences',patch:{locale:'zh-CN',theme:'light'}});await page.waitForFunction(()=>globalThis.document.documentElement.lang==='zh-CN');await page.setViewportSize({width:400,height:900});
  await page.evaluate(id=>chrome.tabs.ungroup(id),ids.grouped);await poll(state,s=>s.tabs.some(t=>t.id===ids.grouped&&t.eligible),'Dragged-out tab eligibility');await settle();
  await buttons.nth(0).click();await poll(()=>panel.locator('[data-tab-id="'+ids.grouped+'"]').count(),n=>n===1,'Dragged-out page joins eligible list');
  await page.evaluate(id=>chrome.tabs.update(id,{pinned:true}),ids.eligible);await poll(state,s=>s.tabs.some(t=>t.id===ids.eligible&&t.pinned),'Pinned state');await settle();
  await buttons.nth(1).click();await poll(()=>panel.locator('[data-tab-id="'+ids.eligible+'"]').innerText(),text=>text.includes('已固定'),'Live pinned reason');
  const current=await state();await page.evaluate(async ids=>{for(const id of ids)await chrome.tabs.update(id,{pinned:true})},current.tabs.filter(t=>t.eligible).map(t=>t.id));await poll(state,s=>!s.tabs.some(t=>t.eligible),'Zero eligible pages');await settle();
  await buttons.nth(0).click();await panel.getByText('暂无可整理页面',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'更新分组',exact:true}).isDisabled(),true);
  await page.evaluate(async base=>{for(let i=0;i<18;i++)await chrome.tabs.create({url:base+'/many-'+i,active:false})},base);await poll(state,s=>s.tabs.filter(t=>t.eligible).length===18,'Large eligible list');await settle();
  await poll(()=>panel.locator('li').count(),n=>n===18,'Expanded list refresh');assert(await panel.evaluate(el=>el.scrollHeight>el.clientHeight));await panel.focus();await page.keyboard.press('End');
  await page.setViewportSize({width:200,height:450});assert(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth));if(round===3){await page.screenshot({path:resolve(out,'sidebar-layout-200.png'),fullPage:true,animations:'disabled',style:':root{scrollbar-gutter:stable!important}'});report.screenshots.push('sidebar-layout-200')}
  assert.equal(modelRequests,0);report.rounds.push({round,passed:true});console.log('PASS round '+round+': complete counts, per-page reasons, keyboard, live pin/ungroup, empty state and scrolling');
 }finally{await ctx.close()}
}
assert.deepEqual(report.errors,[]);
await writeFile(resolve(out,'report.json'),JSON.stringify({...report,modelRequests},null,2));await writeFile(resolve(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>本窗口页面范围</title><style>body{font:14px system-ui;background:#f5f7fb;color:#202a3b;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}figure{margin:0}img{max-width:100%;border:1px solid #d7dfeb}a{color:#245edb}</style><h1>本窗口页面范围</h1><p>数量与后台实际资格一致；三轮原生标签变更、键盘与布局验收，无模型请求。</p><main>${report.screenshots.map(name=>`<figure><a href="${name}.png"><img loading="lazy" src="${name}.png"></a><figcaption>${name}</figcaption></figure>`).join('')}</main>`);
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
