// ── Config ──────────────────────────────────────────────
const SHEET_ID  = '1sKiG1H1Cn9zSSXQzenhAm8theiEJf4_RlcxxcXwiK6I';
const GID       = '271631235';
const CSV_URL   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
const OSRM_URL  = 'https://router.project-osrm.org/table/v1/driving';
const BATCH     = 100;
const driveCache = {};

// ── State ────────────────────────────────────────────────
let stores = [];      // ร้านที่มีพิกัด (หน้าแผนที่)
let allStores = [];   // ร้านทั้งหมด (หน้าค้นหา)
let mapInstance = null, markers = [], userMarker = null;
let sidebarOpen = true, dataPanelOpen = true, manualVisible = false;

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchSheet();
});

function initMap() {
  mapInstance = L.map('map', { zoomControl: true }).setView([13.75, 100.5], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">Leaflet</a> | © OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(mapInstance);
}

// ── Tab ───────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.icon-btn[id^="nav-"]').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  if (tab === 'map') setTimeout(() => mapInstance && mapInstance.invalidateSize(), 100);
}

// ── Sidebar ───────────────────────────────────────────────
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  const sb = document.getElementById('sidebar-map');
  const mw = document.getElementById('map-wrap');
  sb.classList.toggle('collapsed', !sidebarOpen);
  mw.classList.toggle('expanded', !sidebarOpen);
  document.getElementById('toggle-icon').style.transform = sidebarOpen ? '' : 'rotate(180deg)';
  setTimeout(() => mapInstance && mapInstance.invalidateSize(), 280);
}
function toggleDataPanel() {
  dataPanelOpen = !dataPanelOpen;
  document.getElementById('data-panel').style.display = dataPanelOpen ? '' : 'none';
  document.getElementById('data-arrow').classList.toggle('up', dataPanelOpen);
}
function toggleManual() {
  manualVisible = !manualVisible;
  document.getElementById('manual-panel').classList.toggle('hidden', !manualVisible);
}

// ── Helpers ──────────────────────────────────────────────
function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' status-' + type : '');
}
function showLoadBar(pct) {
  const bar = document.getElementById('load-bar');
  if (pct === null) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  document.getElementById('load-bar-inner').style.width = pct + '%';
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function fmtDist(km) { return km < 1 ? `${Math.round(km*1000)} ม.` : `${km.toFixed(1)} กม.`; }
function fmtDur(sec) {
  if (!sec) return '';
  const m = Math.round(sec/60);
  return m < 60 ? `~${m} นาที` : `~${Math.floor(m/60)} ชม. ${m%60} นาที`;
}
function cacheKey(uLat, uLng, sLat, sLng) { return `${uLat},${uLng}|${sLat},${sLng}`; }
function clearCoord() { document.getElementById('coord-input').value = ''; setStatus('search-status','',''); }
function openMaps(lat, lng, name) {
  const q = (lat && lng) ? `${lat},${lng}` : encodeURIComponent(name||'');
  if (q) window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
}

// ── OSRM ─────────────────────────────────────────────────
async function fetchDriving(uLat, uLng, targets) {
  const uncached = targets.filter(s => !driveCache[cacheKey(uLat, uLng, s.lat, s.lng)]);
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH);
    const coords = [`${uLng},${uLat}`, ...batch.map(s => `${s.lng},${s.lat}`)].join(';');
    const dests  = batch.map((_,idx) => idx+1).join(';');
    try {
      const res  = await fetch(`${OSRM_URL}/${coords}?sources=0&destinations=${dests}&annotations=duration,distance`);
      const data = await res.json();
      if (data.code !== 'Ok') throw new Error(data.message);
      batch.forEach((s, idx) => {
        const key = cacheKey(uLat, uLng, s.lat, s.lng);
        const dur = data.durations?.[0]?.[idx];
        const dst = data.distances?.[0]?.[idx];
        driveCache[key] = {
          distKm: dst != null ? dst/1000 : haversine(uLat, uLng, s.lat, s.lng),
          durSec: dur ?? null,
        };
      });
    } catch(e) {
      batch.forEach(s => {
        const key = cacheKey(uLat, uLng, s.lat, s.lng);
        if (!driveCache[key]) driveCache[key] = { distKm: haversine(uLat, uLng, s.lat, s.lng), durSec: null };
      });
    }
  }
}

// ── Sheet ─────────────────────────────────────────────────
let fetchPromise = null;

async function fetchSheet(retry = 3) {
  showLoadBar(10);
  setStatus('load-status', 'กำลังดึงข้อมูล...', '');
  hideRetryBtn();

  for (let attempt = 1; attempt <= retry; attempt++) {
    try {
      showLoadBar(20 + attempt * 20);
      const res = await fetch(CSV_URL + '&t=' + Date.now()); // bust cache
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!text || text.trim().startsWith('<')) throw new Error('ได้รับ HTML แทน CSV — Sheet อาจยังไม่ Public');
      showLoadBar(100);
      setTimeout(() => showLoadBar(null), 500);
      processCSV(text);
      return; // success
    } catch(e) {
      if (attempt < retry) {
        setStatus('load-status', `ลองใหม่ครั้งที่ ${attempt}/${retry}...`, '');
        await new Promise(r => setTimeout(r, 1500 * attempt));
      } else {
        showLoadBar(null);
        setStatus('load-status', `โหลดไม่ได้: ${e.message}`, 'err');
        showRetryBtn();
      }
    }
  }
}

function showRetryBtn() {
  let btn = document.getElementById('retry-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'retry-btn';
    btn.className = 'btn-retry';
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> โหลดข้อมูลใหม่';
    btn.onclick = () => fetchSheet();
    const el = document.getElementById('load-status');
    el.parentNode.insertBefore(btn, el.nextSibling);
  }
  btn.style.display = 'inline-flex';
}
function hideRetryBtn() {
  const btn = document.getElementById('retry-btn');
  if (btn) btn.style.display = 'none';
}
function parseCSV() {
  const raw = document.getElementById('csv-input').value.trim();
  if (!raw) { setStatus('load-status', 'กรุณาวาง CSV', 'warn'); return; }
  processCSV(raw);
}
function processCSV(text) {
  const rows = Papa.parse(text, { skipEmptyLines: true }).data;
  if (rows.length < 2) { setStatus('load-status', 'ไม่พบข้อมูล', 'err'); return; }
  const h = rows[0];
  const fc = (arr) => { for (const c of arr) { const i = h.findIndex(x => x&&x.trim().toLowerCase()===c.toLowerCase()); if (i!==-1) return i; } return -1; };
  const C = {
    id:       fc(['รหัสร้านที่ทำงาน','รหัสร้าน','id']),
    type:     fc(['ประเภทร้าน','ประเภท','type']),
    name:     fc(['ชื่อร้าน','ชื่อ','name']),
    area:     fc(['พื้นที่','area','zone']),
    status:   fc(['STATUS','status','สถานะ']),
    wage:     fc(['อัตราจ้าง','ค่าจ้าง','wage']),
    workday:  fc(['วันทำงาน','วัน','workday']),
    worktime: fc(['เวลาทำงาน','เวลา','worktime']),
    lat:      fc(['LAT','lat','latitude']),
    lng:      fc(['LONG','lng','longitude','LON']),
  };
  if (C.lat===-1) C.lat=8; if (C.lng===-1) C.lng=9; if (C.name===-1) C.name=2;

  stores = []; allStores = []; let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const g = (col, fb='') => col!==-1 ? (r[col]||fb).trim() : fb;
    const name = g(C.name,'').trim();
    if (!name) continue;
    const lat = parseFloat(r[C.lat]), lng = parseFloat(r[C.lng]);
    const hasCoord = !isNaN(lat) && !isNaN(lng);
    const rec = { id:g(C.id), type:g(C.type), name, area:g(C.area), status:g(C.status), wage:g(C.wage,'-'), workday:g(C.workday,'-'), worktime:g(C.worktime,'-'), lat:hasCoord?lat:null, lng:hasCoord?lng:null, hasCoord };
    allStores.push(rec);
    if (hasCoord) stores.push(rec); else skipped++;
  }
  if (!stores.length) { setStatus('load-status','ไม่พบแถวที่มีพิกัด','err'); return; }
  setStatus('load-status', `โหลดสำเร็จ ${allStores.length} ร้าน (มีพิกัด ${stores.length} | ไม่มีพิกัด ${skipped})`, 'ok');

  ['total-badge','search-total-badge'].forEach(id => {
    const b = document.getElementById(id);
    b.textContent = `ข้อมูลทั้งหมด ${allStores.length} รายการ`; b.classList.remove('hidden');
  });
  document.getElementById('data-count-badge').textContent = allStores.length;
  document.getElementById('data-count-badge').classList.remove('hidden');
  populateFilters();
  filterStores();
}
function populateFilters() {
  const statuses = [...new Set(stores.map(s=>s.status).filter(Boolean))].sort();
  const areas    = [...new Set(stores.map(s=>s.area).filter(Boolean))].sort();
  document.getElementById('filter-status').innerHTML =
    '<option value="">ทุกสถานะ (Status BE)</option>'+statuses.map(s=>`<option value="${s}">${s}</option>`).join('');
  document.getElementById('filter-area').innerHTML =
    '<option value="">ทุกพื้นที่ (Area/Zone)</option>'+areas.map(a=>`<option value="${a}">${a}</option>`).join('');
}

// ── Search tab ────────────────────────────────────────────
function filterStores() {
  const q  = (document.getElementById('text-search').value||'').trim().toLowerCase();
  const st = document.getElementById('filter-status').value;
  const ar = document.getElementById('filter-area').value;
  const res = allStores.filter(s =>
    (!q||s.name.toLowerCase().includes(q)||s.type.toLowerCase().includes(q)||s.area.toLowerCase().includes(q)||s.id.toLowerCase().includes(q)) &&
    (!st||s.status===st) && (!ar||s.area===ar)
  );
  if (stores.length > 0) {
    document.getElementById('search-results-header').classList.remove('hidden');
    document.getElementById('search-result-count').textContent = `พบ ${res.length} รายการ จากทั้งหมด ${allStores.length} รายการ`;
  }
  const el = document.getElementById('search-result-list');
  if (!res.length) {
    el.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><div class="empty-title">ไม่พบข้อมูลร้านค้า</div><div class="empty-sub">ลองเปลี่ยนคำค้นหาใหม่อีกครั้ง</div></div>`;
    return;
  }
  // หน้าค้นหา: ไม่มีระยะ, คลิก card/ชื่อ → Google Maps
  el.innerHTML = `<div class="search-store-grid">${res.slice(0,100).map((s,i)=>cardHTML(s,i,null,null,false)).join('')}</div>`
    + (res.length>100 ? `<div style="text-align:center;padding:12px;font-size:12px;color:#8a96a3">แสดง 100 จาก ${res.length} รายการ</div>` : '');
}

// ── Card HTML ─────────────────────────────────────────────
function statusColor(v) {
  v = (v||'').toLowerCase();
  if (v.includes('ว่าง')||v.includes('open')||v.includes('available')) return 'tag-status-open';
  if (v.includes('เต็ม')||v.includes('full')||v.includes('close'))     return 'tag-status-full';
  return 'tag-status-other';
}
// isMap: true=หน้าแผนที่ (card click = zoom, ชื่อ click = maps), false=หน้าค้นหา (ทุก click = maps)
function cardHTML(s, i, distKm, durSec, isMap) {
  const noCoordTag = !s.hasCoord ? '<span class="tag tag-nocoord">✕ ไม่มีพิกัด</span>' : '';
  const tagArea   = s.area   ? `<span class="tag tag-area">${s.area}</span>` : '';
  const tagType   = s.type   ? `<span class="tag tag-gray">${s.type}</span>` : '';
  const tagStatus = s.status ? `<span class="tag ${statusColor(s.status)}">${s.status}</span>` : '';
  const safeName  = s.name.replace(/'/g,"\\'");

  // card click
  const cardOnClick = isMap
    ? `onclick="focusMarker(${i})"`
    : `onclick="openMaps(${s.lat},${s.lng},'${s.name.replace(/'/g,String.fromCharCode(39))}')"`;

  // ชื่อร้าน click → เปิด Google Maps เสมอ
  const nameOnClick = isMap
    ? `onclick="event.stopPropagation();openMaps(${s.lat},${s.lng},'${s.name.replace(/'/g,String.fromCharCode(39))}')" `
    : `onclick="event.stopPropagation();openMaps(${s.lat},${s.lng},'${s.name.replace(/'/g,String.fromCharCode(39))}')" `;

  // ระยะ + เวลา (หน้าแผนที่เท่านั้น)
  const distHTML = distKm !== null ? `
    <div class="store-dist-wrap">
      <div class="store-dist">🚗 ${fmtDist(distKm)}</div>
      ${durSec ? `<div class="store-duration">${fmtDur(durSec)}</div>` : ''}
    </div>` : '';

  return `<div class="store-card clickable" ${cardOnClick}>
    <div class="store-card-top">
      <div class="store-num">${i+1}</div>
      <div class="store-name-wrap">
        <span class="store-name" ${nameOnClick}>${s.name}</span>
        ${s.id ? `<span class="store-id">${s.id}</span>` : ''}
      </div>
      ${distHTML}
    </div>
    <div class="store-tags">${noCoordTag}${tagArea}${tagType}${tagStatus}</div>
    <div class="store-meta-grid">
      <div class="meta-item"><div class="meta-label">อัตราจ้าง</div><div class="meta-value">${s.wage||'-'}</div></div>
      <div class="meta-item"><div class="meta-label">วันทำงาน</div><div class="meta-value">${s.workday||'-'}</div></div>
      <div class="meta-item"><div class="meta-label">เวลาทำงาน</div><div class="meta-value">${s.worktime||'-'}</div></div>
    </div>
    <div class="store-card-footer">
      <button class="btn-maps" onclick="event.stopPropagation();openMaps(${s.lat},${s.lng},'${s.name.replace(/'/g,String.fromCharCode(39))}')" >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Google Maps
      </button>
    </div>
  </div>`;
}

// ── Map search ────────────────────────────────────────────
function useMyLocation() {
  setStatus('search-status', 'กำลังขอตำแหน่ง GPS...', '');
  if (!navigator.geolocation) { setStatus('search-status', 'browser ไม่รองรับ GPS', 'err'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(7), lng = pos.coords.longitude.toFixed(7);
      document.getElementById('coord-input').value = `${lat},${lng}`;
      setStatus('search-status', `ได้ตำแหน่ง: ${lat}, ${lng}`, 'ok');
      doSearch(parseFloat(lat), parseFloat(lng));
    },
    err => setStatus('search-status', 'ไม่สามารถรับตำแหน่ง: '+err.message, 'err')
  );
}
function searchFromInput() {
  const val = document.getElementById('coord-input').value.trim();
  if (!val) { setStatus('search-status', 'กรุณากรอกพิกัด', 'err'); return; }
  const p = val.split(',').map(s => parseFloat(s.trim()));
  if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) { setStatus('search-status', 'รูปแบบพิกัดไม่ถูกต้อง เช่น 13.6951,100.4990', 'err'); return; }
  doSearch(p[0], p[1]);
}
async function doSearch(uLat, uLng) {
  if (!stores.length) {
    setStatus('search-status', 'ข้อมูลยังโหลดไม่สำเร็จ — กรุณากด "โหลดข้อมูลใหม่" ในแถบด้านล่าง', 'err');
    return;
  }
  const radius = parseInt(document.getElementById('radius-slider').value);

  const cands = stores
    .map(s => ({ ...s, sd: haversine(uLat, uLng, s.lat, s.lng) }))
    .filter(s => s.sd <= radius * 1.3).sort((a,b)=>a.sd-b.sd).slice(0,150);

  setStatus('search-status', 'กำลังคำนวณระยะทางขับรถ...', '');
  document.getElementById('results-section').style.display = '';

  await fetchDriving(uLat, uLng, cands);

  const nearby = cands.map(s => {
    const c = driveCache[cacheKey(uLat, uLng, s.lat, s.lng)];
    return { ...s, distKm: c?.distKm ?? s.sd, durSec: c?.durSec ?? null };
  }).filter(s => s.distKm <= radius).sort((a,b) => a.distKm - b.distKm);

  setStatus('search-status', `พบ ${nearby.length} ร้านในรัศมี ${radius} กม. (ระยะขับรถ)`, nearby.length>0?'ok':'warn');
  document.getElementById('result-label').textContent = `พิกัดในรัศมี ${radius} กม.`;
  document.getElementById('result-count').textContent = `${nearby.length} รายการ`;

  renderUserMarker(uLat, uLng);
  renderMarkers(nearby);
  // หน้าแผนที่: isMap=true
  document.getElementById('store-list').innerHTML = nearby.length === 0
    ? `<div style="text-align:center;padding:2rem;color:#8a96a3;font-size:13px">ไม่พบร้านค้าในรัศมีที่กำหนด</div>`
    : nearby.slice(0,50).map((s,i)=>cardHTML(s,i,s.distKm,s.durSec,true)).join('')
      + (nearby.length>50 ? `<div style="text-align:center;font-size:12px;color:#8a96a3;padding:10px">แสดง 50 จาก ${nearby.length} รายการ</div>` : '');

  if (nearby.length > 0) mapInstance.fitBounds(L.latLngBounds([[uLat,uLng],...nearby.map(s=>[s.lat,s.lng])]),{padding:[40,40]});
  else mapInstance.setView([uLat,uLng],13);
}
function renderUserMarker(lat, lng) {
  if (userMarker) userMarker.remove();
  userMarker = L.marker([lat,lng],{icon:L.divIcon({
    html:`<div style="width:18px;height:18px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(37,99,235,0.4)"></div>`,
    className:'',iconAnchor:[9,9]
  })}).addTo(mapInstance).bindPopup('<b>📍 ตำแหน่งของคุณ</b>');
}
function renderMarkers(nearby) {
  markers.forEach(m=>m.remove());
  markers = nearby.map((s,i) => {
    const m = L.marker([s.lat,s.lng],{icon:L.divIcon({
      html:`<div style="background:#1a8a5a;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2.5px solid white;box-shadow:0 2px 8px rgba(26,138,90,0.35)">${i+1}</div>`,
      className:'',iconAnchor:[14,14]
    })}).addTo(mapInstance);
    m.bindPopup([`<b>${s.name}</b>`,`🚗 ${fmtDist(s.distKm)}${s.durSec?' · '+fmtDur(s.durSec):''}`,s.area?`📌 ${s.area}`:'',s.type?`🏪 ${s.type}`:'',s.status?`⭕ ${s.status}`:'',s.wage?`💰 ${s.wage}`:'',s.worktime?`🕐 ${s.worktime}`:''].filter(Boolean).join('<br>'));
    return m;
  });
}
function focusMarker(i) {
  if (markers[i]) { mapInstance.setView(markers[i].getLatLng(),15); markers[i].openPopup(); }
}
