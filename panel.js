const $ = s => document.querySelector(s);
const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const newReq = n => ({name:'Request '+n,method:'GET',url:'',headers:'',body:'',status:'',contains:'',maxMs:'',extract:''});
// Recorded traffic is replayed as-is: it must not be given invented "200 / 2000 ms" assertions,
// which would flag redirects (302), 204s and slow logins as failures.
const withDefaults = r => { if(r.recorded) return r; if(!r.status&&!r.contains&&!r.maxMs&&!(r.extract||'').trim()){ r.status='200'; r.maxMs='2000'; } jsonBody(r); return r; };
function jsonBody(r){ if(!['GET','HEAD'].includes(r.method)){ if(!r.body) r.body='{}'; if(!r.headers.trim()) r.headers='Content-Type: application/json'; } }
const DEF = {name:'My test plan',threads:10,rampUp:5,think:0,thinkMax:0,cookies:true,mode:'duration',loops:10,duration:30,vars:'',data:'',csvMode:'rotate',pctls:'50,90,95,99',maxErrPct:'',maxP95Ms:'',minRps:'',requests:[newReq(1)]};
let plan = JSON.parse(JSON.stringify(DEF));
let running=false, controllers=new Set(), results=[], t0=0, active=0, lastLog=[], shown=null, tick=0, view='quick', rec=null, baseline=null;
const save = () => chrome.storage.local.set({plan});
const TEXT=['planName','threads','rampUp','think','thinkMax','loops','duration','vars','data','csvMode','pctls','maxErrPct','maxP95Ms','minRps'];

function fillForm(){
  TEXT.forEach(k=>{ $('#'+k).value = k==='planName'?plan.name:plan[k]; });
  $('#cookies').checked=!!plan.cookies;
  document.querySelector(`input[name=mode][value=${plan.mode}]`).checked=true; renderReqs(); fillQuick(); updateSessionWarn();
}
function readForm(){
  plan.name=$('#planName').value.trim()||'Untitled plan';
  plan.threads=Math.min(200,Math.max(1,+$('#threads').value||1));
  plan.rampUp=Math.max(0,+$('#rampUp').value||0); plan.think=Math.max(0,+$('#think').value||0); plan.thinkMax=Math.max(0,+$('#thinkMax').value||0);
  plan.loops=Math.max(1,+$('#loops').value||1); plan.duration=Math.max(1,+$('#duration').value||1);
  plan.vars=$('#vars').value; plan.data=$('#data').value; plan.cookies=$('#cookies').checked;
  plan.pctls=$('#pctls').value.trim(); plan.maxErrPct=$('#maxErrPct').value.trim(); plan.maxP95Ms=$('#maxP95Ms').value.trim(); plan.minRps=$('#minRps').value.trim();
  plan.csvMode=$('#csvMode').value; updateSessionWarn();
  plan.mode=document.querySelector('input[name=mode]:checked').value; save();
}
document.querySelectorAll('#planName,#threads,#rampUp,#think,#thinkMax,#loops,#duration,#vars,#data,#cookies,#csvMode,#pctls,#maxErrPct,#maxP95Ms,#minRps,input[name=mode]').forEach(e=>e.addEventListener('input',readForm));
// One shared browser cookie jar means cookie logins cannot be isolated per user - say so plainly.
function updateSessionWarn(){ const w=$('#sessWarn'); if(!w) return; const t=cookieWarning(plan); w.textContent=t; w.hidden=!t; }

function renderReqs(){
  $('#reqs').innerHTML = plan.requests.map((r,i)=>`
  <div class="req" data-i="${i}">
    <div class="line">
      <div><label class="f">Name</label><input class="inp" data-f="name" value="${esc(r.name)}"></div>
      <div><label class="f">Method</label><select data-f="method">${['GET','POST','PUT','PATCH','DELETE','HEAD'].map(m=>`<option${m===r.method?' selected':''}>${m}</option>`).join('')}</select></div>
    </div>
    <div class="blk"><label class="f">URL</label><input class="inp" data-f="url" placeholder="https://api.example.com/products" value="${esc(r.url)}"></div>
    <div class="blk"><label class="f">Headers (Key: Value per line)</label><textarea data-f="headers">${esc(r.headers)}</textarea></div>
    <div class="blk"><label class="f">Body</label><textarea data-f="body">${esc(r.body)}</textarea></div>
    <div class="asserts">
      <div><label class="f">Expected status</label><input class="inp" data-f="status" placeholder="200" value="${esc(r.status)}"></div>
      <div><label class="f">Contains text</label><input class="inp" data-f="contains" value="${esc(r.contains)}"></div>
      <div><label class="f">Max ms</label><input class="inp" data-f="maxMs" value="${esc(r.maxMs)}"></div>
    </div>
    <div class="blk"><label class="f">Extract variables (name = json:path | regex:pattern | header:Name | cookie:Name | auto)</label><textarea data-f="extract" placeholder="token = auto">${esc(r.extract||'')}</textarea></div>
    <div class="acts"><button class="btn purple sm" data-auto="${i}">Auto-fill from response</button><button class="btn light sm" data-del="${i}"${plan.requests.length<2?' disabled':''}>Remove</button></div>
  </div>`).join('');
}
$('#reqs').addEventListener('input',e=>{ const c=e.target.closest('.req'); if(!c||!e.target.dataset.f) return; const r=plan.requests[+c.dataset.i]; r[e.target.dataset.f]=e.target.value; if(e.target.dataset.f==='method'){ jsonBody(r); renderReqs(); } save(); });
$('#reqs').addEventListener('click',e=>{ const d=e.target.dataset.del; if(d!==undefined){ plan.requests.splice(+d,1); save(); renderReqs(); } if(e.target.dataset.auto!==undefined) autofill(+e.target.dataset.auto,e.target); });
$('#addReq').onclick=()=>{ plan.requests.push(withDefaults(newReq(plan.requests.length+1))); save(); renderReqs(); };

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const pct = (a,p)=>a.length?a[Math.min(a.length-1,Math.ceil(p/100*a.length)-1)]:0;
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
function needAuth(){ notice('Tick the authorization box below the test name first.'); const a=$('#authRow'); a.scrollIntoView({behavior:'smooth',block:'center'}); a.classList.add('flash'); setTimeout(()=>a.classList.remove('flash'),2500); }
async function autofill(i,btn){
  readForm(); const r=plan.requests[i], vars=parseVars(plan.vars), url=subst(r.url,vars).trim();
  if(!/^https?:\/\//i.test(url)) return notice('Enter a full http(s) URL for this request first.');
  jsonBody(r);
  if(!['GET','HEAD'].includes(r.method)){ if(!r.status) r.status='200'; if(!r.maxMs) r.maxMs='2000'; save(); renderReqs(); return notice('Filled defaults. Only GET requests are sent to read a real response.',true); }
  if(!$('#auth').checked) return needAuth();
  btn.disabled=true; btn.textContent='Reading response...';
  try{
    const t=performance.now(); const res=await fetch(url,{method:r.method,headers:parseHeaders(subst(r.headers,vars)),cache:'no-store',credentials:plan.cookies?'include':'omit'});
    const text=await res.text(), ms=performance.now()-t, ct=res.headers.get('content-type')||'';
    r.status=String(res.status); r.maxMs=String(Math.max(500,Math.ceil(ms*3/100)*100));
    if(/json/i.test(ct)){
      try{ const j=JSON.parse(text), o=Array.isArray(j)?(j[0]||{}):j, keys=Object.keys(o||{});
        if(!r.contains&&keys[0]) r.contains='"'+keys[0]+'"';
        const found=[]; const scan=(obj,p)=>{ for(const k of Object.keys(obj||{})){ if(found.length>=3) return; const v=obj[k], path=p?p+'.'+k:k;
          if(/^(access_?token|token|id|session_?id|csrf\w*|auth\w*)$/i.test(k)&&typeof v!=='object') found.push(`${k} = json:${Array.isArray(j)?'[0].'+path:path}`.replace(':[0].',':[0].')); else if(v&&typeof v==='object'&&!Array.isArray(v)&&!p) scan(v,path); } };
        scan(o,''); if(!r.extract.trim()&&found.length) r.extract=found.join('\n'); }catch{}
    } else if(!r.contains){ const m=/<title[^>]*>([^<]{1,60})/i.exec(text); if(m) r.contains=m[1].trim(); }
    save(); renderReqs(); notice(`Filled from a live response (${res.status}, ${ms.toFixed(0)} ms). Review the values before running.`,true);
  }catch(e){ notice('Could not read a response: '+(e.message||e)); btn.disabled=false; btn.textContent='Auto-fill from response'; }
}
function notice(m,ok){ const n=$('#notice'); n.textContent=m||''; n.hidden=!m; n.className=ok?'ok':''; }
function log(m){ lastLog.push(new Date().toLocaleTimeString()+'  '+m); if(lastLog.length>120) lastLog.shift(); const l=$('#log'); l.textContent=lastLog.join('\n'); l.scrollTop=l.scrollHeight; }
function parseHeaders(t){ const h={}; t.split('\n').forEach(l=>{const i=l.indexOf(':'); if(i>0) h[l.slice(0,i).trim()]=l.slice(i+1).trim();}); return h; }
function parseVars(t){ const o={}; t.split('\n').forEach(l=>{const i=l.indexOf('='); if(i>0) o[l.slice(0,i).trim()]=l.slice(i+1).trim();}); return o; }
function parseCsv(t){ const L=t.trim().split(/\r?\n/).filter(Boolean); if(L.length<2) return []; const h=L[0].split(',').map(s=>s.trim());
  return L.slice(1).map(l=>{const c=l.split(','),o={}; h.forEach((k,i)=>o[k]=(c[i]??'').trim()); return o;}); }
function subst(s,v){ return String(s??'').replace(/\$\{([^}]+)\}/g,(m,k)=>{
  const u=/^__urlencode:(.+)$/.exec(k); if(u) return encodeURIComponent(v[u[1]]==null?'':v[u[1]]);
  if(k in v) return v[k]; if(k==='__random') return Math.floor(Math.random()*1e6); if(k==='__uuid') return crypto.randomUUID(); if(k==='__timestamp') return Date.now(); return m; }); }
const TOKEN_NAME=/(csrf|xsrf|token|auth|jwt|session)/i;
// Cookie-based tokens (Angular/Laravel XSRF-TOKEN and friends) can't be read from a fetch response,
// so when a rule says "auto" we also look for a token-looking cookie the server just set for this URL.
async function cookieToken(url){
  try{ if(!url||!chrome.cookies) return null;
    const list=await chrome.cookies.getAll({url});
    const hit=(list||[]).find(c=>TOKEN_NAME.test(c.name)&&c.value&&c.value.length>=12);
    return hit?hit.value:null; }catch{ return null; }
}
async function extract(req,res,text,vars){
  const {vars:got,miss}=await runExtract((req.extract||'').split('\n'),{
    text,
    header:n=>{ try{ return res.headers.get(n); }catch{ return undefined; } },
    cookie:async n=>{ try{ const c=await chrome.cookies.get({url:res.url||req.url,name:n}); return c&&c.value; }catch{ return undefined; } },
    auto:async()=>pickToken(text,res.headers)||await cookieToken(res.url||req.url) });
  Object.assign(vars,got);
  return miss;
}

async function sample(req,idx,vars){
  const ac=new AbortController(); controllers.add(ac); const to=setTimeout(()=>ac.abort(),30000);
  const start=performance.now(); const rec={t:Date.now(),idx,name:req.name,status:0,ms:0,ok:false,bytes:0,err:''};
  try{
    const init={method:req.method,headers:parseHeaders(subst(req.headers,vars)),cache:'no-store',credentials:plan.cookies?'include':'omit',signal:ac.signal};
    if(!['GET','HEAD'].includes(req.method)&&req.body) init.body=subst(req.body,vars);
    const res=await fetch(subst(req.url,vars),init); const text=await res.text();
    rec.ms=performance.now()-start; rec.status=res.status; rec.bytes=text.length;
    let ok = req.status.trim()? String(res.status)===req.status.trim() : res.status<400;
    if(!ok) rec.err='status '+res.status;
    if(ok&&req.contains&&!text.includes(subst(req.contains,vars))){ok=false;rec.err='missing text';}
    if(ok&&req.maxMs&&rec.ms>+req.maxMs){ok=false;rec.err='slower than '+req.maxMs+' ms';}
    const miss=await extract(req,res,text,vars); if(ok&&miss.length){ok=false;rec.err='could not extract '+miss.join(', ');}
    rec.ok=ok;
  }catch(e){ rec.ms=performance.now()-start; rec.err=e.name==='AbortError'&&running?'timeout':(e.message||'network error'); }
  clearTimeout(to); controllers.delete(ac);
  if(!rec.ok&&running) log(`${rec.name}: ${rec.err}`);
  if(results.length<300000) results.push(rec);
}

async function user(n,end,base,rows){
  await sleep(plan.threads>1?n*plan.rampUp*1000/plan.threads:0); active++;
  const vars=newUser(base,n);
  for(let loop=0; running; loop++){
    if(plan.mode==='loops'? loop>=plan.loops : Date.now()>=end) break;
    bindRow(vars,rows,n,loop,plan.csvMode,plan.threads); vars.__loop=loop+1;
    for(let i=0;i<plan.requests.length&&running;i++){
      await sample(plan.requests[i],i,vars);
      const d=plan.think+(plan.thinkMax>plan.think?Math.random()*(plan.thinkMax-plan.think):0); if(d>0&&running) await sleep(d);
    }
  }
  active--;
}

// Requests sent from the extension carry "Origin: chrome-extension://...", which many servers reject on
// POST/PUT/DELETE (CSRF/CORS checks) even though the same GET works. Present the site's own origin instead.
async function setOriginRules(vars){
  const origins=new Map();
  plan.requests.forEach(r=>{ try{ const u=new URL(subst(r.url,vars).trim()); origins.set(u.hostname,u.origin); }catch{} });
  const old=(await chrome.declarativeNetRequest.getSessionRules()).map(x=>x.id);
  const addRules=[...origins].map(([host,origin],i)=>({id:i+1,priority:1,
    action:{type:'modifyHeaders',requestHeaders:[{header:'origin',operation:'set',value:origin},{header:'referer',operation:'set',value:origin+'/'}]},
    condition:{requestDomains:[host],resourceTypes:['xmlhttprequest'],tabIds:[-1]}}));
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:old,addRules});
}
async function clearOriginRules(){
  try{ const old=(await chrome.declarativeNetRequest.getSessionRules()).map(x=>x.id); await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:old}); }catch{}
}
async function start(){
  readForm();
  if(!$('#auth').checked) return needAuth();
  const bad=plan.requests.find(r=>!/^(https?:\/\/|\$\{)/i.test(r.url.trim())); if(bad) return notice(`"${bad.name}" needs a full http(s) URL.`);
  notice(''); plan.requests.forEach(r=>r.url=r.url.trim());
  running=true; results=[]; lastLog=[]; t0=Date.now(); active=0; tick=0;
  $('#start').disabled=true; $('#stop').hidden=false; $('#results').scrollIntoView({behavior:'smooth'}); log(`Started "${plan.name}" with ${plan.threads} users.`);
  const end=t0+(plan.duration+plan.rampUp)*1000, base=parseVars(plan.vars), rows=parseCsv(plan.data);
  try{ await setOriginRules(base); }catch(e){ log('Could not set the Origin header: '+(e.message||e)); }
  const timer=setInterval(()=>{ if(results.length<50000||++tick%4===0) show(summarize()); },500);
  await Promise.all(Array.from({length:plan.threads},(_,n)=>user(n,end,base,rows)));
  clearInterval(timer); await clearOriginRules(); log(running?'Test complete.':'Test stopped.'); running=false;
  const S=summarize(true); show(S); if(S.total) pushHistory(S);
  $('#start').disabled=false; $('#stop').hidden=true;
}
$('#start').onclick=start;
$('#stop').onclick=()=>{ running=false; controllers.forEach(a=>a.abort()); };

function summarize(final){
  const P=parsePctls(plan.pctls);
  const n=results.length, ok=results.filter(r=>r.ok).length, ms=results.map(r=>r.ms).sort((a,b)=>a-b), el=t0?Math.max(1,(Date.now()-t0)/1000):1;
  const rows=plan.requests.map((r,i)=>{ const rs=results.filter(x=>x.idx===i), m=rs.map(x=>x.ms).sort((a,b)=>a-b), f=rs.filter(x=>!x.ok).length;
    return {name:r.name,method:r.method,url:r.url,n:rs.length,avg:avg(m),min:m[0]??0,max:m[m.length-1]??0,pcts:P.map(p=>pct(m,p)),err:rs.length?f/rs.length*100:0}; });
  const secs=Math.min(21600,Math.max(1,Math.ceil(el))), B=Array.from({length:secs+1},()=>[0,0,0,[]]);
  results.forEach(r=>{ const b=B[Math.min(secs,Math.floor((r.t-t0)/1000))]; if(b){ b[1]++; b[0]+=r.ms; if(final) b[3].push(r.ms); if(!r.ok) b[2]++; } });
  let series=B.map(b=>[b[1]?b[0]/b[1]:0,b[1],b[2],b[3].length?pct(b[3].sort((a,b)=>a-b),95):0]); if(series.length>900){ const k=Math.ceil(series.length/900); series=series.filter((_,i)=>i%k===0); }
  const targets=[...new Set(plan.requests.map(r=>{ try{ return new URL(r.url.replace(/\$\{[^}]*\}/g,'x')).host; }catch{ return r.url; } }))].filter(Boolean);
  const S={id:Date.now(),name:plan.name,cfg:{rampUp:plan.rampUp,mode:plan.mode,loops:plan.loops,duration:plan.duration,think:plan.think,thinkMax:plan.thinkMax,cookies:plan.cookies,targets},date:new Date().toISOString(),threads:plan.threads,secs:el,active,total:n,ok,failed:n-ok,avg:avg(ms),p95:pct(ms,95),
    thr:(final?n/el:results.filter(r=>r.t>Date.now()-5000).length/Math.min(5,el)),errRate:n?(n-ok)/n*100:0,rows,series,pctls:P,pcts:P.map(p=>pct(ms,p)),breakdown:breakdown(results)};
  S.sla=sla(S,{maxErrPct:plan.maxErrPct,maxP95Ms:plan.maxP95Ms,minRps:plan.minRps});
  return S;
}
function show(S){
  shown=S;
  const M=[['Active users',S.active],['Total requests',S.total],['Successful',S.ok],['Failed',S.failed,S.failed>0],['Avg response',S.avg.toFixed(0)+' ms'],['Throughput',S.thr.toFixed(1)+' req/s'],['Error rate',S.errRate.toFixed(1)+'%',S.failed>0]];
  $('#metrics').innerHTML=M.map(([l,v,b])=>`<div class="m${b?' bad':''}"><b>${v}</b><span>${l}</span></div>`).join('');
  const P=S.pctls&&S.pctls.length?S.pctls:[90,95];
  $('#sumHead').innerHTML=`<tr><th>Request</th><th>Samples</th><th>Avg</th><th>Min</th><th>Max</th>${P.map(p=>`<th>P${p}</th>`).join('')}<th>Err %</th></tr>`;
  const f=(r,k)=>r.n?r[k].toFixed(k==='err'?1:0):'-', pv=(r,i)=>r.n&&r.pcts&&r.pcts[i]!=null?r.pcts[i].toFixed(0):'-';
  $('#sum').innerHTML=S.rows.map(r=>`<tr><td>${esc(r.name)}${r.url?`<br><span class="help">${esc((r.method||'GET')+' '+r.url)}</span>`:''}</td><td>${r.n}</td><td>${f(r,'avg')}</td><td>${f(r,'min')}</td><td>${f(r,'max')}</td>${P.map((_,i)=>`<td>${pv(r,i)}</td>`).join('')}<td>${f(r,'err')}</td></tr>`).join('');
  renderVerdict(S);
  renderCompare(S);
  draw(S.series);
}
// ---- Baseline comparison ----
function renderCompare(S){
  const box=$('#compare');
  if(!baseline||!S||!S.total||S.id===baseline.id){ box.hidden=true; box.innerHTML=''; return; }
  const c=compareRuns(baseline,S);
  const fv=(v,u)=>v.toFixed(u===' ms'?0:1)+u;
  const chg=(m,u)=>{ if(m.delta==null) return '<span class="cmp-new">new</span>';
    const t=u==='%'?`${m.delta>=0?'+':''}${m.delta.toFixed(1)} pts`:Number.isFinite(m.pct)?`${m.pct>=0?'+':''}${m.pct.toFixed(0)}%`:'new';
    return `<span class="cmp-${m.status}">${m.status==='better'?'▲ ':m.status==='worse'?'▼ ':''}${t}</span>`; };
  const badge={worse:'<span class="vb bad">WORSE</span>',better:'<span class="vb ok">BETTER</span>',same:'<span class="vb none">NO REAL CHANGE</span>'}[c.overall];
  const rows=c.rows.filter(r=>r.base!=null);
  box.innerHTML=`<h3>Compared with baseline ${badge}</h3>
    <p class="help">${esc(baseline.name)} · ${new Date(baseline.date).toLocaleString()} · ${baseline.threads} users <button id="clearBase" class="btn light sm" style="margin-left:6px">Clear baseline</button></p>
    ${c.notes.map(n=>`<p class="help warn">${esc(n)}</p>`).join('')}
    <div class="tw"><table><thead><tr><th>Metric</th><th>Baseline</th><th>This run</th><th>Change</th></tr></thead><tbody>
    ${c.metrics.map(m=>`<tr><td>${m.label}</td><td>${fv(m.base,m.unit)}</td><td>${fv(m.cur,m.unit)}</td><td>${chg(m,m.unit)}</td></tr>`).join('')}</tbody></table></div>
    ${rows.length?`<div class="tw"><table><thead><tr><th>Request (avg ms)</th><th>Baseline</th><th>This run</th><th>Change</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.base.toFixed(0)}</td><td>${r.cur.toFixed(0)}</td><td>${chg(r,' ms')}</td></tr>`).join('')}</tbody></table></div>`:''}`;
  box.hidden=false;
}
async function setBaseline(S){ baseline=S||null; await chrome.storage.local.set({baseline}); const {history=[]}=await chrome.storage.local.get('history'); renderHistory(history); if(shown) renderCompare(shown); }
$('#compare').addEventListener('click',e=>{ if(e.target.id==='clearBase'){ setBaseline(null); notice('Baseline cleared.',true); } });
function renderVerdict(S){
  const sl=(S&&S.sla)||{pass:null,checks:[]}, b=(S&&S.breakdown)||{failed:0,byError:[]}, val=c=>(c.unit==='%'?c.value.toFixed(1):c.value.toFixed(0))+c.unit;
  $('#verdict').innerHTML=(sl.pass===null?'<span class="vb none">No pass/fail target set</span>':sl.pass?'<span class="vb ok">PASS</span>':'<span class="vb bad">FAIL</span>')
    +sl.checks.map(c=>`<span class="chk${c.ok?'':' bad'}" style="margin-left:12px">${esc(c.label)} ${c.dir==='max'?'\u2264':'\u2265'} ${c.limit}${c.unit} (actual ${val(c)})</span>`).join('');
  $('#errors').hidden=!b.failed;
  if(b.failed){ $('#errCount').textContent=String(b.failed); $('#errBody').innerHTML=b.byError.map(e=>`<tr><td>${esc(e.label)}</td><td>${e.count}</td><td>${e.pct.toFixed(1)}%</td></tr>`).join(''); }
}
function draw(B){
  const c=$('#chart'), g=c.getContext('2d'), W=c.width, H=c.height, P=34; g.clearRect(0,0,W,H);
  let maxMs=50, maxN=1; for(const b of B){ if(b[0]>maxMs) maxMs=b[0]; if(b[1]>maxN) maxN=b[1]; } const bw=(W-P)/Math.max(1,B.length);
  g.strokeStyle='#e5e7eb'; g.fillStyle='#6b7280'; g.font='11px Segoe UI,sans-serif';
  for(let i=0;i<=4;i++){ const y=10+(H-P-10)*i/4; g.beginPath(); g.moveTo(P,y); g.lineTo(W,y); g.stroke(); g.fillText(Math.round(maxMs*(1-i/4)),0,y+4); }
  B.forEach((b,i)=>{ const x=P+i*bw; g.fillStyle='#c4b5fd'; const h=(H-P-10)*b[1]/maxN; g.fillRect(x+1,H-P-h,Math.max(1,bw-2),h);
    if(b[2]){ g.fillStyle='#dc2626'; const eh=(H-P-10)*b[2]/maxN; g.fillRect(x+1,H-P-eh,Math.max(1,bw-2),eh); } });
  g.strokeStyle='#1aa3e8'; g.lineWidth=2; g.beginPath(); let first=true;
  B.forEach((b,i)=>{ if(!b[1]) return; const x=P+i*bw+bw/2, y=10+(H-P-10)*(1-b[0]/maxMs); first?g.moveTo(x,y):g.lineTo(x,y); first=false; }); g.stroke(); g.lineWidth=1;
}

async function pushHistory(S){ const {history=[]}=await chrome.storage.local.get('history'); const h=[S,...history].slice(0,30); await chrome.storage.local.set({history:h}); renderHistory(h); }
function renderHistory(h){
  const badge = s => (s&&s.sla&&s.sla.pass!==null) ? (s.sla.pass?'<span class="vb ok sm">PASS</span>':'<span class="vb bad sm">FAIL</span>') : '';
  $('#hist').innerHTML=h.map((s,i)=>`<tr><td>${badge(s)}${esc(s.name)}<br><span class="help">${new Date(s.date).toLocaleString()} · ${s.threads} users</span></td><td>${s.total}</td><td>${s.avg.toFixed(0)}</td><td>${s.p95.toFixed(0)}</td><td>${s.errRate.toFixed(1)}</td><td><button class="btn light sm" data-view="${i}">View</button><button class="btn light sm${baseline&&baseline.id===s.id?' on':''}" data-base="${i}" title="Compare other runs against this one">${baseline&&baseline.id===s.id?'Baseline ✓':'Baseline'}</button><button class="btn light sm" data-rm="${i}">Delete</button></td></tr>`).join('');
  $('#histEmpty').style.display=h.length?'none':'';
}
$('#hist').addEventListener('click',async e=>{
  const {history=[]}=await chrome.storage.local.get('history'), v=e.target.dataset.view, d=e.target.dataset.rm, b=e.target.dataset.base;
  if(b!==undefined&&history[b]){ const on=baseline&&baseline.id===history[b].id; await setBaseline(on?null:history[b]); notice(on?'Baseline cleared.':`"${history[b].name}" is now the baseline. New runs are compared against it.`,true); }
  if(v!==undefined&&history[v]){ show(history[v]); $('#results').scrollIntoView({behavior:'smooth'}); }
  if(d!==undefined){ history.splice(+d,1); await chrome.storage.local.set({history}); renderHistory(history); }
});
$('#clearHist').onclick=async()=>{ await chrome.storage.local.set({history:[]}); renderHistory([]); };

function download(name,type,data){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([data],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
$('#csv').onclick=()=>results.length?download('results.csv','text/csv','timestamp,request,status,ms,success,bytes,error\n'+results.map(r=>[new Date(r.t).toISOString(),`"${r.name}"`,r.status,r.ms.toFixed(1),r.ok,r.bytes,`"${r.err}"`].join(',')).join('\n')):notice('Run a test before exporting.');
$('#json').onclick=()=>shown?download('results.json','application/json',JSON.stringify({plan,summary:shown,samples:results},null,2)):notice('Run a test before exporting.');
$('#jmx').onclick=()=>{ readForm(); const base=(plan.name||'plan').replace(/[^\w-]+/g,'_')||'plan';
  download(base+'.jmx','application/xml',buildJmx(plan));
  if(plan.data.split('\n').filter(l=>l.trim()).length>1){ download(base+'.csv','text/csv',plan.data); notice(`Exported ${base}.jmx and ${base}.csv. Keep the CSV next to the .jmx so JMeter can read the test data.`,true); } };
function resetPlan(){ plan=JSON.parse(JSON.stringify(DEF)); results=[]; lastLog=[]; t0=0; active=0; shown=null; save(); fillForm(); show(summarize()); $('#log').textContent='Ready.'; }
$('#clear').onclick=async()=>{
  if(running) return notice('Stop the running test before clearing.');
  if(!confirm('Clear this test plan and start over? Your saved run history is kept.')) return;
  if(rec){ rec=null; detachRec(); await chrome.storage.session.remove('rec'); await chrome.action.setBadgeText({text:''}); renderRec(); updateStart(); }
  resetPlan(); notice('Test cleared.',true);
};
$('#importJmx').onclick=()=>{
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.jmx,.xml,application/xml,text/xml';
  inp.onchange=async()=>{
    const f=inp.files&&inp.files[0]; if(!f) return;
    try{
      const p=parseJmx(await f.text());
      if(!p.requests.length) return notice('No HTTP samplers were found in that .jmx file.');
      resetPlan(); plan={...DEF,...p}; plan.requests=plan.requests.map(r=>({...newReq(1),...withDefaults(r)}));
      save(); fillForm(); setView('full'); show(summarize());
      notice(`Imported ${plan.requests.length} request${plan.requests.length>1?'s':''} from ${f.name}.`,true);
    }catch(e){ notice('Could not import that .jmx file: '+(e.message||e)); }
  };
  inp.click();
};
function correlate(){
  const c=detectCorrelation(plan.requests); if(!c) return null;
  return applyCorrelation(plan.requests,c);
}
$('#correlate').onclick=()=>{ const c=correlate(); save(); renderReqs();
  notice(c?`Linked "${c.name}" from request ${c.producer+1} into ${c.consumers.length} later request(s). It is refreshed on every run - ideal for login tokens.`:'No reusable login token was found. Add one manually in "Extract variables", e.g. token = auto.',!!c); };
const REPORT_DARK='#08111f', REPORT_CARD='#0b1523';
function paintReportCover(ctx,details,width,height){
  const {x:sx,y:sy}=reportCoverScale(width,height);
  const rows=[[434,details.domain],[494,details.dateTime],[613,details.tool]];
  ctx.textBaseline='alphabetic'; ctx.textAlign='left';
  rows.forEach(([y,text],i)=>{
    const maxW=i===2?125:215;
    ctx.fillStyle=REPORT_DARK; ctx.fillRect(118*sx,(y-17)*sy,(maxW+8)*sx,25*sy);
    ctx.fillStyle='#fff'; ctx.font=`700 ${14*sy}px Arial, sans-serif`;
    ctx.fillText(text,123*sx,y*sy,maxW*sx);
  });
  const maxW=215*sx;
  ctx.fillStyle=REPORT_DARK; ctx.fillRect(118*sx,534*sy,223*sx,38*sy);
  ctx.fillStyle='#fff'; ctx.font=`700 ${12*sy}px Arial, sans-serif`;
  const lines=[]; let line='';
  details.url.split(/(?<=[/?.&=_-])/).forEach(word=>{
    const next=line+word;
    if(line&&ctx.measureText(next).width>maxW){ lines.push(line); line=word; }
    else line=next;
  });
  if(line) lines.push(line);
  if(lines.length>2){
    lines.length=2;
    let last=lines[1];
    while(last.length&&ctx.measureText(last+'...').width>maxW) last=last.slice(0,-1);
    lines[1]=last+'...';
  }
  lines.forEach((text,i)=>ctx.fillText(text,123*sx,(lines.length>1?548+i*14:553)*sy,maxW));
}
function paintReportEnding(ctx,details,width,height){
  const {x:sx,y:sy}=reportCoverScale(width,height);
  ctx.textBaseline='alphabetic'; ctx.textAlign='left';
  ctx.fillStyle=REPORT_DARK; ctx.fillRect(36*sx,194*sy,490*sx,26*sy);
  ctx.fillStyle='#e5e7eb'; ctx.font=`${14.5*sy}px Arial, sans-serif`;
  ctx.fillText(`The performance test has been completed successfully for ${details.domain}.`,40*sx,211*sy,480*sx);
  const cards=[[81,details.average,'#171c2c'],[212,details.users,'#091f27'],[343,details.successRate,'#0b192c'],[474,details.total,'#0f192b']];
  ctx.textAlign='center';
  cards.forEach(([cx,value,fill])=>{
    ctx.fillStyle=fill; ctx.fillRect((cx-52)*sx,288*sy,104*sx,26*sy);
    ctx.fillStyle='#fff'; ctx.font=`700 ${19*sy}px Arial, sans-serif`;
    ctx.fillText(value,cx*sx,309*sy,100*sx);
  });

  const series=details.series, chart=(box,dataMax,label)=>{
    const {x,y,w,h,left,right}=box;
    ctx.fillStyle=REPORT_CARD; ctx.fillRect(left*sx,408*sy,(right-left)*sx,104*sy);
    ctx.strokeStyle='#1c2b40'; ctx.lineWidth=Math.max(1,sx);
    ctx.font=`${10.5*sy}px Arial, sans-serif`; ctx.fillStyle='#cbd5e1'; ctx.textAlign='right';
    for(let i=0;i<=2;i++){
      const gy=y+h-h*i/2;
      ctx.beginPath(); ctx.moveTo(x*sx,gy*sy); ctx.lineTo((x+w)*sx,gy*sy); ctx.stroke();
      ctx.fillText(label(dataMax*i/2),(x-8)*sx,(gy+4)*sy,34*sx);
    }
    ctx.textAlign='left'; ctx.fillText('0s',x*sx,503*sy,35*sx);
    ctx.textAlign='right'; ctx.fillText(`${Math.round(details.duration)}s`,(x+w)*sx,503*sy,40*sx);
    return {x,y,w,h,max:Math.max(1,dataMax)};
  };
  const points=(p,values,color)=>{
    if(values.length<2) return;
    ctx.strokeStyle=color; ctx.lineWidth=2*sx; ctx.lineJoin='round'; ctx.lineCap='round';
    let drawing=false;
    values.forEach((v,i)=>{
      if(v==null||!Number.isFinite(v)){ if(drawing) ctx.stroke(); drawing=false; return; }
      const px=(p.x+i*p.w/(values.length-1))*sx, py=(p.y+p.h-Math.min(v,p.max)/p.max*p.h)*sy;
      if(!drawing){ ctx.beginPath(); ctx.moveTo(px,py); drawing=true; } else ctx.lineTo(px,py);
    });
    if(drawing) ctx.stroke();
  };
  const avgValues=series.map(b=>b[1]>0?b[0]:null);
  const p95Values=series.map(b=>b[1]>0?(b[3]||details.p95):null);
  const maxTime=Math.max(1,...avgValues,...p95Values)*1.1;
  const responsePlot=chart({x:60,y:422,w:208,h:66,left:24,right:276},maxTime,v=>`${(v/1000).toFixed(1)}s`);
  points(responsePlot,avgValues,'#12c98a');
  points(responsePlot,p95Values,'#ff8a1f');
  ctx.font=`${10*sy}px Arial, sans-serif`; ctx.textAlign='left';
  ctx.fillStyle='#12c98a'; ctx.fillText('Avg',(responsePlot.x+responsePlot.w-62)*sx,418*sy);
  ctx.fillStyle='#ff8a1f'; ctx.fillText('P95',(responsePlot.x+responsePlot.w-30)*sx,418*sy);

  const rps=series.map(b=>b[1]), maxRps=Math.max(1,...rps);
  const throughputPlot=chart({x:340,y:422,w:188,h:66,left:297,right:532},maxRps*1.15,v=>String(Math.round(v)));
  if(rps.length){
    const bars=Math.min(rps.length,40), stride=Math.ceil(rps.length/bars), count=Math.ceil(rps.length/stride);
    const slot=throughputPlot.w*sx/count, barW=Math.max(1,slot*.65);
    ctx.fillStyle='#12c98a';
    for(let i=0;i<count;i++){
      const value=Math.max(...rps.slice(i*stride,i*stride+stride)), barH=value/throughputPlot.max*throughputPlot.h*sy;
      ctx.fillRect(throughputPlot.x*sx+i*slot,(throughputPlot.y+throughputPlot.h)*sy-barH,barW,barH);
    }
  }

  const cx=85*sx,cy=632*sy,r=51*sx,total=Number(details.total)||0;
  const success=Number(details.successful)||0,failed=Number(details.failed)||0,timedOut=Number(details.timedOut)||0;
  ctx.fillStyle=REPORT_CARD; ctx.fillRect(26*sx,578*sy,118*sx,108*sy);
  ctx.fillRect(254*sx,590*sy,44*sx,78*sy);
  const slice=(from,count,color)=>{
    if(!count) return;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,from,from+count/total*Math.PI*2); ctx.closePath(); ctx.fillStyle=color; ctx.fill();
  };
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle='#1c2b40'; ctx.fill();
  if(total){
    const start=-Math.PI/2;
    slice(start,success,'#12c98a');
    slice(start+success/total*Math.PI*2,failed,'#ff8a1f');
    slice(start+(success+failed)/total*Math.PI*2,timedOut,'#ef3b2d');
  }
  ctx.beginPath(); ctx.arc(cx,cy,r*.7,0,Math.PI*2); ctx.fillStyle=REPORT_CARD; ctx.fill();
  ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font=`700 ${16*sy}px Arial, sans-serif`;
  ctx.fillText(details.successRate,cx,cy+sy,66*sx);
  ctx.fillStyle='#cbd5e1'; ctx.font=`${11*sy}px Arial, sans-serif`;
  ctx.fillText('Success',cx,cy+17*sy,60*sx);
  ctx.textAlign='right'; ctx.fillStyle='#fff'; ctx.font=`600 ${12*sy}px Arial, sans-serif`;
  [[details.successful,608],[details.failed,634],[details.timedOut,660]].forEach(([value,y])=>ctx.fillText(value,291*sx,y*sy,36*sx));
}async function loadReportImage(filename,label,coverDetails,endingDetails){
  const res=await fetch(chrome.runtime.getURL(`assets/${filename}`));
  if(!res.ok) throw new Error(`Could not load the ${label} (${res.status}).`);
  const bitmap=await createImageBitmap(await res.blob()), canvas=document.createElement('canvas');
  canvas.width=bitmap.width*2; canvas.height=bitmap.height*2;
  const ctx=canvas.getContext('2d');
  if(!ctx){ bitmap.close(); throw new Error('Could not prepare the report cover image.'); }
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingQuality='high'; ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  if(coverDetails) paintReportCover(ctx,coverDetails,canvas.width,canvas.height);
  if(endingDetails) paintReportEnding(ctx,endingDetails,canvas.width,canvas.height);
  const bin=atob(canvas.toDataURL('image/jpeg',.94).split(',')[1]);
  return {data:bin,w:canvas.width,h:canvas.height};
}
$('#report').onclick=async()=>{
  if(!shown) return notice('Run a test before exporting a report.');
  try{
    const c=$('#chart'), t=document.createElement('canvas'); t.width=c.width; t.height=c.height;
    const g=t.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,t.width,t.height); g.drawImage(c,0,0);
    const bin=atob(t.toDataURL('image/jpeg',.92).split(',')[1]);
    const vars={...parseVars(plan.vars),...(parseCsv(plan.data)[0]||{})};
    const coverPlan={...plan,requests:plan.requests.map(r=>({...r,url:subst(r.url,vars)}))};
    const coverDetails=reportCoverDetails(shown,coverPlan);
    const cover=await loadReportImage('report-cover.png','report cover',coverDetails);
    const endingDetails=reportEndingDetails(shown,coverDetails.domain);
    const ending=await loadReportImage('report-ending.png','report ending page',null,endingDetails);
    download((shown.name||'report').replace(/[^\w-]+/g,'_')+'-report.pdf','application/pdf',buildPdf(shown,plan,{data:bin,w:t.width,h:t.height},cover,ending));
    notice('PDF report downloaded.',true);
  }catch(e){ notice('Could not create the PDF: '+(e.message||e)); }
};

function fillQuick(){
  $('#qUrl').value=plan.requests[0]?.url||'';
  $('#qNote').textContent=plan.requests.length>1?`This plan has ${plan.requests.length} requests and runs all of them. Use Full plan to edit.`:'';
}
$('#qUrl').addEventListener('input',e=>{ plan.requests[0].url=e.target.value.trim(); save(); });
async function useTab(){ const [t]=await chrome.tabs.query({active:true,currentWindow:true}); if(t&&/^https?:/.test(t.url||'')){ $('#qUrl').value=t.url; plan.requests[0].url=t.url; save(); notice(''); } else notice('Switch to a website tab first.'); }
$('#useTab').onclick=useTab;

function updateStart(){ const b=$('#start'); b.textContent=view==='record'?(rec?'Stop & import':'Start recording'):'Run test'; b.disabled=running; }
function setView(v){ view=v; document.body.dataset.view=v; document.querySelector(`input[name=view][value=${v}]`).checked=true; chrome.storage.local.set({view:v}); notice(''); if(v==='quick') fillQuick(); if(v==='full'){ plan.requests.forEach(withDefaults); save(); renderReqs(); } renderRec(); updateStart(); }
document.querySelectorAll('input[name=view]').forEach(r=>r.onchange=()=>setView(r.value));
$('#auth').addEventListener('change',()=>{ chrome.storage.session.set({auth:$('#auth').checked}); if($('#auth').checked) notice(''); });

function renderRec(){
  $('#recDot').className='dot'+(rec?' on':'');
  $('#reload').disabled=$('#statics').disabled=$('#firstParty').disabled=$('#ignore').disabled=!!rec;
  $('#recClear').disabled=!rec||!rec.items.length;
  $('#recStatus').textContent=rec?`Recording: ${rec.items.length} requests captured.`:'Not recording.';
  $('#recList').innerHTML=rec?rec.items.map((i,x)=>`<div class="recrow"><span>${esc(i.name)}</span><button class="recx" data-rm="${x}" title="Remove">&times;</button></div>`).join(''):'';
}
$('#recList').addEventListener('click',e=>{
  const rm=e.target.dataset.rm; if(rm===undefined||!rec) return;
  rec.items.splice(+rm,1); chrome.storage.session.set({rec});
  chrome.action.setBadgeText({text:rec.items.length?String(rec.items.length):'REC'}); renderRec();
});
$('#recClear').onclick=()=>{ if(!rec) return; rec.items=[]; chrome.storage.session.set({rec}); chrome.action.setBadgeText({text:'REC'}); renderRec(); };
const SKIP_HOSTS=/(google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.net|hotjar|segment\.io|mixpanel|sentry\.io|clarity\.ms|newrelic|datadoghq|chrome-extension:)/i;
const DROP=/^(host|cookie|content-length|origin|referer|user-agent|accept-encoding|accept-language|connection|upgrade-insecure-requests|priority|pragma|cache-control|sec-.*)$/i;
const recBodies=new Map(), REC_URLS=['http://*/*','https://*/*'];
function onRecBody(d){ const rb=d.requestBody; if(!rb) return; try{
  if(rb.raw) recBodies.set(d.requestId,rb.raw.map(p=>p.bytes?new TextDecoder().decode(p.bytes):'').join(''));
  else if(rb.formData){ const p=new URLSearchParams(); for(const k in rb.formData) rb.formData[k].forEach(v=>p.append(k,v)); recBodies.set(d.requestId,p.toString()); } }catch{} }
const sameSite=(a,b)=>{ if(!a||!b) return true; const x=a.replace(/^www\./,''), y=b.replace(/^www\./,''); return x===y||x.endsWith('.'+y)||y.endsWith('.'+x); };
function onRecHeaders(d){
  if(!rec||d.tabId!==rec.tabId||d.method==='OPTIONS'||SKIP_HOSTS.test(d.url)) return;
  if(!rec.statics&&!['xmlhttprequest','main_frame','sub_frame'].includes(d.type)) return;
  if(rec.firstParty){ let host=''; try{ host=new URL(d.url).hostname; }catch{} if(!sameSite(host,rec.host)) return; }
  if(rec.ignore&&rec.ignore.length&&rec.ignore.some(p=>d.url.toLowerCase().includes(p))) return;
  const key=d.method+' '+d.url, body=recBodies.get(d.requestId)||'';
  if(rec.items.some(i=>i.key===key&&(i.body||'')===body)) return;
  const headers=(d.requestHeaders||[]).filter(h=>!DROP.test(h.name)).map(h=>`${h.name}: ${h.value}`).join('\n');
  let path=d.url; try{ const u=new URL(d.url); path=u.pathname.split('/').filter(Boolean).pop()||u.hostname; }catch{}
  rec.items.push({key,name:`${d.method} ${path}`.slice(0,60),method:d.method,url:d.url,headers,body}); recBodies.delete(d.requestId);
  chrome.storage.session.set({rec}); chrome.action.setBadgeText({text:String(rec.items.length)}); renderRec();
}
function attachRec(){ detachRec(); const f={urls:REC_URLS,tabId:rec.tabId};
  chrome.webRequest.onBeforeRequest.addListener(onRecBody,f,['requestBody']);
  chrome.webRequest.onBeforeSendHeaders.addListener(onRecHeaders,f,['requestHeaders','extraHeaders']); }
function detachRec(){ chrome.webRequest.onBeforeRequest.removeListener(onRecBody); chrome.webRequest.onBeforeSendHeaders.removeListener(onRecHeaders); recBodies.clear(); }
async function startRec(){
  const [t]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!t||!/^https?:/.test(t.url||'')) return notice('Switch to the website tab you want to record, then press Start recording.');
  let host=''; try{ host=new URL(t.url).hostname; }catch{}
  const ignore=$('#ignore').value.split(/[,\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  rec={tabId:t.id,host,statics:$('#statics').checked,firstParty:$('#firstParty').checked,ignore,items:[]}; await chrome.storage.session.set({rec}); attachRec();
  await chrome.action.setBadgeBackgroundColor({color:'#dc2626'}); await chrome.action.setBadgeText({text:'REC'});
  renderRec(); updateStart();
  if($('#reload').checked) await chrome.tabs.reload(t.id);
  notice('Recording started. Browse the site, then press Stop & import.',true);
}
// Adds recorded or imported requests to the plan (replacing the blank starter request), links a
// login token if one is found and moves a hard-coded Authorization header into a variable.
function addRequests(items){
  let c=null;
  if(items.length){
    items=items.map(r=>({...newReq(1),...r,recorded:true}));
    plan.requests=plan.requests.length===1&&!plan.requests[0].url?items:plan.requests.concat(items);
    c=correlate();
    const a=authToVariable(plan.requests);
    if(a&&!parseVars(plan.vars)[a.name]) plan.vars=(plan.vars.trim()?plan.vars.trim()+'\n':'')+`${a.name}=${a.value}`;
  }
  save(); fillForm(); setView('full'); renderReqs();
  return c;
}
const linkNote=c=>c?` - linked the "${c.name}" token so it is reused automatically`:' - if a login is failing, press "Reuse login token" to link its CSRF/auth token';
async function stopRec(){
  detachRec(); const items=(rec?.items||[]).map(({key,...r})=>r);
  await chrome.storage.session.remove('rec'); await chrome.action.setBadgeText({text:''}); rec=null;
  const c=addRequests(items);
  if(items.length) notice(`Imported ${items.length} recorded requests${linkNote(c)}.`,true); else notice('No requests were captured. Make sure you browsed the recorded tab while recording.');
}

// ---- Import from cURL / HAR ----
$('#importOpen').onclick=()=>{ const b=$('#importBox'); b.hidden=!b.hidden; if(!b.hidden) $('#importText').focus(); };
$('#importCancel').onclick=()=>{ $('#importBox').hidden=true; };
const impOpts=()=>({statics:$('#impStatics').checked,firstParty:$('#impFirstParty').checked});
function finishImport(r){
  const skip=r.skipped?` (${r.skipped} skipped: static files, other domains, preflights or duplicates)`:'';
  if(!r.requests.length) return notice(`No requests to import from that ${r.kind}${skip}.`);
  const c=addRequests(r.requests);
  $('#importText').value=''; $('#importBox').hidden=true;
  const n=r.requests.length;
  notice(`Imported ${n} request${n>1?'s':''} from ${r.kind}${skip}${linkNote(c)}.${r.warnings.length?' Note: '+r.warnings.join('; ')+'.':''}`,true);
}
$('#importGo').onclick=()=>{ try{ finishImport(importText($('#importText').value,impOpts())); }catch(e){ notice('Could not import: '+(e.message||e)); } };
$('#importHar').onclick=()=>{
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.har,.json,application/json';
  inp.onchange=async()=>{
    const f=inp.files&&inp.files[0]; if(!f) return;
    try{ const r=parseHar(await f.text(),impOpts()); finishImport({kind:'HAR',requests:r.requests,skipped:r.skipped,warnings:[]}); }
    catch(e){ notice(`Could not import ${f.name}: `+(e.message||e)); }
  };
  inp.click();
};

$('#start').onclick=async()=>{ try{ if(view==='record') await (rec?stopRec():startRec()); else await start(); }catch(e){ notice('Something went wrong: '+(e.message||e)); } };
chrome.storage.onChanged.addListener((c,area)=>{ if(area==='session'&&'rec' in c){ if(!c.rec.newValue){ rec=null; detachRec(); } else if(!rec) rec=c.rec.newValue; renderRec(); updateStart(); } });

Promise.all([chrome.storage.local.get(['plan','view','history','baseline']),chrome.storage.session.get(['rec','auth'])]).then(([s,ses])=>{
  if(s.plan) plan={...DEF,...s.plan};
  baseline=s.baseline||null;
  plan.requests=(plan.requests&&plan.requests.length?plan.requests:[newReq(1)]).map(r=>({...newReq(1),...r}));
  rec=ses.rec||null; if(rec) attachRec(); $('#auth').checked=!!ses.auth; fillForm(); show(summarize());
  setTimeout(()=>renderHistory(s.history||[]),0);
  setView(rec?'record':(s.view||'quick'));
});
