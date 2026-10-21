// Real extension reader configuration and pipeline, using local services only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { mockModelReply } from './mock-models.mjs';
const round=process.argv[3]||'reader-regression';assert.match(round,/^[a-zA-Z0-9_-]+$/);
const out=resolve('output/playwright/ui',round);await mkdir(out,{recursive:true});
const calls=[],report={checks:[],screenshots:[],errors:[]};let failReader=false;
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url.startsWith('/page/')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<title>Chrome extension guide</title><meta name="description" content="Chrome extension development"><article>'+('<p>Chrome extension development with side panels, accessibility and keyboard shortcuts. Local page content for a browser guide.</p>'.repeat(25))+'</article>');return}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');calls.push({path:req.url,body,auth:req.headers.authorization});
 if(req.url==='/extract'||req.url==='/fetch'){
  if(failReader){res.writeHead(503);res.end('{}');return}
  res.end(JSON.stringify(req.url==='/extract'?{results:[{url:body.urls[0],raw_content:'Chrome extension development REMOTE_TAVILY '+ 'article '.repeat(150)}]}:{title:'Fetched title',content:'Chrome extension development REMOTE_DEEPSEEK '+ 'article '.repeat(150)}));return
 }
 res.end(JSON.stringify(mockModelReply(req.url,body,[{name:'浏览器开发',description:'Chrome extension development',include:[],exclude:[],color:'blue'}])));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let ctx,p;
const poll=async(fn,test,name)=>{const end=Date.now()+20000;let v;while(Date.now()<end){v=await fn();if(test(v))return v;await delay(30)}throw Error(name+': '+JSON.stringify(v))};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name)};
try {
 const ext=resolve('.output/chrome-mv3');ctx=await chromium.launchPersistentContext(resolve('.browser-test',round+'-'+Date.now()),{executablePath:process.argv[2],headless:false,args:['--headless=new','--disable-extensions-except='+ext,'--load-extension='+ext,'--no-first-run'],viewport:{width:1280,height:900},reducedMotion:'reduce'});
 ctx.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 await worker.evaluate(() => { const originalFetch=globalThis.fetch;globalThis.fetch=(url,init)=>{if(new URL(String(url)).hostname!=='127.0.0.1')return Promise.reject(new Error('Test blocked non-local request'));return originalFetch(url,init)}; });
 p=await ctx.newPage();await p.goto('chrome-extension://'+id+'/options.html');await p.getByRole('tab',{name:'服务',exact:true}).click();await p.locator('#model-settings').waitFor();
 const rpc=async q=>{const r=await p.evaluate(q=>chrome.runtime.sendMessage(q),q);if(!r.ok)throw Error(r.error);return r.data};
 const windowId=await p.evaluate(async()=>(await chrome.windows.getCurrent()).id);const state=()=>rpc({type:'workspace-state',windowId});
 const openAdvanced=()=>p.getByRole('tab',{name: /^(高级|Advanced)$/}).click();
 const openServices=()=>p.getByRole('tab',{name: /^(服务|Services)$/}).click();
 const save=async()=>{await p.getByRole('button',{name:'保存配置',exact:true}).click();await p.getByText('已保存',{exact:true}).waitFor();};
 await check('Three primary tabs, reading inside Services, advanced fields outside everyday setup',async()=>{
  assert.equal(await p.getByRole('tab').count(),3);assert.equal(await p.getByRole('button',{name:'整理与读取',exact:true}).count(),0);
  assert.equal(await p.getByLabel('最低归组分数',{exact:true}).count(),0);assert.equal(await p.getByRole('checkbox',{name:'读取网页正文',exact:true}).isChecked(),false);
  assert.equal(await p.getByLabel('正文读取方式',{exact:true}).count(),0);
 });
 await check('Content checkbox reveals all readers and conditional API fields without saving or requests',async()=>{
  const before=await state(),requests=calls.length;const toggle=p.getByRole('checkbox',{name:'读取网页正文',exact:true});
  const controlled=toggle.getAttribute('aria-controls');await toggle.focus();await p.keyboard.press('Space');
  assert.equal(await toggle.isChecked(),true);assert.equal(await p.locator('[id="'+await controlled+'"]').isVisible(),true);
  assert.deepEqual(await p.getByLabel('正文读取方式',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(node=>node.value)),['local','tavily','deepseek']);
  assert.equal(await p.getByLabel('读取接口 URL',{exact:true}).count(),0);
  for(const [provider,key,path]of [['deepseek','DeepSeek Fetch API Key','/fetch'],['tavily','Tavily API Key','/extract']]){
   await p.getByLabel('正文读取方式',{exact:true}).selectOption(provider);await p.getByLabel(key,{exact:true}).waitFor();
   await p.getByLabel('读取接口 URL',{exact:true}).fill(base+path);assert.equal(await p.getByLabel(key,{exact:true}).getAttribute('type'),'password');
   await p.getByRole('button',{name:'测试读取接口（不保存）',exact:true}).waitFor();
  }
  await toggle.uncheck();assert.equal(await p.getByLabel('正文读取方式',{exact:true}).count(),0);assert.equal(await p.getByLabel('读取接口 URL',{exact:true}).count(),0);
  await toggle.check();assert.equal(await p.getByLabel('正文读取方式',{exact:true}).inputValue(),'tavily');assert.equal(await p.getByLabel('读取接口 URL',{exact:true}).inputValue(),base+'/extract');
  await p.getByLabel('正文读取方式',{exact:true}).selectOption('local');await toggle.uncheck();
  assert.equal(calls.length,requests);assert.equal((await state()).revision,before.revision);assert.equal((await state()).settings.readContent,false);
 });
 await check('A background refresh cannot overwrite a newly edited model endpoint',async()=>{
  await p.getByLabel('Base URL',{exact:true}).fill(base+'/v1');
  await p.evaluate(()=>chrome.storage.local.set({'reader.test.refresh':Date.now()}));
  await p.getByLabel('模型名称',{exact:true}).fill('mock-chat');
  await p.getByRole('tab',{name:'常规',exact:true}).click();await openAdvanced();await p.getByLabel('最低归组分数',{exact:true}).fill('0.85');
  await openServices();
  assert.equal(await p.getByLabel('Base URL',{exact:true}).inputValue(),base+'/v1');await save();
  assert.equal((await state()).settings.generator.baseUrl,base+'/v1');assert.equal((await state()).settings.minProbability,0.85);
 });
 assert.equal((await state()).settings.generator.baseUrl,base+'/v1','Initial model URL was not saved');
 await p.getByRole('checkbox',{name:'读取网页正文',exact:true}).check();await p.getByLabel('正文读取方式',{exact:true}).selectOption('tavily');
 await p.getByLabel('读取接口 URL',{exact:true}).fill(base+'/extract');await p.getByLabel('Tavily API Key',{exact:true}).fill('tavily-test-key');
 await check('Reader test uses the draft and example.com without saving or reading tabs',async()=>{
  const before=await state();await p.getByRole('button',{name:'测试读取接口（不保存）',exact:true}).click();await p.getByText('连接成功 · 当前草稿',{exact:true}).waitFor();
  assert.equal((await state()).revision,before.revision);assert.equal((await state()).settings.readContent,false);assert.equal((await state()).hasReaderKeys.tavily,false);
  assert.deepEqual(calls.at(-1).body.urls,['https://example.com/']);assert.equal(calls.at(-1).auth,'Bearer tavily-test-key');
  await p.getByLabel('读取接口 URL',{exact:true}).fill(base+'/extract?invalid');assert.equal(await p.getByText('连接成功 · 当前草稿',{exact:true}).count(),0);
  await p.getByLabel('读取接口 URL',{exact:true}).fill(base+'/extract');await save();
 });
 await check('Reader selection and credentials persist, while exports omit credentials',async()=>{
  await p.reload();await p.getByLabel('正文读取方式',{exact:true}).waitFor();assert.equal(await p.getByLabel('正文读取方式',{exact:true}).inputValue(),'tavily');
  assert.equal(await p.getByRole('checkbox',{name:'读取网页正文',exact:true}).isChecked(),true);
  assert.equal(await p.getByLabel('Tavily API Key',{exact:true}).inputValue(),'');assert.equal((await state()).hasReaderKeys.tavily,true);
  assert(!JSON.stringify(await rpc({type:'export-config'})).includes('tavily-test-key'));
 });
 const first=await ctx.newPage();await first.goto(base+'/page/group');const second=await ctx.newPage();await second.goto(base+'/page/candidate');
 let s=await state();const member=s.tabs.find(t=>t.url.endsWith('/page/group'));const target=s.tabs.find(t=>t.url.endsWith('/page/candidate'));
 await rpc({type:'create-manual',windowId,tabs:[member],value:{name:'浏览器开发',description:'Chrome extension development',color:'blue'}});
 const run=async()=>{
  report.settingsAtRun=(await state()).settings;assert.equal(report.settingsAtRun.generator.baseUrl,base+'/v1','Saved model URL unexpectedly changed');
  await p.evaluate(id=>chrome.tabs.ungroup(id),target.id);const before=(await state()).task?.id;
  await rpc({type:'organize',action:'organize-current',windowId,tabId:target.id});
  const result=await poll(state,s=>s.task?.id!==before&&s.task?.status!=='running'&&!s.busy,'Task completion');
  await p.reload();await openServices(); await p.locator('#model-settings').waitFor();
  return result;
 };
 await check('Tavily content actually reaches the classifier; browser grouping succeeds',async()=>{
  const result=await run();assert.equal(result.task.items[0].extraction,'tavily');assert.equal(result.task.items[0].status,'applied',JSON.stringify(result.task.items[0]));
  assert(calls.some(c=>c.path==='/v1/chat/completions'&&JSON.stringify(c.body).includes('REMOTE_TAVILY')));
 });
 await check('DeepSeek uses its independent endpoint/key and returns content to the classifier',async()=>{
  await p.getByLabel('正文读取方式',{exact:true}).selectOption('deepseek');await p.getByLabel('读取接口 URL',{exact:true}).fill(base+'/fetch');await p.getByLabel('DeepSeek Fetch API Key',{exact:true}).fill('deepseek-test-key');await save();
  const result=await run();assert.equal(result.task.items[0].extraction,'deepseek');assert.equal(result.task.items[0].status,'applied');
  assert(calls.some(c=>c.path==='/fetch'&&c.auth==='Bearer deepseek-test-key'&&c.body.url===target.url));
  assert(calls.some(c=>c.path==='/v1/chat/completions'&&JSON.stringify(c.body).includes('REMOTE_DEEPSEEK')));
 });
 await check('Optional fallback works, and disabling it leaves a failed page ungrouped',async()=>{
  failReader=true;const fallback=await run();assert.equal(fallback.task.items[0].extraction,'readability');assert.equal(fallback.task.items[0].status,'applied');
  await openAdvanced();await p.getByLabel('远程失败时使用本地读取兜底',{exact:false}).uncheck();await save();
  const failed=await run();assert.equal(failed.task.items[0].status,'failed');assert(failed.tabs.find(t=>t.id===target.id).groupId===-1);failReader=false;
 });
 await check('Failed reader connection test preserves API drafts and saved settings',async()=>{
  const before=await state();failReader=true;await openServices();await p.getByLabel('DeepSeek Fetch API Key',{exact:true}).fill('deepseek-test-key');
  await p.getByRole('button',{name:'测试读取接口（不保存）',exact:true}).click();await p.getByText('测试失败',{exact:true}).waitFor();
  assert.equal(await p.getByLabel('读取接口 URL',{exact:true}).inputValue(),base+'/fetch');assert.equal(await p.getByLabel('DeepSeek Fetch API Key',{exact:true}).inputValue(),'deepseek-test-key');
  assert.equal((await state()).revision,before.revision);failReader=false;
 });
 await check('Basic and local modes make no remote-reader requests',async()=>{
  for(const mode of ['basic','local']){
   if(mode==='basic')await p.getByRole('checkbox',{name:'读取网页正文',exact:true}).uncheck();else{await p.getByRole('checkbox',{name:'读取网页正文',exact:true}).check();await p.getByLabel('正文读取方式',{exact:true}).selectOption('local')}
   await save();const before=calls.filter(c=>['/extract','/fetch'].includes(c.path)).length;await run();assert.equal(calls.filter(c=>['/extract','/fetch'].includes(c.path)).length,before);
  }
 });
 await check('Provider switching preserves saved reader keys and merged advanced fields',async()=>{
  await p.getByLabel('正文读取方式',{exact:true}).selectOption('tavily');assert.equal(await p.getByLabel('读取接口 URL',{exact:true}).inputValue(),base+'/extract');
  await openAdvanced();
  await p.getByLabel('Tavily 提取深度',{exact:true}).selectOption('advanced');await p.getByLabel('远程读取超时（秒）',{exact:true}).fill('12');await save();
  assert.equal((await state()).settings.reader.tavily.depth,'advanced');assert.equal((await state()).settings.reader.timeoutSeconds,12);
  const result=await run();assert.equal(result.task.items[0].extraction,'tavily');assert.equal(calls.filter(c=>c.path==='/extract').at(-1).body.extract_depth,'advanced');
 });
 await check('Merged form layout, advanced content and focus at 320/1280 pixels',async()=>{
  for(const locale of ['zh-CN','en'])for(const theme of ['light','dark'])for(const width of [1280,320]){
   await rpc({type:'save-ui-preferences',patch:{locale,theme}});await p.waitForFunction(({locale,theme})=>globalThis.document.documentElement.lang===locale&&globalThis.document.documentElement.dataset.theme===theme,{locale,theme});await p.setViewportSize({width,height:900});
   for(const open of [false,true]){if(open)await openAdvanced();else await openServices();
    const name='models-'+locale+'-'+theme+'-'+width+(open?'-advanced':'');await p.screenshot({path:resolve(out,name+'.png'),fullPage:true,animations:'disabled',style:':root{scrollbar-gutter:stable!important}'});report.screenshots.push(name);
    if(open)await p.locator('.config-global-advanced').scrollIntoViewIfNeeded();else await p.locator('.config-reader').scrollIntoViewIfNeeded();
    await p.screenshot({path:resolve(out,name+'-viewport.png'),fullPage:false,animations:'disabled'});
    assert(await p.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth));
   }
  }
 });
 await check('Checkbox and each reader remain clear in both languages, themes and widths',async()=>{
  for(const locale of ['zh-CN','en'])for(const theme of ['light','dark'])for(const width of [1280,320]){
   await rpc({type:'save-ui-preferences',patch:{locale,theme}});await p.waitForFunction(({locale,theme})=>globalThis.document.documentElement.lang===locale&&globalThis.document.documentElement.dataset.theme===theme,{locale,theme});await p.setViewportSize({width,height:900});await openServices();
   const toggle=p.getByRole('checkbox',{name:locale==='zh-CN'?'读取网页正文':'Read page content',exact:true});
   for(const mode of ['off','local','tavily','deepseek']){
    await toggle.setChecked(mode!=='off');if(mode!=='off')await p.getByLabel(locale==='zh-CN'?'正文读取方式':'Content reader',{exact:true}).selectOption(mode);
    await p.locator('.config-reader').scrollIntoViewIfNeeded();assert(await p.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth));
    const name='reading-'+locale+'-'+theme+'-'+width+'-'+mode;await p.locator('.config-reader').screenshot({path:resolve(out,name+'.png'),animations:'disabled',style:':root{scrollbar-gutter:stable!important}'});report.screenshots.push(name);
   }
  }
 });
 assert.deepEqual(report.errors,[]);
} catch(e){report.failure=e.stack;report.calls=calls;if(p)report.saved=await p.evaluate(async()=>{const w=await chrome.windows.getCurrent();return chrome.runtime.sendMessage({type:'workspace-state',windowId:w.id})}).catch(()=>null);console.error(e);await p?.screenshot({path:resolve(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1}
finally {await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await ctx?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(report.checks.length+' reader checks passed; '+out);
