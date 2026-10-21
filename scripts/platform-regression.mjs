// Browser contract checks use only synthetic keys and a local mock service.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mockModelReply } from './mock-models.mjs';
const name=process.argv[3]||'platforms';assert.match(name,/^[a-zA-Z0-9_-]+$/);
const out=resolve('output/playwright/ui',name);await mkdir(out,{recursive:true});const calls=[],report={checks:[],screenshots:[],errors:[]};let fail=false;
const server=createServer(async(req,res)=>{if(req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<title>Chrome extension guide</title><meta name="description" content="Chrome extension documentation">');return}let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');calls.push({original:req.headers['x-test-original-url'],headers:req.headers,body});res.setHeader('Content-Type','application/json');if(fail){res.writeHead(401);res.end('{}');return}res.end(JSON.stringify(mockModelReply(body.system?'/v1/messages':'/v1/chat/completions',body,[])))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const ctx=await chromium.launchPersistentContext(resolve('.browser-test',name+'-'+Date.now()),{executablePath:process.argv[2],headless:false,args:['--headless=new','--disable-extensions-except='+resolve('.output/chrome-mv3'),'--load-extension='+resolve('.output/chrome-mv3'),'--no-first-run'],viewport:{width:1280,height:900},reducedMotion:'reduce'});
const check=async(label,run)=>{await run();report.checks.push(label);console.log('PASS '+label)};let p;
try{
 ctx.on('page',page=>page.on('pageerror',e=>report.errors.push(e.message)));
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');await worker.evaluate(base=>{const original=globalThis.fetch;globalThis.fetch=(url,init)=>original(base+'/mock',{...init,headers:{...init.headers,'x-test-original-url':String(url)}})},base);
 const origin='chrome-extension://'+new URL(worker.url()).host;p=await ctx.newPage();await p.goto(origin+'/options.html#services');await p.locator('.config-reader').waitFor();await p.addStyleTag({content:':root{scrollbar-gutter:stable!important}'});
 const rpc=async command=>{const r=await p.evaluate(command=>chrome.runtime.sendMessage(command),command);assert(r.ok,r.error);return r.data};const windowId=await p.evaluate(async()=>(await chrome.windows.getCurrent()).id);const state=()=>rpc({type:'workspace-state',windowId});
 const platform=()=>p.getByLabel('服务平台',{exact:true}),key=()=>p.getByLabel('Chat 服务 API Key',{exact:true}),model=()=>p.getByLabel('模型名称',{exact:true}),test=()=>p.getByRole('button',{name:'测试 Chat 连接（不保存）',exact:true});
 const save=async()=>{await p.getByRole('button',{name:'保存配置',exact:true}).click();await p.getByText('已保存',{exact:true}).waitFor()};
 await check('Legacy custom URL and model stay editable and unchanged',async()=>{
  assert.equal(await platform().inputValue(),'custom-openai');await p.getByLabel('Base URL',{exact:true}).fill(base+'/custom/v1');await model().fill('my-custom-model');await key().fill('custom-test-key');await save();await p.reload();await platform().waitFor();assert.equal(await p.getByLabel('Base URL',{exact:true}).inputValue(),base+'/custom/v1');assert.equal(await model().inputValue(),'my-custom-model');
 });
 await check('Changing platform does not forward an old service key, even after clearing a new draft',async()=>{
  const before=calls.length;await platform().selectOption('deepseek');assert.equal(await p.getByLabel('Base URL',{exact:true}).count(),0);await test().click();await p.getByText('测试失败',{exact:true}).waitFor();assert.equal(calls.length,before);
  await key().fill('temporary-key');await key().fill('');await test().click();await p.getByText('测试失败',{exact:true}).waitFor();assert.equal(calls.length,before);assert.equal((await state()).settings.generator.baseUrl,base+'/custom/v1');
 });
 await check('Failed platform save preserves the full draft, and retry commits the same selection',async()=>{
  const before=await state();await platform().selectOption('openai');await key().fill('openai-test-key');
  await worker.evaluate(()=>{const original=chrome.storage.local.set.bind(chrome.storage.local);chrome.storage.local.set=items=>{if(items['workspace.v2']){chrome.storage.local.set=original;return Promise.reject(Error('模拟平台保存失败'))}return original(items)}});
  await p.getByRole('button',{name:'保存配置',exact:true}).click();await p.getByText('模拟平台保存失败',{exact:true}).waitFor();assert.equal(await platform().inputValue(),'openai');assert.equal(await key().inputValue(),'openai-test-key');assert.equal((await state()).revision,before.revision);await save();
 });
 const reference=await ctx.newPage();await reference.goto(base+'/reference');const candidate=await ctx.newPage();await candidate.goto(base+'/candidate');
 let fixture=await state();const member=fixture.tabs.find(tab=>tab.url===base+'/reference'),target=fixture.tabs.find(tab=>tab.url===base+'/candidate');await rpc({type:'create-manual',windowId,tabs:[member],value:{name:'插件开发',description:'Chrome extension development',color:'blue'}});
 // Creating a group advances the shared workspace revision. Begin editing from
 // the resulting revision, rather than deliberately triggering conflict protection.
 await p.reload();await platform().waitFor();
 const expected=[['openai','https://api.openai.com/v1/chat/completions','gpt-5.4-mini'],['gemini','https://generativelanguage.googleapis.com/v1beta/openai/chat/completions','gemini-3.8-flash'],['anthropic','https://api.anthropic.com/v1/messages','claude-sonnet-5-5'],['deepseek','https://api.deepseek.com/v1/chat/completions','deepseek-flash'],['qwen','https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions','qwen-plus'],['kimi','https://api.moonshot.cn/v1/chat/completions','kimi-k3'],['zhipu','https://open.bigmodel.cn/api/paas/v4/chat/completions','glm-5.3']];
 for(const [id,url,defaultModel]of expected)await check(id+': selecting a platform and entering only a key produces its preset request',async()=>{
  const before=await state();await platform().selectOption(id);assert.equal(await model().inputValue(),defaultModel);assert.equal(await p.getByLabel('Base URL',{exact:true}).count(),0);await key().fill(id+'-test-key');await test().click();await p.getByText('连接成功 · 当前草稿',{exact:true}).waitFor();
  const call=calls.at(-1);assert.equal(call.original,url);assert.equal(call.body.model,defaultModel);assert.equal(call.headers[id==='anthropic'?'x-api-key':'authorization'],id==='anthropic'?id+'-test-key':'Bearer '+id+'-test-key');assert.equal((await state()).revision,before.revision);
  if(id==='gemini')assert.equal(call.body.reasoning_effort,'low');if(id==='qwen'){assert.equal(call.body.enable_thinking,false);assert.equal(call.body.reasoning_effort,undefined)}if(id==='anthropic')assert.equal(call.headers['anthropic-version'],'2023-06-01');
  await save();await p.reload();await platform().waitFor();assert.equal(await platform().inputValue(),id);assert.equal(await model().inputValue(),defaultModel);assert.equal(await key().inputValue(),'');assert.equal((await state()).settings.generator.platform,id);assert.equal((await state()).hasGeneratorKey,true);
  await p.evaluate(id=>chrome.tabs.ungroup(id),target.id);const previous=(await state()).task?.id;await rpc({type:'organize',action:'organize-current',windowId,tabId:target.id});
  const deadline=Date.now()+20000;do{fixture=await state();if(fixture.task?.id!==previous&&fixture.task?.status!=='running'&&!fixture.busy)break;await delay(30)}while(Date.now()<deadline);
  assert.equal(fixture.task?.items[0]?.status,'applied',JSON.stringify(fixture.task));assert.equal(fixture.tabs.find(tab=>tab.id===target.id).groupId,fixture.tabs.find(tab=>tab.id===member.id).groupId);assert.equal(calls.at(-1).body.model,defaultModel);
  await p.reload();await platform().waitFor();
 });
 await check('Native preset model can be edited; edits invalidate the previous connection result',async()=>{
  await model().fill('glm-5.3-flash');await test().click();await p.getByText('连接成功 · 当前草稿',{exact:true}).waitFor();assert.equal(calls.at(-1).body.model,'glm-5.3-flash');await model().fill('glm-5.3');assert.equal(await p.getByText('连接成功 · 当前草稿',{exact:true}).count(),0);await save();
 });
 await check('Errors retain the selected platform, model, key draft and saved settings',async()=>{
  fail=true;const before=await state();await key().fill('bad-key');await test().click();await p.getByText('测试失败',{exact:true}).waitFor();assert.equal(await key().inputValue(),'bad-key');assert.equal(await platform().inputValue(),'zhipu');assert.equal((await state()).revision,before.revision);fail=false;await key().fill('zhipu-test-key');await save();
 });
 await check('Both custom-compatible modes expose URL editing and preserve connection details',async()=>{
  await platform().selectOption('custom-openai');assert.equal(await p.getByLabel('Base URL',{exact:true}).inputValue(),'https://open.bigmodel.cn/api/paas/v4');await p.getByLabel('Base URL',{exact:true}).fill(base+'/custom/v1');await model().fill('custom-model');await key().fill('custom-test-key');await save();
  await platform().selectOption('custom-anthropic');await p.getByLabel('Base URL',{exact:true}).fill(base+'/anthropic/v1');await model().fill('claude-sonnet-4-6');await test().click();await p.getByText('连接成功 · 当前草稿',{exact:true}).waitFor();assert.equal(calls.at(-1).original,base+'/anthropic/v1/messages');await save();await p.reload();await platform().waitFor();assert.equal(await platform().inputValue(),'custom-anthropic');
 });
 await check('Clearing a preset key remains possible and prevents subsequent native requests',async()=>{
  await platform().selectOption('openai');await key().fill('openai-test-key');await save();await p.getByRole('button',{name:'清除密钥',exact:true}).first().click();await p.getByRole('dialog').getByRole('button',{name:'标记清除',exact:true}).click();await save();assert.equal((await state()).hasGeneratorKey,false);const before=calls.length;await test().click();await p.getByText('测试失败',{exact:true}).waitFor();assert.equal(calls.length,before);await key().fill('openai-test-key');await save();
 });
 await check('Compact service fields fit Chinese/English, light/dark, wide/narrow layouts',async()=>{
  for(const locale of ['zh-CN','en'])for(const theme of ['light','dark'])for(const width of [1280,320]){
   await rpc({type:'save-ui-preferences',patch:{locale,theme}});await p.waitForFunction(({locale,theme})=>globalThis.document.documentElement.lang===locale&&globalThis.document.documentElement.dataset.theme===theme,{locale,theme});await p.setViewportSize({width,height:900});
   for(const id of ['openai','anthropic','gemini','custom-openai']){await p.getByLabel(locale==='zh-CN'?'服务平台':'Service platform',{exact:true}).selectOption(id);await p.locator('.config-service').first().scrollIntoViewIfNeeded();assert(await p.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth));const name=`${locale}-${theme}-${width}-${id}`;await p.locator('.config-service').first().screenshot({path:resolve(out,name+'.png'),animations:'disabled',style:':root{scrollbar-gutter:stable!important}'});report.screenshots.push(name)}
  }
 });
 assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;console.error(error);await p?.screenshot({path:resolve(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1}
finally{await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));await writeFile(resolve(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>服务平台配置</title><style>body{font:14px system-ui;margin:32px;background:#f5f7fb;color:#202a3b}figure{margin:32px 0}img{max-width:100%;border:1px solid #d7dfeb}</style><h1>服务平台配置</h1><p>预设平台自动填写地址、协议与模型；使用本地模拟接口验收。</p>${report.screenshots.map(name=>`<figure><figcaption>${name}</figcaption><img src="${name}.png"></figure>`).join('')}`);await ctx.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(report.checks.length+' platform checks passed; '+out);
