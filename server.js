// F.R.I.D.A.Y. backend. Requires Node.js 18 or newer.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");

// Small .env reader; no external packages required.
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !line.trim().startsWith("#") && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (_) {}

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TYPES = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon"
};
const json = (res, code, obj) => {
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(obj));
};
const readBody = req => new Promise((resolve,reject)=>{
  let body="";req.on("data",chunk=>{body+=chunk;if(body.length>1_000_000){reject(new Error("Request too large"));req.destroy();}});
  req.on("end",()=>resolve(body));req.on("error",reject);
});
function readState(){
  try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}
  catch(_){return {tasks:[],reminders:[]};}
}
const WMO={
  0:"clear sky",1:"mostly clear",2:"partly cloudy",3:"overcast",45:"foggy",48:"foggy",
  51:"light drizzle",53:"drizzle",55:"heavy drizzle",61:"light rain",63:"rain",65:"heavy rain",
  71:"light snow",73:"snow",75:"heavy snow",80:"rain showers",81:"rain showers",82:"violent rain showers",
  95:"a thunderstorm",96:"a thunderstorm with hail",99:"a thunderstorm with hail"
};
async function getWeather(lat,lon){
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error("Invalid coordinates");
  const url=new URL("https://api.open-meteo.com/v1/forecast");
  url.search=new URLSearchParams({latitude:String(lat),longitude:String(lon),
    current:"temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",timezone:"auto"});
  const response=await fetch(url);
  if(!response.ok)throw new Error("Weather provider error");
  const data=await response.json(),w=data.current;
  if(!w)throw new Error("Weather data unavailable");
  let place="";
  try{
    const reverse=new URL("https://nominatim.openstreetmap.org/reverse");
    reverse.search=new URLSearchParams({format:"json",zoom:"10",lat:String(lat),lon:String(lon)});
    const g=await (await fetch(reverse,{headers:{"User-Agent":"FRIDAY-Assistant/1.0"}})).json();
    const a=g.address||{};place=a.city||a.town||a.village||a.suburb||a.county||a.state||"";
  }catch(_){}
  return {place,temp:Math.round(w.temperature_2m),feels:Math.round(w.apparent_temperature),
    humidity:w.relative_humidity_2m,wind:Math.round(w.wind_speed_10m),condition:WMO[w.weather_code]||"unknown conditions"};
}
const distance=(a,b,c,d)=>{
  const R=6371e3,rad=x=>x*Math.PI/180;
  const h=Math.sin(rad(c-a)/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(rad(d-b)/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
};
async function getRestaurants(lat,lon,radius=2000){
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error("Invalid coordinates");
  const q=`[out:json][timeout:20];(node["amenity"~"restaurant|cafe|fast_food"]["name"](around:${radius},${lat},${lon});way["amenity"~"restaurant|cafe|fast_food"]["name"](around:${radius},${lat},${lon}););out center 60;`;
  const response=await fetch("https://overpass-api.de/api/interpreter",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"FRIDAY-Assistant/1.0"},
    body:"data="+encodeURIComponent(q)
  });
  if(!response.ok)throw new Error("Places provider error");
  const data=await response.json();
  return (data.elements||[]).map(e=>{
    const lat2=e.lat??e.center?.lat,lon2=e.lon??e.center?.lon,t=e.tags||{};
    return {name:t.name,type:t.amenity,cuisine:(t.cuisine||"").replace(/;/g,", ").replace(/_/g," "),
      meters:Math.round(distance(lat,lon,lat2,lon2)),lat:lat2,lon:lon2};
  }).filter(x=>x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon))
    .sort((a,b)=>a.meters-b.meters).slice(0,8);
}
async function askGemini({message,history=[],persona="",context={}}){
  if(!GEMINI_KEY)return "The Gemini API key is not configured yet. Add GEMINI_API_KEY to your .env file, restart the server, and try again.";
  const system=`${persona}\nYou are a voice assistant. Reply in natural spoken sentences, without markdown unless requested. Keep answers concise unless the user asks for detail.\nCurrent local time: ${context.localTime||"unknown"}. User location: ${context.place||"unknown"}.`;
  const contents=[...history.slice(-12),{role:"user",text:message}]
    .filter(x=>x&&typeof x.text==="string")
    .map(x=>({role:x.role==="user"?"user":"model",parts:[{text:x.text}]}));
  const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":GEMINI_KEY},
    body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    console.error("Gemini API error:",response.status,JSON.stringify(data));
    if(response.status===429)return "Gemini is receiving too many requests at the moment. Please try again shortly.";
    if(response.status===400||response.status===403)return "Gemini could not accept the request. Please check your API key, model name and API access.";
    return `Gemini returned an error (${response.status}). Please check the server terminal.`;
  }
  return (data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim()
    ||"I couldn't generate a reply. Please try asking in a different way.";
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  const pathname=decodeURIComponent(url.pathname);
  try{
    if(pathname==="/api/health")return json(res,200,{ok:true,geminiConfigured:Boolean(GEMINI_KEY)});
    if(pathname==="/api/state"&&req.method==="GET")return json(res,200,readState());
    if(pathname==="/api/state"&&req.method==="PUT"){
      const s=JSON.parse(await readBody(req));
      const clean={tasks:Array.isArray(s.tasks)?s.tasks:[],reminders:Array.isArray(s.reminders)?s.reminders:[]};
      fs.writeFileSync(DATA_FILE,JSON.stringify(clean,null,2));
      return json(res,200,{ok:true});
    }
    if(pathname==="/api/weather"){
      try{return json(res,200,await getWeather(Number(url.searchParams.get("lat")),Number(url.searchParams.get("lon"))));}
      catch(e){return json(res,502,{error:"Weather service unavailable",detail:e.message});}
    }
    if(pathname==="/api/restaurants"){
      try{return json(res,200,await getRestaurants(Number(url.searchParams.get("lat")),Number(url.searchParams.get("lon"))));}
      catch(e){return json(res,502,{error:"Nearby places service unavailable",detail:e.message});}
    }
    if(pathname==="/api/chat"&&req.method==="POST"){
      const payload=JSON.parse(await readBody(req));
      if(typeof payload.message!=="string"||!payload.message.trim())return json(res,400,{error:"Message is required"});
      return json(res,200,{reply:await askGemini(payload)});
    }
  }catch(e){console.error("Request error:",pathname,e);return json(res,500,{error:"Server error",detail:e.message});}

  // Static files are restricted to this project directory.
  const requested=pathname==="/"?"/index.html":pathname;
  const file=path.resolve(ROOT,"."+requested);
  if(file!==ROOT&&!file.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end("Forbidden");}
  if([".env","server.js","data.json"].includes(path.basename(file))){res.writeHead(403);return res.end("Forbidden");}
  fs.readFile(file,(err,buffer)=>{
    if(err){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});return res.end("Not found");}
    res.writeHead(200,{"Content-Type":TYPES[path.extname(file).toLowerCase()]||"application/octet-stream"});
    res.end(buffer);
  });
});
server.listen(PORT,()=>console.log(`F.R.I.D.A.Y. is online at http://localhost:${PORT}${GEMINI_KEY?"":" (Gemini key not configured)"}`));
