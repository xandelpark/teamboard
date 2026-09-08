const http=require('http'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3333;
const HTML=path.join(__dirname,'teamboard.html');
const DB_PATH=process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH,'db.json')
  : path.join(__dirname,'db.json');

function loadDB(){
  try{
    if(fs.existsSync(DB_PATH))return JSON.parse(fs.readFileSync(DB_PATH,'utf8'));
  }catch(e){console.log('DB 읽기 오류:',e.message);}
  return {employees:[],tasks:{},attend:{},allowedIPs:[],extLogs:[],notices:[],checked:{},reports:{},requests:[],retouch:[],editlog:[]};
}
function saveDB(d){
  try{
    const dir=path.dirname(DB_PATH);
    if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(DB_PATH,JSON.stringify(d),'utf8');
  }catch(e){console.log('DB 저장 오류:',e.message);}
}

// ── 조직 구성 시드: 소속/파트/기록권한이 아직 없는 직원만 채운다 ──
const ORG_SEED={
  '이지연':{free:true},   // 완전 프리 — 출퇴근 기록 대상 아님
  '양은영':{dept:'denter',part:'marketing',startTime:'09:30',endTime:'18:30'},
  '배지현':{dept:'denter',part:'content'},
  '김득수':{dept:'art',part:'photo',retouch:true},
  '김유리':{dept:'art',part:'photo',retouch:true},
  '유진환':{dept:'art',part:'video',edit:true},
  '노시진':{dept:'art',part:'video',edit:true}
};
function migrateOrg(d){
  let changed=false;
  if(!Array.isArray(d.employees))d.employees=[];
  if(!Array.isArray(d.editlog)){d.editlog=[];changed=true;}
  if(!Array.isArray(d.retouch)){d.retouch=[];changed=true;}
  d.employees.forEach(e=>{
    const seed=ORG_SEED[(e.name||'').trim()];
    if(!seed)return;
    // undefined 일 때만 채운다 → 대표가 직접 바꾼 값은 절대 덮어쓰지 않음
    if(seed.dept&&e.dept===undefined){e.dept=seed.dept;changed=true;}
    if(seed.part&&e.part===undefined){e.part=seed.part;changed=true;}
    if(seed.retouch&&e.retouch===undefined){e.retouch=true;changed=true;}
    if(seed.edit&&e.edit===undefined){e.edit=true;changed=true;}
    if(seed.free&&e.free===undefined){e.free=true;changed=true;}
    if(seed.startTime&&e.startTime===undefined){e.startTime=seed.startTime;changed=true;}
    if(seed.endTime&&e.endTime===undefined){e.endTime=seed.endTime;changed=true;}
  });
  return changed;
}

let mem=loadDB();
if(migrateOrg(mem)){saveDB(mem);console.log('조직 구성 마이그레이션 적용됨');}
let saveTimer=null;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>saveDB(mem),500);
}

// ── 근무시간 / 자동퇴근 (한국시간 고정) ──
const KST_OFF=9*60*60*1000;
const WORK_IN_H=9, WORK_IN_M=0;     // 출근 09:00
const WORK_OUT_H=18, WORK_OUT_M=0;  // 퇴근 18:00
const AUTO_OUT_H=parseInt(process.env.AUTO_OUT_HOUR,10)||19; // 19시 넘으면 자동 퇴근 처리

// 'HH:MM' → 분. 값이 없거나 형식이 틀리면 기본값
function hmToMin(str,def){
  if(typeof str!=='string'||!/^\d{1,2}:\d{2}$/.test(str))return def;
  const [h,m]=str.split(':').map(Number);
  if(h>23||m>59)return def;
  return h*60+m;
}
function empById(id){ return (mem.employees||[]).find(e=>e.id===id)||null; }
function empStartMin(id){ return hmToMin((empById(id)||{}).startTime, WORK_IN_H*60+WORK_IN_M); }
function empEndMin(id){ return hmToMin((empById(id)||{}).endTime, WORK_OUT_H*60+WORK_OUT_M); }

function kstParts(ms){ const d=new Date(ms+KST_OFF); return {
  y:d.getUTCFullYear(), mo:d.getUTCMonth(), d:d.getUTCDate(),
  h:d.getUTCHours(), mi:d.getUTCMinutes(),
  date:d.toISOString().slice(0,10)
};}
function kstDateOf(iso){ try{ return kstParts(Date.parse(iso)).date; }catch{ return ''; } }

// 오늘(KST) 출근만 찍고 퇴근을 안 찍은 사람을 19:00 로 자동 퇴근 처리
function autoCheckoutSweep(){
  const now=Date.now(), k=kstParts(now);
  if(k.h<AUTO_OUT_H)return;
  const cutoffISO=new Date(Date.parse(`${k.date}T${String(AUTO_OUT_H).padStart(2,'0')}:00:00+09:00`)).toISOString();
  let changed=false;
  Object.keys(mem.attend||{}).forEach(id=>{
    if((empById(id)||{}).free)return;   // 프리 근무자는 출퇴근 관리 대상 아님
    const logs=(mem.attend[id]||[]).filter(l=>kstDateOf(l.time)===k.date);
    if(!logs.length)return;
    const last=logs[logs.length-1];
    if(last.type!=='checkin'&&last.type!=='return')return;
    // 19시 이후에 출근을 찍은 야간 근무 건은 자동 퇴근시키지 않는다
    if(Date.parse(last.time)>=Date.parse(cutoffISO))return;
    mem.attend[id].push({type:'checkout',time:cutoffISO,ip:'auto',auto:true});
    changed=true;
    console.log(`자동 퇴근 처리: ${id} @ ${k.date} ${AUTO_OUT_H}:00`);
  });
  if(changed)scheduleSave();
}
setInterval(autoCheckoutSweep,60*1000);
setTimeout(autoCheckoutSweep,3000);

const srv=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://x').pathname;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(200);res.end();return;}
  if(p==='/'||p==='/index.html'){
    try{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(fs.readFileSync(HTML,'utf8'));}
    catch{res.writeHead(404);res.end('teamboard.html 없음');}
    return;
  }
  if(p==='/api/db'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(mem));return;
  }
  if(p==='/api/db'&&req.method==='POST'){
    let b='';req.on('data',c=>b+=c);
    req.on('end',()=>{
      try{
        const incoming=JSON.parse(b);
        // 보정/편집 기록은 전용 통로로만 수정 (전체 덮어쓰기로 유실되는 것 방지)
        incoming.retouch=mem.retouch||[];
        incoming.editlog=mem.editlog||[];
        // 출퇴근도 /api/attend 전용 통로로만 기록 — 삭제된 팀원 기록만 정리한다
        const keepAtt=mem.attend||{};
        const liveIds=new Set((incoming.employees||[]).map(e=>e.id));
        Object.keys(keepAtt).forEach(k=>{ if(!liveIds.has(k))delete keepAtt[k]; });
        incoming.attend=keepAtt;
        mem=incoming;scheduleSave();res.writeHead(200);res.end('{"ok":true}');
      }
      catch{res.writeHead(400);res.end('{"error":"invalid"}');}
    });return;
  }
  if(p==='/api/retouch'&&req.method==='POST'){
    let b='';req.on('data',c=>b+=c);
    req.on('end',()=>{
      try{
        const d=JSON.parse(b);
        if(!mem.retouch)mem.retouch=[];
        if(d.action==='add'&&d.rec&&d.rec.id){
          if(!mem.retouch.some(r=>r.id===d.rec.id))mem.retouch.unshift(d.rec);
          if(mem.retouch.length>5000)mem.retouch=mem.retouch.slice(0,5000);
        }else if(d.action==='del'&&d.id){
          mem.retouch=mem.retouch.filter(r=>r.id!==d.id);
        }else{
          res.writeHead(400);res.end('{"error":"invalid"}');return;
        }
        scheduleSave();
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,count:mem.retouch.length}));
      }catch{res.writeHead(400);res.end('{"error":"invalid"}');}
    });return;
  }
  if(p==='/api/editlog'&&req.method==='POST'){
    let b='';req.on('data',c=>b+=c);
    req.on('end',()=>{
      try{
        const d=JSON.parse(b);
        if(!mem.editlog)mem.editlog=[];
        if(d.action==='add'&&d.rec&&d.rec.id){
          if(!mem.editlog.some(r=>r.id===d.rec.id))mem.editlog.unshift(d.rec);
          if(mem.editlog.length>5000)mem.editlog=mem.editlog.slice(0,5000);
        }else if(d.action==='upd'&&d.rec&&d.rec.id){
          const i=mem.editlog.findIndex(r=>r.id===d.rec.id);
          if(i>=0)mem.editlog[i]=d.rec; else mem.editlog.unshift(d.rec);
        }else if(d.action==='del'&&d.id){
          mem.editlog=mem.editlog.filter(r=>r.id!==d.id);
        }else{
          res.writeHead(400);res.end('{"error":"invalid"}');return;
        }
        scheduleSave();
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,count:mem.editlog.length}));
      }catch{res.writeHead(400);res.end('{"error":"invalid"}');}
    });return;
  }
  if(p==='/api/attend'&&req.method==='POST'){
    let b='';req.on('data',c=>b+=c);
    req.on('end',()=>{
      try{
        const{empId,type,ip}=JSON.parse(b);
        if(!mem.attend)mem.attend={};
        if(!mem.attend[empId])mem.attend[empId]=[];
        const nowISO=new Date().toISOString();
        const k=kstParts(Date.now());
        const todayLogs=mem.attend[empId].filter(l=>kstDateOf(l.time)===k.date);
        const last=todayLogs[todayLogs.length-1];
        // 같은 상태 연속 기록 방지 (출근 중복 클릭 등)
        const isIn=t=>t==='checkin'||t==='return';
        if(last&&((isIn(last.type)&&isIn(type))||(last.type===type))){
          res.writeHead(200);res.end(JSON.stringify({ok:true,dup:true}));return;
        }
        const rec={type,time:nowISO,ip:ip||''};
        const nowMin=k.h*60+k.mi;
        if(type==='checkin'){
          rec.late=Math.max(0,nowMin-empStartMin(empId));
          rec.base=empStartMin(empId);   // 판정에 쓴 기준 출근시각(분)
        }
        if(type==='checkout'){
          rec.early=Math.max(0,empEndMin(empId)-nowMin);
        }
        mem.attend[empId].push(rec);
        if(mem.attend[empId].length>400)mem.attend[empId]=mem.attend[empId].slice(-400);
        scheduleSave();res.writeHead(200);res.end('{"ok":true}');
      }catch{res.writeHead(400);res.end('{"error":"invalid"}');}
    });return;
  }
  if(p==='/api/extlog'&&req.method==='POST'){
    let b='';req.on('data',c=>b+=c);
    req.on('end',()=>{
      try{
        const{empName,ip}=JSON.parse(b);
        if(!mem.extLogs)mem.extLogs=[];
        mem.extLogs.unshift({empName,ip,time:new Date().toISOString()});
        if(mem.extLogs.length>100)mem.extLogs=mem.extLogs.slice(0,100);
        scheduleSave();res.writeHead(200);res.end('{"ok":true}');
      }catch{res.writeHead(400);res.end('{"error":"invalid"}');}
    });return;
  }
  res.writeHead(404);res.end('Not Found');
});
srv.listen(PORT,'0.0.0.0',()=>{
  console.log('Team Board 시작! PORT:'+PORT);
  console.log('DB 경로:'+DB_PATH);
  console.log('DB 파일 존재:'+fs.existsSync(DB_PATH));
});
