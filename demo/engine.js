/* 新引擎 v0.1 —— 只管逻辑，不碰界面。
   时间：1 步 = 1T ≈ 2 秒。场地 7 列 × 11 行，每格约 9.7 × 9.5 米。
   黄队(A)向上进攻（球门在第 12 行），蓝队(B)向下进攻（球门在第 0 行）。
   所有判断都在"进攻方向朝上"的本队坐标里做，蓝队坐标镜像。 */
const Engine=(function(){
const W=7,H=11,CMX=9.71,CMY=9.55,BALL_V=4,MAXD=Math.hypot(6*CMX,10*CMY);
const S=d=>1/(1+Math.exp(-d/15));
const cellsOf=p=>p.speed>=70?2:1;
const cheb=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const meters=(a,b)=>Math.hypot((a.x-b.x)*CMX,(a.y-b.y)*CMY);
const inP=(x,y)=>x>=1&&x<=W&&y>=1&&y<=H;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const key=c=>c.x+','+c.y;
const F=(team,c)=>team==='A'?{x:c.x,y:c.y}:{x:8-c.x,y:12-c.y};   /* 世界坐标 <-> 本队坐标（自反） */
const other=t=>t==='A'?'B':'A';
const name=p=>(p.team==='A'?'黄':'蓝')+p.num;

/* ---------- 球队（4-2-3-1）：role = HELIOS 角色号 ---------- */
const TEAMS={
 A:[['门将',1,1,49,64,20,30],['左后卫',3,4,84,74,69,77],['中卫',4,2,66,64,55,91],['中卫',5,3,62,64,56,85],['右后卫',2,5,79,70,75,78],
    ['后腰',6,6,65,75,69,85],['后腰',8,7,67,81,65,86],['前腰',10,8,72,80,86,52],['左边锋',11,9,86,72,88,50],['右边锋',7,10,84,74,88,50],['中锋',9,11,78,67,78,45]],
 B:[['门将',1,1,43,56,20,30],['左后卫',3,4,78,68,64,68],['中卫',4,2,59,58,46,76],['中卫',5,3,55,57,48,80],['右后卫',2,5,72,65,67,72],
    ['后腰',6,6,61,74,65,77],['后腰',8,7,56,72,59,75],['前腰',10,8,68,73,76,46],['左边锋',11,9,80,64,76,43],['右边锋',7,10,82,68,79,42],['中锋',9,11,66,54,65,36]]
};

/* ---------- 阵型：HELIOS 表 + 4-2-3-1 的小调整（本队坐标，连续值，单位格） ---------- */
function formSpot(role,b){
  const t=FORM[key({x:clamp(b.x,1,7),y:clamp(b.y,1,11)})]; const g=r=>({x:t[r-1][0],y:t[r-1][1]});
  let p=g(role);
  if(role===6){ p=g(6); p.x-=0.6; }
  if(role===7){ p=g(6); p.x+=0.6; }
  if(role===8){ const a=g(7),c=g(8),f=g(11); p={x:(a.x+c.x)/2,y:(a.y+c.y)/2*0.5+(f.y)*0.5-0.6}; }
  return p;
}
const toCell=p=>({x:clamp(Math.floor(p.x)+1,1,W),y:clamp(Math.floor(p.y)+1,1,H)});

/* ---------- 随机数（可复现） ---------- */
function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

/* ---------- xG：只看位置和挡在线路上的人，与射手无关 ---------- */
function laneCells(a,b){ /* 本队/世界通用：连线穿过的格子（不含两端），擦角不算 */
  const ax=a.x-.5,ay=a.y-.5,bx=b.x-.5,by=b.y-.5,m=new Map(), on=v=>Math.abs(v-Math.round(v))<1e-9;
  for(let i=0;i<=400;i++){ const t=i/400,px=ax+(bx-ax)*t,py=ay+(by-ay)*t; if(on(px)||on(py)) continue;
    const x=Math.floor(px)+1,y=Math.floor(py)+1; if(inP(x,y)) m.set(x+','+y,{x,y}); }
  m.delete(key(a)); m.delete(key(b)); return [...m.values()];
}
function xG0(c){ /* c 为本队坐标格 */
  const dx=(c.x-4)*CMX, dy=(11.5-c.y)*CMY+0.5*CMY; const d=Math.hypot(dx,dy);
  const ang=Math.max(0.15,1-Math.abs(dx)/35);
  return Math.min(0.5,0.75*Math.exp(-0.13*d)*ang);
}
function shotBlockers(st,team,c){ const goal={x:4,y:12}, lane=laneCells(c,goal);
  return st.players.filter(q=>q.team!==team&&!q.gk&&lane.some(l=>{const w=F(team,q); return w.x===l.x&&w.y===l.y;})); }
function xG(st,team,c){ return xG0(c)*Math.pow(0.6,shotBlockers(st,team,c).length); }
/* 威胁值：球在这一格对进攻方有多大价值（近似 xT） */
const threat=c=>0.004+0.05*Math.pow((c.y-1)/10,2)*(1-0.05*Math.abs(c.x-4))+xG0(c)*0.6;

/* ---------- 比赛状态 ---------- */
function newMatch(seed){
  const R=rng(seed||1), players=[];
  for(const team of ['A','B']) for(const [role,num,hr,speed,pass,drib,def] of TEAMS[team])
    players.push({id:team+num,team,num,pos:role,hr,speed,pass,drib,def,gk:hr===1,x:0,y:0,role:'',why:''});
  const st={players,R,poss:'A',ball:{x:4,y:6,holder:null},step:0,score:{A:0,B:0},log:[],last:null};
  kickoff(st,'A'); return st;
}
function kickoff(st,team){
  const c={x:4,y:6};
  for(const p of st.players){ const fb=F(p.team,c); let s=toCell(formSpot(p.hr,fb)); s.y=Math.min(s.y,p.team===team?6:5); const w=F(p.team,s); p.x=w.x; p.y=w.y; }
  const cf=st.players.find(p=>p.team===team&&p.hr===11); const kc=F(team,{x:4,y:6}); cf.x=kc.x; cf.y=kc.y;
  spreadAll(st,[cf.id]);
  st.poss=team; st.ball={x:cf.x,y:cf.y,holder:cf.id};
}
const P=(st,id)=>st.players.find(p=>p.id===id);

/* 越位线（本队坐标）：对方倒数第二人的行；本方半场不越位；球在前面以球为准 */
function offsideRow(st,team){ const ys=st.players.filter(q=>q.team!==team).map(q=>F(team,q).y).sort((a,b)=>b-a); return Math.max(ys[1],6,F(team,st.ball).y); }

/* ---------- 一脚传球的判定（预估或真实掷骰） ---------- */
function passModel(st,h,t){ /* h 持球人，t 目标格（世界坐标） */
  const team=h.team, d=meters(h,t), adj=cheb(h,t)===1, nCells=d/9.6, flight=nCells/BALL_V;
  const acc=adj?1:1-Math.pow(d/MAXD,2)*(100-h.pass)/100;
  const opp=st.players.filter(q=>q.team!==team&&!q.gk);
  const cut=[];                                   /* 中短传（< 3 格）：线路前方一格之内的人可拦截 */
  if(nCells<3&&!adj){
    const hx=h.x,hy=h.y,vx=t.x-hx,vy=t.y-hy,L=Math.hypot(vx,vy);
    for(const q of opp){ const px=q.x-hx,py=q.y-hy, proj=(px*vx+py*vy)/L, perp=Math.abs(px*vy-py*vx)/L;
      if(proj<=0.3||proj>=L-0.3||perp>1) continue;
      const pr=S(q.def-h.pass)*(perp<=0.5?1:0.5); cut.push({q,pr,proj}); }
    cut.sort((a,b)=>a.proj-b.proj);
  }
  return {d,adj,nCells,flight,acc,cut};
}
function landContest(st,team,land,flight,receiverId){ /* 落点：飞行时间内谁赶得到 */
  const reach=p=>cheb(p,land)/cellsOf(p);
  const A=st.players.filter(p=>p.team===team&&!p.gk&&reach(p)<=flight+0.01).sort((a,b)=>reach(a)-reach(b));
  const D=st.players.filter(p=>p.team!==team&&!p.gk&&reach(p)<=flight+0.01).sort((a,b)=>reach(a)-reach(b));
  const a=A.find(p=>p.id===receiverId)||A[0], dd=D[0];
  return {a,d:dd,pKeep:!a?0:!dd?1:(reach(dd)<reach(a)-0.01?S(a.drib-dd.def)*0.5:S(a.drib-dd.def))};
}
function passChance(st,h,t,receiverId){ const m=passModel(st,h,t); let p=m.acc; for(const c of m.cut) p*=1-c.pr;
  const lc=landContest(st,h.team,t,Math.max(m.flight,0.25),receiverId); return p*lc.pKeep; }

/* 带球：沿路每格，前方或同格一格之内最强的防守人上来抢 */
function dribPath(h,dest){ const n=cheb(h,dest), out=[]; for(let k=1;k<=n;k++) out.push({x:h.x+Math.round((dest.x-h.x)*k/n),y:h.y+Math.round((dest.y-h.y)*k/n)}); return out; }
function dribDuels(st,h,dest){ const vx=dest.x-h.x,vy=dest.y-h.y, res=[];
  for(const c of dribPath(h,dest)){ const ds=st.players.filter(q=>q.team!==h.team&&!q.gk&&cheb(q,c)<=1&&((q.x-h.x)*vx+(q.y-h.y)*vy>=0||key(q)===key(c))).sort((a,b)=>b.def-a.def);
    if(ds.length) res.push({c,q:ds[0],pr:S(h.drib-ds[0].def)}); }
  return res; }

/* ---------- 持球人决策（电脑） ---------- */
function decide(st){
  const h=P(st,st.ball.holder), team=h.team, me=F(team,h), opts=[];
  const lossCost=c=>0.01+0.03*Math.pow((11-F(team,c).y)/10,2);
  const xs=h.gk?0:xG(st,team,me); if(xs>=0.06) opts.push({type:'shoot',p:1,v:xs,txt:'射门（xG '+Math.round(xs*100)+'%）'});
  for(const t of st.players.filter(q=>q.team===team&&q.id!==h.id&&!q.gk)){
    const lim=offsideRow(st,team); if(F(team,t).y>lim&&F(team,t).y>me.y) continue;
    const p=passChance(st,h,t,t.id), v=threat(F(team,t));
    opts.push({type:'pass',to:t.id,x:t.x,y:t.y,p,v,txt:'传给'+name(t)});
  }
  const r=h.gk?0:cellsOf(h);
  for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){ const c={x:h.x+dx,y:h.y+dy}; if((!dx&&!dy)||!inP(c.x,c.y)) continue;
    if(st.players.some(q=>q.team===team&&q.x===c.x&&q.y===c.y)) continue;
    let p=1; for(const d of dribDuels(st,h,c)) p*=d.pr; opts.push({type:'drib',x:c.x,y:c.y,p,v:threat(F(team,c)),txt:'带球到 '+c.x+','+c.y}); }
  if(h.gk){ opts.forEach(o=>{ if(o.type==='pass') o.v=o.v*0.5+o.p*0.05; }); }
  const press=st.players.filter(q=>q.team!==team&&!q.gk&&cheb(q,h)<=cellsOf(q)).sort((a,b)=>b.def-a.def)[0];
  opts.push({type:'hold',p:press?S(h.drib-press.def+10):1,v:threat(me)*0.95,txt:'护球'});
  for(const o of opts) o.score=o.type==='shoot'?o.v:o.p*o.v-(1-o.p)*lossCost(h);
  opts.sort((a,b)=>b.score-a.score);
  /* 不总选第一：在接近最优的几个里按分数抽一个，让比赛有变化 */
  const top=opts.filter(o=>o.score>=opts[0].score-0.006), w=top.map(o=>Math.exp((o.score-opts[0].score)/0.002)), sum=w.reduce((a,b)=>a+b,0);
  let r2=st.R()*sum, pick=top[0]; for(let i=0;i<top.length;i++){ r2-=w[i]; if(r2<=0){ pick=top[i]; break; } }
  return pick;
}

/* ---------- 无球跑动：按时刻和角色 ---------- */
function plan(st){
  const tg={}, b=st.ball, att=st.poss, def=other(att);
  for(const p of st.players){ p.role=''; p.why=''; }
  /* 进攻方 */
  const fa=F(att,b), lim=offsideRow(st,att), mates=st.players.filter(p=>p.team===att);
  const holder=b.holder?P(st,b.holder):null;
  if(holder){ holder.role='持球'; tg[holder.id]={x:holder.x,y:holder.y}; }
  const opp=st.players.filter(q=>q.team===def);
  /* 第二进攻人：球侧前方 1–3 格、线路干净的接应点，最多两个 */
  if(holder){
    const spots=[];
    for(let x=1;x<=W;x++)for(let y=Math.max(1,fa.y-1);y<=Math.min(H,fa.y+3);y++){ const c={x,y}, d=cheb(c,fa); if(d<1||d>3||y>lim) continue;
      const w=F(att,c); if(opp.some(q=>q.x===w.x&&q.y===w.y)) continue;
      const lane=laneCells(fa,c).map(l=>F(att,l)); const clear=!lane.some(l=>opp.some(q=>q.x===l.x&&q.y===l.y));
      const near=opp.filter(q=>cheb(q,w)<=1).length;
      spots.push({c,s:(clear?2:0)+(y-fa.y)*0.4-near*0.8-Math.abs(d-2)*0.3}); }
    spots.sort((a,b)=>b.s-a.s);
    const used=new Set([holder.id]);
    for(const sp of spots.slice(0,4)){ if([...used].length>=3) break;
      const w=F(att,sp.c); if(Object.values(tg).some(t=>t.x===w.x&&t.y===w.y)) continue;
      const cand=mates.filter(p=>!used.has(p.id)&&!p.gk&&p.hr!==2&&p.hr!==3).sort((a,c)=>cheb(a,w)/cellsOf(a)-cheb(c,w)/cellsOf(c))[0];
      if(!cand||cheb(cand,w)>cellsOf(cand)+1) continue;
      used.add(cand.id); tg[cand.id]=w; cand.role='接应'; cand.why='在球侧前方 '+cheb(sp.c,fa)+' 格处给出干净的传球线路';
    }
  }
  /* 第三进攻人：阵型位置 + 拉宽 + 前插（贴着越位线） */
  for(const p of mates){ if(tg[p.id]) continue;
    const base=toCell(formSpot(p.hr,fa)); let c={...base};
    if(p.gk){ p.role='门将'; p.why='留在禁区里'; }
    else if(p.hr===9||p.hr===10){ c.x=p.hr===9?1:7; const run=Math.min(lim,fa.y+3); if(run>c.y){ c.y=run; p.role='前插'; p.why='边路贴越位线前插，拉开纵深'; } else { p.role='拉宽'; p.why='贴边线拉开宽度'; } }
    else if(p.hr===11){ c.y=Math.max(c.y,lim); p.role='前插'; p.why='贴着对方最后一名后卫站位，随时冲身后'; }
    else if(p.hr===8){ c.y=Math.max(c.y,Math.min(lim,fa.y+1)); p.role='前插'; p.why='前腰插到持球人身前，给出向前的选项'; }
    else { p.role='平衡'; p.why='留在阵型位置上保持平衡，防反击'; }
    if(!p.gk) c.y=Math.min(c.y,lim);
    tg[p.id]=F(att,c);
  }
  /* 防守方 */
  const fd=F(def,b), defs=st.players.filter(p=>p.team===def);
  const reach=p=>cheb(p,b)/cellsOf(p);
  const outf=defs.filter(p=>!p.gk).sort((a,c)=>reach(a)-reach(c));
  const presser=outf[0], cover=outf[1];
  const gkHolds=holder&&holder.gk;
  if(presser&&!gkHolds){ tg[presser.id]={x:b.x,y:b.y}; presser.role='上抢'; presser.why='离球最近，上前逼抢'; }
  if(cover){ const c={x:clamp(fd.x+Math.sign(4-fd.x),1,W),y:clamp(fd.y-1,1,H)}; tg[cover.id]=F(def,c); cover.role='保护'; cover.why='站在上抢队友身后、靠球门一侧补位'; }
  const backs=defs.filter(p=>p.hr>=2&&p.hr<=5&&!tg[p.id]);
  const lineY=Math.min(...defs.filter(p=>p.hr>=2&&p.hr<=5).map(p=>toCell(formSpot(p.hr,fd)).y));
  for(const p of defs){ if(tg[p.id]) continue;
    let c=toCell(formSpot(p.hr,fd));
    if(p.gk){ c={x:clamp(fd.x,3,5),y:1}; p.role='门将'; p.why='站在球和球门之间'; }
    else { if(backs.includes(p)) c.y=lineY; p.role='平衡'; p.why=backs.includes(p)?'后防线保持一条线':'回到阵型位置，保持紧凑'; }
    tg[p.id]=F(def,c);
  }
  return tg;
}
function moveAll(st,tg,fixed){
  const order=st.players.slice().sort((a,b)=>(fixed.includes(b.id)?1:0)-(fixed.includes(a.id)?1:0));
  const occ={A:new Set(),B:new Set()};
  for(const p of order){ const t=tg[p.id]||{x:p.x,y:p.y}; const r=fixed.includes(p.id)?0:cellsOf(p); let best={x:p.x,y:p.y},bs=Infinity;
    for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){ const c={x:p.x+dx,y:p.y+dy}; if(!inP(c.x,c.y)||occ[p.team].has(key(c))) continue;
      const s=cheb(c,t)*10+Math.hypot(c.x-t.x,c.y-t.y)+0.01*cheb(c,p); if(s<bs){bs=s;best=c;} }
    if(bs===Infinity){ for(let x=1;x<=W;x++)for(let y=1;y<=H;y++){ const c={x,y}; if(occ[p.team].has(key(c))) continue; const s=cheb(c,p); if(s<bs){bs=s;best=c;} } }
    p.x=best.x; p.y=best.y; occ[p.team].add(key(best)); }
}
function spreadAll(st,keep){ const tg={}; for(const p of st.players) tg[p.id]={x:p.x,y:p.y}; moveAll(st,tg,keep); }

/* ---------- 一步 ---------- */
function step(st){
  const R=st.R, ev={t:st.step*2,txt:'',kind:'',from:null,to:null,air:false}; st.step++;
  const before={}; st.players.forEach(p=>before[p.id]={x:p.x,y:p.y});
  /* 无主球：谁先到谁拿 */
  if(!st.ball.holder){
    const b=st.ball, cand=st.players.filter(p=>!p.gk&&cheb(p,b)<=cellsOf(p)).sort((a,c)=>cheb(a,b)/cellsOf(a)-cheb(c,b)/cellsOf(c));
    if(cand.length){ const w=cand[0]; w.x=b.x; w.y=b.y; st.ball.holder=w.id; st.poss=w.team; ev.txt=name(w)+'抢到了无主球'; ev.kind='loose'; }
    else ev.txt='球无人控制';
    const tg=plan(st); for(const p of st.players) if(!st.ball.holder||p.id!==st.ball.holder){ if(p.team!==st.poss&&!p.gk&&cheb(p,b)<=3) tg[p.id]={x:b.x,y:b.y}; }
    moveAll(st,tg,st.ball.holder?[st.ball.holder]:[]); return finishStep(st,ev,before);
  }
  const h=P(st,st.ball.holder), team=h.team, act=decide(st);
  ev.from={x:h.x,y:h.y}; ev.who=h.id; ev.act=act;
  let newHolder=h.id, land=null;
  if(act.type==='shoot'){
    const x=xG(st,team,F(team,h)); ev.kind='shot'; ev.to=F(team,{x:4,y:12});
    if(R()<x){ st.score[team]++; ev.txt=name(h)+'射门 — 进了！（xG '+Math.round(x*100)+'%）'; ev.goal=true; st.log.push(ev); kickoff(st,other(team)); ev.after='kickoff'; return finishStep(st,ev,before); }
    const gk=st.players.find(q=>q.team!==team&&q.gk); ev.txt=name(h)+'射门没进（xG '+Math.round(x*100)+'%），'+name(gk)+'得球';
    newHolder=gk.id; land={x:gk.x,y:gk.y};
  } else if(act.type==='pass'){
    const t={x:act.x,y:act.y}, m=passModel(st,h,t), rec=P(st,act.to); ev.kind='pass'; ev.air=m.nCells>=3;
    let L=t, done=false;
    if(R()>=m.acc){ const opts=[]; for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){ const c={x:t.x+dx,y:t.y+dy}; if((dx||dy)&&inP(c.x,c.y)) opts.push(c);} L=opts[Math.floor(R()*opts.length)]; ev.miss=true; }
    for(const c of m.cut){ if(R()<c.pr){ newHolder=c.q.id; L={x:c.q.x,y:c.q.y}; ev.txt=name(h)+(act.txt)+'，被'+name(c.q)+'在线路上断下'; done=true; break; } }
    if(!done){
      const lim=offsideRow(st,team);
      const lc=landContest(st,team,L,Math.max(m.flight,0.25),key(L)===key(t)?rec.id:null);
      if(lc.a&&F(team,lc.a).y>lim&&F(team,lc.a).y>F(team,h).y&&F(team,L).y>6){ ev.txt=name(lc.a)+'越位'; newHolder=st.players.filter(q=>q.team!==team&&!q.gk).sort((a,b)=>cheb(a,L)-cheb(b,L))[0].id; }
      else if(lc.a&&R()<lc.pKeep){ newHolder=lc.a.id; ev.txt=name(h)+act.txt+(ev.miss?'（传偏了）':'')+'，'+name(lc.a)+'拿到球'; }
      else if(lc.d){ newHolder=lc.d.id; ev.txt=name(h)+act.txt+(ev.miss?'，传偏了':'')+'，'+name(lc.d)+'抢先拿到'; }
      else { newHolder=null; ev.txt=name(h)+act.txt+'，传偏了，球无人控制'; }
    }
    land=L; ev.to=L; ev.p=passChance(st,h,t,act.to);
  } else if(act.type==='drib'){
    const dest={x:act.x,y:act.y}; ev.kind='drib'; land=dest; ev.p=act.p;
    for(const d of dribDuels(st,h,dest)){ if(R()>=d.pr){ newHolder=d.q.id; land=d.c; ev.txt=name(h)+'带球，被'+name(d.q)+'抢断'; break; } }
    if(newHolder===h.id) ev.txt=name(h)+act.txt;
    ev.to=land;
  } else { ev.kind='hold'; land={x:h.x,y:h.y}; ev.txt=name(h)+'护球'; }
  /* 球的新位置，角色按新球权重新分配，所有人跑一步 */
  if(newHolder){ const w=P(st,newHolder); w.x=land.x; w.y=land.y; st.ball={x:land.x,y:land.y,holder:newHolder}; st.poss=w.team; }
  else st.ball={x:land.x,y:land.y,holder:null};
  if(act.type==='drib'&&newHolder===h.id){ h.x=land.x; h.y=land.y; }
  const tg=plan(st); moveAll(st,tg,newHolder?[newHolder]:[]);
  /* 跑完以后，同格的上抢者逼抢一次 */
  if(st.ball.holder){ const bh=P(st,st.ball.holder), t2=st.players.find(q=>q.team!==bh.team&&!q.gk&&q.x===bh.x&&q.y===bh.y&&cheb(before[q.id],bh)<=1);
    if(t2&&!bh.gk&&R()<(1-S(bh.drib-t2.def+15))*0.7){ st.ball.holder=t2.id; st.poss=t2.team; ev.txt+='；'+name(t2)+'上抢成功，断下球权'; ev.tackle=t2.id; } }
  return finishStep(st,ev,before);
}
function finishStep(st,ev,before){ if(!ev.goal) st.log.push(ev); st.last=ev; ev.before=before; ev.ball={...st.ball}; return ev; }

return {newMatch,step,xG0,threat,W,H,name,cellsOf};
})();
if(typeof module!=='undefined') module.exports=Engine;
