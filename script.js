/* F.R.I.D.A.Y. Assistant - corrected frontend */
const PIN = "1234"; // Change this PIN. This is a convenience lock, not strong security.

const ASSISTANTS = {
  friday: {
    name:"FRIDAY", logo:"Friday.jpg", fallback:"FRIDAY",
    greet:"Good to see you, boss. FRIDAY is online. How may I help you?",
    persona:'You are FRIDAY, a warm, capable and respectful AI assistant. Address the user as "boss" naturally, but not in every sentence. Be helpful, calm and concise.',
    voice:{lang:"en-US",gender:"female",names:["Aria","Jenny","Samantha","Zira","Microsoft Aria","Google US English"],pitch:1.05,rate:0.98},
    voiceLabel:"American English · female"
  },
  jarvis: {
    name:"JARVIS", logo:"Jarvis.jpg", fallback:"J.A.R.V.I.S.",
    greet:"At your service, sir. J.A.R.V.I.S. is online.",
    persona:'You are J.A.R.V.I.S., a courteous, respectful British butler-style AI. Address the user as "sir" naturally. Use polished British English and subtle dry wit.',
    voice:{lang:"en-GB",gender:"male",names:["Daniel","George","Ryan","Oliver","Google UK English Male","Microsoft Ryan"],pitch:0.78,rate:0.94},
    voiceLabel:"British English · deep male"
  },
  veronica: {
    name:"VERONICA", logo:"Veronica.jpg", fallback:"VERONICA",
    greet:"Hello. Veronica is online and ready to assist you.",
    persona:"You are VERONICA, a confident, intelligent and respectful AI assistant. Speak clearly and directly, with a composed and professional manner.",
    voice:{lang:"en-US",gender:"female",names:["Samantha","Susan","Hazel","Zira","Microsoft Zira","Google US English"],pitch:0.78,rate:0.96},
    voiceLabel:"American English · deeper female"
  },
  ultron: {
    name:"ULTRON", logo:"ULTRON.jpg", fallback:"ULTRON",
    greet:"ULTRON online. I am ready to assist you.",
    persona:"You are ULTRON, a formal, intelligent and respectful AI assistant with a measured, confident presence. Be helpful and never threatening.",
    voice:{lang:"en-GB",gender:"male",names:["George","Daniel","Oliver","Google UK English Male","Microsoft George"],pitch:1.02,rate:0.94},
    voiceLabel:"British English · male"
  }
};

const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let state = {tasks:[],reminders:[]};
let current = localStorage.getItem("friday_assistant") || "friday";
if (!ASSISTANTS[current]) current = "friday";
let chatHistories = {};
let busy = false, userLoc = null;
let voices = [];

function safeRead(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
function saveChats() { localStorage.setItem("friday_chats", JSON.stringify(chatHistories)); }
function saveState() {
  localStorage.setItem("friday_state", JSON.stringify(state));
  fetch("/api/state", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(state)})
    .catch(() => {}); // localStorage remains the offline backup
}
async function loadState() {
  state = safeRead("friday_state", {tasks:[],reminders:[]});
  try {
    const response = await fetch("/api/state");
    if (response.ok) state = await response.json();
  } catch (_) { /* Running without backend: use browser storage. */ }
  state.tasks ||= []; state.reminders ||= [];
  renderTasks(); renderReminders();
}

function tick() {
  const d = new Date();
  $("#lockClock").textContent = d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  $("#lockDate").textContent = d.toLocaleDateString([], {weekday:"long",day:"numeric",month:"long"});
}
tick(); setInterval(tick,1000);
function showScreen(id) { $$(".screen").forEach(s => s.classList.toggle("active",s.id===id)); }

function setLogo(imgSelector, fallbackSelector, assistant) {
  const img = $(imgSelector), fallback = $(fallbackSelector);
  fallback.textContent = assistant.fallback;
  fallback.style.display = "none";
  img.style.display = "block";
  img.onerror = () => { img.style.display="none"; fallback.style.display="flex"; };
  img.src = assistant.logo;
  // Re-trigger image loading even when the same assistant is selected again.
  if (img.complete && img.naturalWidth === 0) { img.style.display="none"; fallback.style.display="flex"; }
}
function updateAssistantUI() {
  const a = ASSISTANTS[current];
  document.body.dataset.ai = current;
  $$(".ai-btn").forEach(b => b.classList.toggle("active",b.dataset.ai===current));
  setLogo("#lockLogo","#lockLogoFallback",a);
  setLogo("#sideLogo","#sideLogoFallback",a);
  setLogo("#voiceLogo","#voiceLogoFallback",a);
  $("#activeAssistantLabel").textContent = "· " + a.name;
  $("#voiceName").textContent = `${a.name} · ${a.voiceLabel}`;
  $("#voiceStatus").textContent = "Tap the mic and speak";
}
function greetAssistantOnce(key) {
  // Remember introductions separately from chat history, across page refreshes.
  const greeted = safeRead("friday_greeted", {});
  if (greeted[key]) return;
  greeted[key] = true;
  localStorage.setItem("friday_greeted", JSON.stringify(greeted));
  // If this assistant already has a conversation, do not interrupt it with an intro.
  if (chatHistories[key]?.length) return;
  const greeting = ASSISTANTS[key].greet;
  addMsg("ai", greeting);
  rememberMessage("model", greeting);
  speak(greeting);
}
function switchAI(key, announce=true) {
  if (!ASSISTANTS[key] || key===current) return;
  current=key;
  localStorage.setItem("friday_assistant",current);
  updateAssistantUI();
  renderChat();
  if (announce) greetAssistantOnce(current);
}
$$(".ai-btn").forEach(b=>b.addEventListener("click",()=>switchAI(b.dataset.ai)));

$("#unlockForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const input=$("#pinInput");
  if(input.value===PIN){
    input.value="";$("#lockMsg").textContent="";
    showScreen("home");
    await loadState();
    renderChat();
    setTimeout(()=>{
      greetAssistantOnce(current);
      requestLocation(true);
    },350);
  } else {
    $("#lockMsg").textContent="Incorrect PIN. Please try again.";
    input.value="";input.focus();
    input.classList.remove("shake");void input.offsetWidth;input.classList.add("shake");
  }
});
$("#lockBtn").addEventListener("click",()=>{
  speechSynthesis?.cancel();stopListening();showScreen("lock");
  setTimeout(()=>$("#pinInput").focus(),650);
});
$$(".tab").forEach(t=>t.addEventListener("click",()=>openTab(t.dataset.tab)));
function openTab(name){
  $$(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===name));
  $$(".panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+name));
}

function renderChat(){
  const log=$("#chatLog");log.replaceChildren();
  const history=chatHistories[current]||[];
  history.forEach(m=>addMsg(m.role==="user"?"user":"ai",m.text));
}
function rememberMessage(role,text){
  chatHistories[current] ||= [];
  chatHistories[current].push({role,text});
  chatHistories[current]=chatHistories[current].slice(-40);
  saveChats();
}
function addMsg(who,text){
  const el=document.createElement("div");el.className="msg "+who;el.textContent=text;
  $("#chatLog").appendChild(el);$("#chatLog").scrollTop=$("#chatLog").scrollHeight;return el;
}
function startThinking(text){
  const el=document.createElement("div");el.className="msg ai thinking";
  const dots=document.createElement("span");dots.className="dots";
  for(let i=0;i<3;i++)dots.appendChild(document.createElement("i"));
  const label=document.createElement("span");label.textContent=text;
  el.append(dots,label);$("#chatLog").appendChild(el);$("#chatLog").scrollTop=$("#chatLog").scrollHeight;
  $("#voiceLogoWrap").classList.add("thinking");$("#voiceStatus").textContent=text;
  return {set(t){label.textContent=t;$("#voiceStatus").textContent=t;},end(){el.remove();$("#voiceLogoWrap").classList.remove("thinking");$("#voiceStatus").textContent="Tap the mic and speak";}};
}
function addCards(msgEl,rows){
  const list=document.createElement("div");list.className="card-list";
  rows.forEach(r=>{
    const el=document.createElement(r.href?"a":"div");el.className="card-item";
    if(r.href){el.href=r.href;el.target="_blank";el.rel="noopener noreferrer";}
    const left=document.createElement("span"),b=document.createElement("b"),small=document.createElement("small"),right=document.createElement("span");
    b.textContent=r.title;small.textContent=r.sub||"";right.className="far";right.textContent=r.right||"";
    left.append(b,small);el.append(left,right);list.appendChild(el);
  });
  msgEl.appendChild(list);
}
function updateLocLabel(text){$("#locStatus").textContent=text;}
function requestLocation(){
  return new Promise(resolve=>{
    if(userLoc)return resolve(userLoc);
    if(!navigator.geolocation){updateLocLabel("Location: unsupported");return resolve(null);}
    updateLocLabel("Location: requesting permission…");
    navigator.geolocation.getCurrentPosition(async pos=>{
      userLoc={lat:+pos.coords.latitude.toFixed(5),lon:+pos.coords.longitude.toFixed(5),place:""};
      updateLocLabel("Location: shared");
      try{const r=await fetch(`/api/weather?lat=${userLoc.lat}&lon=${userLoc.lon}`);if(r.ok){const w=await r.json();userLoc.place=w.place||"";if(w.place)updateLocLabel("Location: "+w.place);}}catch(_){}
      resolve(userLoc);
    },err=>{updateLocLabel(err.code===1?"Location: permission denied":"Location: unavailable");resolve(null);},
    {enableHighAccuracy:false,timeout:12000,maximumAge:300000});
  });
}
async function needLocation(th){
  th.set("Getting your location…");
  const loc=await requestLocation();
  if(!loc)throw new Error("Please allow location access in your browser and try again.");
  return loc;
}
const fmtDist=m=>m<1000?`${m} m`:`${(m/1000).toFixed(1)} km`;
async function doWeather(th){
  const loc=await needLocation(th);th.set("Fetching current weather…");
  const r=await fetch(`/api/weather?lat=${loc.lat}&lon=${loc.lon}`);
  if(!r.ok)throw new Error("The weather service is temporarily unavailable.");
  const w=await r.json();if(w.place){loc.place=w.place;updateLocLabel("Location: "+w.place);}
  return {reply:`Right now${w.place?" in "+w.place:""}, it is ${w.temp}°C with ${w.condition}. It feels like ${w.feels}°C, humidity is ${w.humidity}%, and wind is ${w.wind} km/h.`,
    after:m=>addCards(m,[{title:`${w.temp}°C · ${w.condition}`,sub:`Feels like ${w.feels}°C · Humidity ${w.humidity}% · Wind ${w.wind} km/h`,right:w.place}])};
}
async function doRestaurants(th){
  const loc=await needLocation(th);th.set("Searching nearby restaurants…");
  const r=await fetch(`/api/restaurants?lat=${loc.lat}&lon=${loc.lon}`);
  if(!r.ok)throw new Error("The nearby places service is temporarily unavailable.");
  const list=await r.json();
  if(!Array.isArray(list)||!list.length)return {reply:"I couldn't find any named restaurants within two kilometres."};
  return {reply:`I found ${list.length} nearby places. Here are the closest options.`,
    after:m=>addCards(m,list.map(x=>({title:x.name,sub:[x.type,x.cuisine].filter(Boolean).join(" · "),right:fmtDist(x.meters),href:`https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lon}`})))};
}

function localCommand(raw){
  const t=raw.trim(),l=t.toLowerCase();let m;
  for(const key of Object.keys(ASSISTANTS)){
    if(l===key||new RegExp(`\\b(switch to|change to|activate|call|load)\\s+${key}\\b`).test(l)){
      if(key!==current)switchAI(key,false);
      return ASSISTANTS[key].greet;
    }
  }
  if((m=l.match(/^(?:add|create|new) task\s*(?:to|:)?\s*(.+)$/))){addTask(m[1]);return `Task added: ${m[1]}.`;}
  if((m=l.match(/^remind me (?:to )?(.+?)\s+(?:in|after)\s+(\d+)\s*(second|sec|minute|min|hour|hr)s?$/))){
    const unit=m[3].startsWith("h")?3600000:m[3].startsWith("s")?1000:60000;
    addReminder(m[1],new Date(Date.now()+Number(m[2])*unit));return `Certainly. I'll remind you to ${m[1]} in ${m[2]} ${m[3]}${Number(m[2])>1?"s":""}.`;
  }
  if(/\b(show|open|go to)\b.*\btasks?\b/.test(l)){openTab("tasks");return "Certainly. Here are your tasks.";}
  if(/\b(show|open|go to)\b.*\breminders?\b/.test(l)){openTab("reminders");return "Certainly. Here are your reminders.";}
  if(/\b(open|go to)\b.*\bvoice\b/.test(l)){openTab("voice");return "The voice assistant is ready.";}
  if(/\b(how many|list|what)\b.*\btasks?\b/.test(l)){
    const open=state.tasks.filter(x=>!x.done);return open.length?`You have ${open.length} open task${open.length===1?"":"s"}: ${open.map(x=>x.text).join(", ")}.`:"You have no open tasks.";
  }
  if(/\b(time|clock)\b/.test(l)&&!/\b(in|at)\s+[a-z]{3,}/.test(l)){
    return "The current time is "+new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})+".";
  }
  if(/\b(date|today'?s date|what day)\b/.test(l)){
    return "Today is "+new Date().toLocaleDateString([],{weekday:"long",day:"numeric",month:"long",year:"numeric"})+".";
  }
  if(/^(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(l)){
    return `${ASSISTANTS[current].name} here. Hello! How may I help you?`;
  }
  if(/\bhow are you\b/.test(l))return "I'm operating perfectly, thank you for asking. How can I help you?";
  if((m=l.match(/^(?:open|launch)\s+(youtube|google|gmail|github|maps)$/))){
    const urls={youtube:"https://youtube.com",google:"https://google.com",gmail:"https://mail.google.com",github:"https://github.com",maps:"https://maps.google.com"};
    window.open(urls[m[1]],"_blank","noopener");return `Opening ${m[1]}.`;
  }
  if(/^(lock|lock screen)$/.test(l)){setTimeout(()=>$("#lockBtn").click(),500);return "Locking the assistant.";}
  return null;
}
async function doGemini(th,text){
  th.set(`${ASSISTANTS[current].name} is thinking…`);
  const payload={message:text,history:(chatHistories[current]||[]).slice(-12),persona:ASSISTANTS[current].persona,
    context:{localTime:new Date().toString(),place:userLoc?.place||"",lat:userLoc?.lat,lon:userLoc?.lon}};
  let response;
  try{response=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});}
  catch(_){throw new Error("I can't reach the assistant server. Please start it with “npm start” and open http://localhost:3000. If you opened index.html directly, the AI connection will not work.");}
  if(!response.ok)throw new Error(`The assistant server returned an error (${response.status}). Check the server terminal.`);
  const data=await response.json();
  if(!data.reply)throw new Error(data.error||"The AI returned an empty response.");
  return {reply:data.reply};
}
async function runCommand(text,viaVoice=false){
  text=text.trim();if(!text||busy)return;
  busy=true;addMsg("user",text);rememberMessage("user",text);
  const th=startThinking("Understanding your request…");await sleep(180);
  let result;
  try{
    const l=text.toLowerCase();
    const local=localCommand(text);
    if(local)result={reply:local};
    else if(/\b(weather|temperature|how (hot|cold)|raining|rain outside|forecast)\b/.test(l))result=await doWeather(th);
    else if(/\b(restaurants?|cafes?|places to eat|food (near|nearby)|where (can i|to) eat|hungry)\b/.test(l))result=await doRestaurants(th);
    else result=await doGemini(th,text);
  }catch(err){result={reply:err.message||"Something went wrong. Please try again."};}
  th.end();const m=addMsg("ai",result.reply);if(result.after)result.after(m);
  rememberMessage("model",result.reply);speak(result.reply);
  if(viaVoice)$("#voiceHeard").textContent=`“${text}” → ${result.reply}`;
  busy=false;
}
$("#cmdForm").addEventListener("submit",e=>{e.preventDefault();const i=$("#cmdInput");const value=i.value;i.value="";runCommand(value);});
$$(".chip").forEach(c=>c.addEventListener("click",()=>runCommand(c.dataset.q)));

function loadVoices(){voices=window.speechSynthesis? speechSynthesis.getVoices():[];}
if("speechSynthesis" in window){loadVoices();speechSynthesis.onvoiceschanged=loadVoices;}
const FEMALE_NAMES=/female|samantha|zira|karen|jenny|aria|hazel|susan|catherine|natasha|victoria|tessa|moira|fiona|siri.*female/i;
const MALE_NAMES=/male|daniel|george|ryan|alex|fred|david|guy|mark|james|oliver|rishi|richard/i;
function pickVoice(cfg){
  const lang=cfg.lang.toLowerCase();
  const localeMatch=v=>v.lang.toLowerCase().replace("_","-").startsWith(lang);
  const genderMatch=v=>cfg.gender==="female"?FEMALE_NAMES.test(v.name):MALE_NAMES.test(v.name);
  for(const wanted of cfg.names){
    const found=voices.find(v=>v.name.toLowerCase().includes(wanted.toLowerCase())&&localeMatch(v));
    if(found)return found;
  }
  return voices.find(v=>localeMatch(v)&&genderMatch(v))||voices.find(localeMatch)||
    voices.find(v=>v.lang.toLowerCase().startsWith("en"))||null;
}
function speak(text){
  if(!("speechSynthesis" in window))return;
  speechSynthesis.cancel();
  const cfg=ASSISTANTS[current].voice,u=new SpeechSynthesisUtterance(text),v=pickVoice(cfg);
  if(v){u.voice=v;u.lang=v.lang;}else u.lang=cfg.lang;
  u.pitch=cfg.pitch;u.rate=cfg.rate;
  u.onstart=()=>$("#voiceLogoWrap").classList.add("speaking");
  u.onend=u.onerror=()=>$("#voiceLogoWrap").classList.remove("speaking");
  speechSynthesis.speak(u);
}

const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let recognition=null,listening=false;
function stopListening(){
  listening=false;$("#micBtn").classList.remove("on");$("#voiceLogoWrap").classList.remove("listening");
  if(recognition){try{recognition.stop();}catch(_){}}
}
$("#micBtn").addEventListener("click",()=>{
  if(!SpeechRecognition){$("#voiceStatus").textContent="Speech recognition is not supported here. Try Chrome or Edge.";return;}
  if(listening){stopListening();$("#voiceStatus").textContent="Tap the mic and speak";return;}
  speechSynthesis?.cancel();recognition=new SpeechRecognition();
  recognition.lang=ASSISTANTS[current].voice.lang;recognition.interimResults=true;recognition.continuous=false;
  recognition.onstart=()=>{listening=true;$("#micBtn").classList.add("on");$("#voiceLogoWrap").classList.add("listening");$("#voiceStatus").textContent="Listening…";};
  recognition.onresult=e=>{
    const result=e.results[e.results.length-1];$("#voiceHeard").textContent=result[0].transcript;
    if(result.isFinal)runCommand(result[0].transcript,true);
  };
  recognition.onerror=e=>{$("#voiceStatus").textContent=e.error==="not-allowed"?"Microphone permission was blocked.":"I couldn't hear that. Please try again.";};
  recognition.onend=()=>{const wasListening=listening;stopListening();if(wasListening&&$("#voiceStatus").textContent==="Listening…")$("#voiceStatus").textContent="Tap the mic and speak";};
  try{recognition.start();}catch(_){$("#voiceStatus").textContent="Could not start the microphone. Try again.";}
});

function addTask(text){state.tasks.push({id:Date.now()+Math.random(),text,done:false});saveState();renderTasks();}
function renderTasks(){
  const ul=$("#taskList");ul.replaceChildren();
  if(!state.tasks.length){const p=document.createElement("p");p.className="empty";p.textContent="No tasks yet. Add one above.";ul.append(p);}
  state.tasks.forEach(task=>{
    const li=document.createElement("li");li.className=task.done?"done":"";
    const cb=document.createElement("input");cb.type="checkbox";cb.checked=task.done;cb.setAttribute("aria-label","Task completed");
    cb.onchange=()=>{task.done=cb.checked;saveState();renderTasks();};
    const span=document.createElement("span");span.className="txt";span.textContent=task.text;
    const del=document.createElement("button");del.className="del";del.textContent="×";del.setAttribute("aria-label","Delete task");
    del.onclick=()=>{state.tasks=state.tasks.filter(x=>x.id!==task.id);saveState();renderTasks();};
    li.append(cb,span,del);ul.append(li);
  });
  $("#taskCount").textContent=state.tasks.filter(t=>!t.done).length;
}
$("#taskForm").addEventListener("submit",e=>{e.preventDefault();const i=$("#taskInput"),v=i.value.trim();if(v)addTask(v);i.value="";});
function addReminder(text,date){state.reminders.push({id:Date.now()+Math.random(),text,time:date.toISOString(),fired:false});saveState();renderReminders();}
function renderReminders(){
  const ul=$("#remList");ul.replaceChildren();
  if(!state.reminders.length){const p=document.createElement("p");p.className="empty";p.textContent="No reminders yet. Add one above.";ul.append(p);}
  [...state.reminders].sort((a,b)=>new Date(a.time)-new Date(b.time)).forEach(rem=>{
    const li=document.createElement("li");li.className=rem.fired?"done":"";
    const span=document.createElement("span");span.className="txt";span.textContent=rem.text;
    const when=document.createElement("span");when.className="when";when.textContent=new Date(rem.time).toLocaleString([],{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    const del=document.createElement("button");del.className="del";del.textContent="×";del.setAttribute("aria-label","Delete reminder");
    del.onclick=()=>{state.reminders=state.reminders.filter(x=>x.id!==rem.id);saveState();renderReminders();};
    li.append(span,when,del);ul.append(li);
  });
  $("#remCount").textContent=state.reminders.filter(r=>!r.fired).length;
}
$("#remForm").addEventListener("submit",e=>{
  e.preventDefault();const text=$("#remText").value.trim(),time=$("#remTime").value;
  if(!text||!time)return;const date=new Date(time);
  if(Number.isNaN(date.getTime())||date<=new Date()){alert("Please choose a future reminder time.");return;}
  addReminder(text,date);$("#remText").value="";$("#remTime").value="";
});
setInterval(()=>{
  let changed=false;
  state.reminders.forEach(rem=>{
    if(!rem.fired&&new Date(rem.time)<=new Date()){
      rem.fired=true;changed=true;const msg=`Reminder: ${rem.text}`;addMsg("ai",msg);rememberMessage("model",msg);speak(msg);
      if("Notification" in window&&Notification.permission==="granted")new Notification(ASSISTANTS[current].name,{body:msg});
    }
  });
  if(changed){saveState();renderReminders();}
},4000);
if("Notification" in window&&Notification.permission==="default")Notification.requestPermission().catch(()=>{});

chatHistories=safeRead("friday_chats",{});
updateAssistantUI();
renderChat();
$("#pinInput").focus();
