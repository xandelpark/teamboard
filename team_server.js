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
  return {employees:[],tasks:{},attend:{},allowedIPs:[],extLogs:[],notices:[],checked:{},reports:{},requests:[]};
}
function saveDB(d){
  try{
    const dir=path.dirname(DB_PATH);
    if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(DB_PATH,JSON.stringify(d),'utf8');
  }catch(e){console.log('DB 저장 오류:',e.message);}
}

let mem=loadDB();
let saveTimer=null;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>saveDB(mem),500);
}

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
      try{mem=JSON.parse(b);scheduleSave();res.writeHead(200);res.end('{"ok":true}');}
      catch{res.writeHead(400);res.end('{"error":"invalid"}');}
    });return;
  }
  if(p==='/api/attend'&&req.method==='POST'){
    let b='';req.on('data',c=>b+=c);
    req.on('end',()=>{
      try{
        const{empId,type,ip}=JSON.parse(b);
        if(!mem.attend)mem.attend={};
        if(!mem.attend[empId])mem.attend[empId]=[];
        mem.attend[empId].push({type,time:new Date().toISOString(),ip:ip||''});
        if(mem.attend[empId].length>200)mem.attend[empId]=mem.attend[empId].slice(-200);
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
