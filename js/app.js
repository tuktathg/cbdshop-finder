const CSV_URL  = 'https://script.google.com/macros/s/AKfycbz582jLMD1nWvJp_e0DS-VGHtjldtyxVBEU8tA8jizw9bGt3IZQSY99Z4MpDkphgBkzrg/exec';
const OSRM_URL = 'https://router.project-osrm.org/table/v1/driving';
const BATCH    = 100;
const driveCache = {};

let stores = [], allStores = [];
let mapInstance = null, markers = [], userMarker = null;
let sidebarOpen = true;

// ── Null-safe helpers ─────────────────────────────────────
function $(id) { return document.getElementById(id); }
function setText(id, val) { const e=$(id); if(e) e.textContent=val; }
function setHtml(id, val) { const e=$(id); if(e) e.innerHTML=val; }
function show(id) { const e=$(id); if(e) e.style.display=''; }
function hide(id) { const e=$(id); if(e) e.style.display='none'; }
function rmClass(id, cls) { const e=$(id); if(e) e.classList.remove(cls); }
function addBadge(id, txt) { const e=$(id); if(e){ e.textContent=txt; e.classList.remove('hidden'); } }

function setStatus(id, msg, type) {
  const e=$(id); if(!e) return;
  e.textContent=msg;
  e.className='status-msg'+(type?' status-'+type:'');
}

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchSheet();
});

function initMap() {
  mapInstance = L.map('map', { zoomControl:true }).setView([13.75,100.5],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom:19
  }).addTo(mapInstance);
}

// ── Tab ───────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('.icon-btn[id^="nav-"]').forEach(e=>e.classList.remove('active'));
  const tc=$('tab-'+tab), nb=$('nav-'+tab);
  if(tc) tc.classList.add('active');
  if(nb) nb.classList.add('active');
  if(tab==='map') setTimeout(()=>mapInstance&&mapInstance.invalidateSize(),100);
}

// ── Sidebar ───────────────────────────────────────────────
function toggleSidebar() {
  sidebarOpen=!sidebarOpen;
  const sb=$('sidebar-map'), mw=$('map-wrap'), ic=$('toggle-icon');
  if(sb) sb.classList.toggle('collapsed',!sidebarOpen);
  if(mw) mw.classList.toggle('expanded',!sidebarOpen);
  if(ic) ic.style.transform=sidebarOpen?'':'rotate(180deg)';
  setTimeout(()=>mapInstance&&mapInstance.invalidateSize(),280);
}

// ── Fetch ─────────────────────────────────────────────────
async function fetchSheet() {
  setStatus('load-status','กำลังดึงข้อมูล...','');
  for(let attempt=1; attempt<=3; attempt++) {
    try {
      const res = await fetch(CSV_URL);
      if(!res.ok) throw new Error('HTTP '+res.status);
      const text = await res.text();
      if(!text||text.trim().startsWith('<')) throw new Error('ไม่ได้รับ CSV');
      processCSV(text);
      return;
    } catch(e) {
      if(attempt<3) {
        setStatus('load-status',`ลองใหม่ครั้งที่ ${attempt}/3...`,'');
        await new Promise(r=>setTimeout(r,1500*attempt));
      } else {
        setStatus('load-status','โหลดไม่ได้: '+e.message,'err');
        showRetryBtn();
      }
    }
  }
}

function showRetryBtn() {
  const ls=$('load-status'); if(!ls) return;
  let btn=$('retry-btn');
  if(!btn) {
    btn=document.createElement('button');
    btn.id='retry-btn'; btn.className='btn-retry';
    btn.innerHTML='↺ โหลดข้อมูลใหม่';
    btn.onclick=()=>{ btn.remove(); fetchSheet(); };
    ls.parentNode.insertBefore(btn,ls.nextSibling);
  }
}

// ── Process CSV ───────────────────────────────────────────
function processCSV(text) {
  const rows=Papa.parse(text,{skipEmptyLines:true}).data;
  if(rows.length<2){ setStatus('load-status','ไม่พบข้อมูล','err'); return; }
  const h=rows[0];
  const fc=arr=>{ for(const c of arr){ const i=h.findIndex(x=>x&&x.trim().toLowerCase()===c.toLowerCase()); if(i!==-1)return i; } return -1; };
  const C={
    id:fc(['รหัสร้านที่ทำงาน','รหัสร้าน','id']),
    type:fc(['ประเภทร้าน','ประเภท','type']),
    name:fc(['ชื่อร้าน','ชื่อ','name']),
    area:fc(['พื้นที่','area','zone']),
    status:fc(['STATUS','status','สถานะ']),
    wage:fc(['อัตราจ้าง','ค่าจ้าง','wage']),
    workday:fc(['วันทำงาน','วัน','workday']),
    worktime:fc(['เวลาทำงาน','เวลา','worktime']),
    lat:fc(['LAT','lat','latitude']),
    lng:fc(['LONG','lng','longitude','LON']),
  };
  if(C.lat===-1) C.lat=8; if(C.lng===-1) C.lng=9; if(C.name===-1) C.name=2;

  stores=[]; allStores=[]; let skipped=0;
  for(let i=1;i<rows.length;i++){
    const r=rows[i];
    const g=(col,fb='')=>col!==-1?(r[col]||fb).trim():fb;
    const name=g(C.name,'').trim(); if(!name) continue;
    const lat=parseFloat(r[C.lat]), lng=parseFloat(r[C.lng]);
    const hasCoord=!isNaN(lat)&&!isNaN(lng);
    const rec={id:g(C.id),type:g(C.type),name,area:g(C.area),status:g(C.status),wage:g(C.wage,'-'),workday:g(C.workday,'-'),worktime:g(C.worktime,'-'),lat:hasCoord?lat:null,lng:hasCoord?lng:null,hasCoord};
    allStores.push(rec);
    if(hasCoord) stores.push(rec); else skipped++;
  }
  if(!allStores.length){ setStatus('load-status','ไม่พบข้อมูล','err'); return; }

  setStatus('load-status',`โหลดสำเร็จ ${allStores.length} ร้าน (มีพิกัด ${stores.length} | ไม่มีพิกัด ${skipped})`,'ok');
  const badgeText=`ข้อมูลทั้งหมด ${allStores.length} รายการ`;
  addBadge('total-badge',badgeText);
  addBadge('search-total-badge',badgeText);
  addBadge('data-count-badge',allStores.length);
  populateFilters();
  filterStores();
}

function populateFilters() {
  const statuses=[...new Set(allStores.map(s=>s.status).filter(Boolean))].sort();
  const areas=[...new Set(allStores.map(s=>s.area).filter(Boolean))].sort();
  const fs=$('filter-status'), fa=$('filter-area');
  if(fs) fs.innerHTML='<option value="">ทุกสถานะ (Status BE)</option>'+statuses.map(s=>`<option value="${s}">${s}</option>`).join('');
  if(fa) fa.innerHTML='<option value="">ทุกพื้นที่ (Area/Zone)</option>'+areas.map(a=>`<option value="${a}">${a}</option>`).join('');
}

// ── Search tab ────────────────────────────────────────────
function filterStores() {
  const q=($('text-search')||{}).value||''; const ql=q.trim().toLowerCase();
  const st=($('filter-status')||{}).value||'';
  const ar=($('filter-area')||{}).value||'';
  const res=allStores.filter(s=>
    (!ql||s.name.toLowerCase().includes(ql)||s.type.toLowerCase().includes(ql)||s.area.toLowerCase().includes(ql)||s.id.toLowerCase().includes(ql))&&
    (!st||s.status===st)&&(!ar||s.area===ar)
  );
  rmClass('search-results-header','hidden');
  setText('search-result-count',`พบ ${res.length} รายการ จากทั้งหมด ${allStores.length} รายการ`);
  const el=$('search-result-list'); if(!el) return;
  if(!res.length){
    el.innerHTML=`<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><div class="empty-title">ไม่พบข้อมูลร้านค้า</div><div class="empty-sub">ลองเปลี่ยนคำค้นหาใหม่</div></div>`;
    return;
  }
  el.innerHTML=`<div class="search-store-grid">${res.slice(0,100).map((s,i)=>cardHTML(s,i,null,null,false)).join('')}</div>`
    +(res.length>100?`<div style="text-align:center;padding:12px;font-size:12px;color:#8a96a3">แสดง 100 จาก ${res.length} รายการ</div>`:'');
}

// ── Helpers ───────────────────────────────────────────────
function haversine(a,b,c,d){const R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function fmtDist(km){return km<1?`${Math.round(km*1000)} ม.`:`${km.toFixed(1)} กม.`;}
function fmtDur(s){if(!s)return'';const m=Math.round(s/60);return m<60?`~${m} นาที`:`~${Math.floor(m/60)} ชม. ${m%60} นาที`;}
function cacheKey(a,b,c,d){return`${a},${b}|${c},${d}`;}
function clearCoord(){const e=$('coord-input');if(e)e.value='';setStatus('search-status','','');}
function openMaps(lat,lng,name){const q=(lat&&lng)?`${lat},${lng}`:encodeURIComponent(name||'');if(q)window.open(`https://www.google.com/maps/search/?api=1&query=${q}`,'_blank');}

function statusColor(v){v=(v||'').toLowerCase();if(v.includes('ทำงานอยู่')||v.includes('working')||v.includes('active'))return'tag-status-open';if(v.includes('สรรหา')||v.includes('recruit')||v.includes('hiring'))return'tag-status-full';return'tag-status-other';}

function cardHTML(s,i,distKm,durSec,isMap){
  const tagArea=s.area?`<span class="tag tag-area">${s.area}</span>`:'';
  const tagType=s.type?`<span class="tag tag-gray">${s.type}</span>`:'';
  const tagStatus=s.status?`<span class="tag ${statusColor(s.status)}">${s.status}</span>`:'';
  const noCoord=!s.hasCoord?'<span class="tag tag-nocoord">✕ ไม่มีพิกัด</span>':'';
  const sn=s.name.replace(/'/g,"\\'");
  const cardClick=isMap?`onclick="focusMarker(${i})"`:`onclick="openMaps(${s.lat},${s.lng},'${sn}')"`;
  const nameClick=`onclick="event.stopPropagation();openMaps(${s.lat},${s.lng},'${sn}')"`;
  const distHTML=distKm!==null?`<div class="store-dist-wrap"><div class="store-dist">🚗 ${fmtDist(distKm)}</div>${durSec?`<div class="store-duration">${fmtDur(durSec)}</div>`:''}</div>`:'';
  return`<div class="store-card clickable" ${cardClick}>
    <div class="store-card-top">
      <div class="store-num">${i+1}</div>
      <div class="store-name-wrap"><span class="store-name" ${nameClick}>${s.name}</span>${s.id?`<span class="store-id">${s.id}</span>`:''}</div>
      ${distHTML}
    </div>
    <div class="store-tags">${noCoord}${tagArea}${tagType}${tagStatus}</div>
    <div class="store-meta-grid">
      <div class="meta-item"><div class="meta-label">อัตราจ้าง</div><div class="meta-value">${s.wage||'-'}</div></div>
      <div class="meta-item"><div class="meta-label">วันทำงาน</div><div class="meta-value">${s.workday||'-'}</div></div>
      <div class="meta-item"><div class="meta-label">เวลาทำงาน</div><div class="meta-value">${s.worktime||'-'}</div></div>
    </div>
    <div class="store-card-footer">
      <button class="btn-maps" onclick="event.stopPropagation();openMaps(${s.lat},${s.lng},'${sn}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Google Maps
      </button>
    </div>
  </div>`;
}

// ── OSRM ─────────────────────────────────────────────────
async function fetchDriving(uLat,uLng,targets){
  const uncached=targets.filter(s=>!driveCache[cacheKey(uLat,uLng,s.lat,s.lng)]);
  for(let i=0;i<uncached.length;i+=BATCH){
    const batch=uncached.slice(i,i+BATCH);
    const coords=[`${uLng},${uLat}`,...batch.map(s=>`${s.lng},${s.lat}`)].join(';');
    const dests=batch.map((_,idx)=>idx+1).join(';');
    try{
      const res=await fetch(`${OSRM_URL}/${coords}?sources=0&destinations=${dests}&annotations=duration,distance`);
      const data=await res.json();
      if(data.code!=='Ok') throw new Error(data.message);
      batch.forEach((s,idx)=>{
        const key=cacheKey(uLat,uLng,s.lat,s.lng);
        const dur=data.durations?.[0]?.[idx], dst=data.distances?.[0]?.[idx];
        driveCache[key]={distKm:dst!=null?dst/1000:haversine(uLat,uLng,s.lat,s.lng),durSec:dur??null};
      });
    }catch(e){
      batch.forEach(s=>{ const k=cacheKey(uLat,uLng,s.lat,s.lng); if(!driveCache[k]) driveCache[k]={distKm:haversine(uLat,uLng,s.lat,s.lng),durSec:null}; });
    }
  }
}

// ── Map search ────────────────────────────────────────────
function useMyLocation(){
  setStatus('search-status','กำลังขอตำแหน่ง GPS...','');
  if(!navigator.geolocation){setStatus('search-status','browser ไม่รองรับ GPS','err');return;}
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const lat=pos.coords.latitude.toFixed(7),lng=pos.coords.longitude.toFixed(7);
      const ci=$('coord-input'); if(ci) ci.value=`${lat},${lng}`;
      setStatus('search-status',`ได้ตำแหน่ง: ${lat}, ${lng}`,'ok');
      doSearch(parseFloat(lat),parseFloat(lng));
    },
    err=>setStatus('search-status','ไม่สามารถรับตำแหน่ง: '+err.message,'err')
  );
}

function searchFromInput(){
  const ci=$('coord-input'); if(!ci) return;
  const val=ci.value.trim();
  if(!val){setStatus('search-status','กรุณากรอกพิกัด','err');return;}
  const p=val.split(',').map(s=>parseFloat(s.trim()));
  if(p.length<2||isNaN(p[0])||isNaN(p[1])){setStatus('search-status','รูปแบบพิกัดไม่ถูกต้อง เช่น 13.6951,100.4990','err');return;}
  doSearch(p[0],p[1]);
}

async function doSearch(uLat,uLng){
  if(!stores.length){setStatus('search-status','ข้อมูลยังโหลดไม่สำเร็จ กรุณารอหรือรีเฟรช','err');return;}
  const radius=parseInt(($('radius-slider')||{}).value||'10');
  const cands=stores.map(s=>({...s,sd:haversine(uLat,uLng,s.lat,s.lng)})).filter(s=>s.sd<=radius*1.3).sort((a,b)=>a.sd-b.sd).slice(0,150);
  setStatus('search-status','กำลังคำนวณระยะทางขับรถ...','');
  show('results-section');
  await fetchDriving(uLat,uLng,cands);
  const nearby=cands.map(s=>{const c=driveCache[cacheKey(uLat,uLng,s.lat,s.lng)];return{...s,distKm:c?.distKm??s.sd,durSec:c?.durSec??null};}).filter(s=>s.distKm<=radius).sort((a,b)=>a.distKm-b.distKm);
  setStatus('search-status',`พบ ${nearby.length} ร้านในรัศมี ${radius} กม.`,nearby.length>0?'ok':'warn');
  setText('result-label',`พิกัดในรัศมี ${radius} กม.`);
  setText('result-count',`${nearby.length} รายการ`);
  renderUserMarker(uLat,uLng);
  renderMarkers(nearby);
  const sl=$('store-list'); if(sl) sl.innerHTML=nearby.length===0?`<div style="text-align:center;padding:2rem;color:#8a96a3;font-size:13px">ไม่พบร้านค้าในรัศมีที่กำหนด</div>`:nearby.slice(0,50).map((s,i)=>cardHTML(s,i,s.distKm,s.durSec,true)).join('')+(nearby.length>50?`<div style="text-align:center;font-size:12px;color:#8a96a3;padding:10px">แสดง 50 จาก ${nearby.length} รายการ</div>`:'');
  if(nearby.length>0) mapInstance.fitBounds(L.latLngBounds([[uLat,uLng],...nearby.map(s=>[s.lat,s.lng])]),{padding:[40,40]});
  else mapInstance.setView([uLat,uLng],13);
}

function renderUserMarker(lat,lng){
  if(userMarker) userMarker.remove();
  userMarker=L.marker([lat,lng],{icon:L.divIcon({html:`<div style="width:18px;height:18px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(37,99,235,0.4)"></div>`,className:'',iconAnchor:[9,9]})}).addTo(mapInstance).bindPopup('<b>📍 ตำแหน่งของคุณ</b>');
}

function renderMarkers(nearby){
  markers.forEach(m=>m.remove());
  markers=nearby.map((s,i)=>{
    const m=L.marker([s.lat,s.lng],{icon:L.divIcon({html:`<div style="background:#1a8a5a;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2.5px solid white;box-shadow:0 2px 8px rgba(26,138,90,0.35)">${i+1}</div>`,className:'',iconAnchor:[14,14]})}).addTo(mapInstance);
    m.bindPopup([`<b>${s.name}</b>`,`🚗 ${fmtDist(s.distKm)}${s.durSec?' · '+fmtDur(s.durSec):''}`,s.area?`📌 ${s.area}`:'',s.type?`🏪 ${s.type}`:'',s.status?`⭕ ${s.status}`:'',s.wage?`💰 ${s.wage}`:'',s.worktime?`🕐 ${s.worktime}`:''].filter(Boolean).join('<br>'));
    return m;
  });
}

function focusMarker(i){if(markers[i]){mapInstance.setView(markers[i].getLatLng(),15);markers[i].openPopup();}}
