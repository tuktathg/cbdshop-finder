// ── Config ──────────────────────────────────────────────
const SHEET_ID   = '1sKiG1H1Cn9zSSXQzenhAm8theiEJf4_RlcxxcXwiK6I';
const GID        = '271631235';
const CSV_URL    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
// OSRM public API — ฟรี ไม่ต้อง key (ใช้ข้อมูล OpenStreetMap)
const OSRM_URL   = 'https://router.project-osrm.org/table/v1/driving';
const BATCH_SIZE = 100; // OSRM รับได้สูงสุด ~100 จุดต่อ request

const driveCache = {}; // cache: "uLat,uLng|sLat,sLng" → { distKm, durationMin }

// ── State ────────────────────────────────────────────────
let stores        = [];
let mapInstance   = null;
let markers       = [];
let userMarker    = null;
let sidebarOpen   = true;
let dataPanelOpen = true;
let manualVisible = false;
let currentTab    = 'search';

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  switchTab('search');
  fetchSheet();
});

function initMapOnce() {
  if (mapInstance) return;
  mapInstance = L.map('map', { zoomControl: true }).setView([13.75, 100.5], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">Leaflet</a> | © <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(mapInstance);
}

// ── Tab switching ─────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.icon-btn[id^="nav-"]').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  if (tab === 'map') {
    initMapOnce();
    setTimeout(() => mapInstance && mapInstance.invalidateSize(), 100);
  }
}

// ── Sidebar ───────────────────────────────────────────────
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar-map').classList.toggle('collapsed', !sidebarOpen);
  document.getElementById('toggle-icon').style.transform = sidebarOpen ? '' : 'rotate(180deg)';
  setTimeout(() => mapInstance && mapInstance.invalidateSize(), 320);
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
function formatDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} ม.` : `${km.toFixed(1)} กม.`;
}
function formatDuration(sec) {
  const min = Math.round(sec / 60);
  if (min < 60) return `~${min} นาที`;
  return `~${Math.floor(min/60)} ชม. ${min%60} นาที`;
}
function clearCoord() {
  document.getElementById('coord-input').value = '';
  setStatus('search-status', '', '');
}
function cacheKey(uLat, uLng, sLat, sLng) {
  return `${uLat},${uLng}|${sLat},${sLng}`;
}

// ── OSRM Driving Distance ─────────────────────────────────
// OSRM /table endpoint: source=user, destinations=stores
// คืน duration matrix (วินาที) และ distance matrix (เมตร)
async function fetchDrivingDistances(userLat, userLng, targets) {
  const uncached = targets.filter(s => !driveCache[cacheKey(userLat, userLng, s.lat, s.lng)]);
  if (!uncached.length) return;

  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);

    // format: lng,lat;lng,lat;... (OSRM ใช้ lng ก่อน lat)
    const coords = [`${userLng},${userLat}`, ...batch.map(s => `${s.lng},${s.lat}`)].join(';');
    // source=0 (user), destinations=1..N (stores)
    const destinations = batch.map((_, idx) => idx + 1).join(';');
    const url = `${OSRM_URL}/${coords}?sources=0&destinations=${destinations}&annotations=duration,distance`;

    try {
      const res  = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok') continue;

      const durations = data.durations[0];  // array ของ duration (วินาที) จาก source→ each dest
      const distances = data.distances[0];  // array ของ distance (เมตร)

      batch.forEach((s, idx) => {
        const key = cacheKey(userLat, userLng, s.lat, s.lng);
        const dur = durations ? durations[idx] : null;
        const dst = distances ? distances[idx] : null;
        driveCache[key] = {
          distKm:      dst !== null ? dst / 1000 : haversine(userLat, userLng, s.lat, s.lng),
          durationSec: dur,
        };
      });
    } catch(e) {
      console.warn('OSRM error:', e);
      // fallback: ใส่ haversine ใน cache เพื่อไม่ retry
      batch.forEach(s => {
        const key = cacheKey(userLat, userLng, s.lat, s.lng);
        if (!driveCache[key]) driveCache[key] = { distKm: haversine(userLat, userLng, s.lat, s.lng), durationSec: null };
      });
    }
  }
}

// ── Fetch & parse sheet ──────────────────────────────────
async function fetchSheet() {
  showLoadBar(20);
  setStatus('load-status', 'กำลังดึงข้อมูล...', '');
  try {
    const res = await fetch(CSV_URL);
    showLoadBar(70);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    showLoadBar(100);
    setTimeout(() => showLoadBar(null), 500);
    processCSV(text);
  } catch(e) {
    showLoadBar(null);
    setStatus('load-status', `โหลดไม่ได้: ${e.message}`, 'err');
  }
}
function parseCSV() {
  const raw = document.getElementById('csv-input').value.trim();
  if (!raw) { setStatus('load-status', 'กรุณาวาง CSV ก่อน', 'warn'); return; }
  processCSV(raw);
}
function processCSV(text) {
  const result = Papa.parse(text, { skipEmptyLines: true });
  const rows = result.data;
  if (rows.length < 2) { setStatus('load-status', 'ไม่พบข้อมูล', 'err'); return; }

  const header = rows[0];
  const fc = (candidates) => {
    for (const c of candidates) {
      const i = header.findIndex(h => h && h.trim().toLowerCase() === c.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const cols = {
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
  if (cols.lat  === -1) cols.lat  = 8;
  if (cols.lng  === -1) cols.lng  = 9;
  if (cols.name === -1) cols.name = 2;

  stores = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const lat = parseFloat(r[cols.lat]);
    const lng = parseFloat(r[cols.lng]);
    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }
    stores.push({
      id:       cols.id       !== -1 ? (r[cols.id]||'').trim() : '',
      type:     cols.type     !== -1 ? (r[cols.type]||'').trim() : '',
      name:     cols.name     !== -1 ? (r[cols.name]||`ร้าน #${i}`).trim() : `ร้าน #${i}`,
      area:     cols.area     !== -1 ? (r[cols.area]||'').trim() : '',
      status:   cols.status   !== -1 ? (r[cols.status]||'').trim() : '',
      wage:     cols.wage     !== -1 ? (r[cols.wage]||'-').trim() : '-',
      workday:  cols.workday  !== -1 ? (r[cols.workday]||'-').trim() : '-',
      worktime: cols.worktime !== -1 ? (r[cols.worktime]||'-').trim() : '-',
      lat, lng,
    });
  }
  if (!stores.length) { setStatus('load-status', 'ไม่พบแถวที่มีพิกัด', 'err'); return; }

  setStatus('load-status', `โหลดสำเร็จ ${stores.length} ร้าน${skipped > 0 ? ` (ข้าม ${skipped})` : ''}`, 'ok');
  ['total-badge','search-total-badge'].forEach(id => {
    const b = document.getElementById(id);
    b.textContent = `ข้อมูลทั้งหมด ${stores.length} รายการ`;
    b.classList.remove('hidden');
  });
  document.getElementById('data-count-badge').textContent = stores.length;
  document.getElementById('data-count-badge').classList.remove('hidden');
  populateFilters();
  filterStores();
}
function populateFilters() {
  const statuses = [...new Set(stores.map(s => s.status).filter(Boolean))].sort();
  const areas    = [...new Set(stores.map(s => s.area).filter(Boolean))].sort();
  document.getElementById('filter-status').innerHTML =
    '<option value="">ทุกสถานะ (Status BE)</option>' + statuses.map(s => `<option value="${s}">${s}</option>`).join('');
  document.getElementById('filter-area').innerHTML =
    '<option value="">ทุกพื้นที่ (Area/Zone)</option>' + areas.map(a => `<option value="${a}">${a}</option>`).join('');
}

// ── Search tab ────────────────────────────────────────────
function filterStores() {
  const q      = (document.getElementById('text-search').value || '').trim().toLowerCase();
  const status = document.getElementById('filter-status').value;
  const area   = document.getElementById('filter-area').value;
  const results = stores.filter(s =>
    (!q || s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q) || s.area.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) &&
    (!status || s.status === status) &&
    (!area   || s.area   === area)
  );
  if (stores.length > 0) {
    document.getElementById('search-results-header').classList.remove('hidden');
    document.getElementById('search-result-count').textContent = `พบ ${results.length} รายการ จากทั้งหมด ${stores.length} รายการ`;
  }
  renderSearchList(results);
}
function renderSearchList(list) {
  const el = document.getElementById('search-result-list');
  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div class="empty-title">ไม่พบข้อมูลร้านค้า</div>
      <div class="empty-sub">ลองเปลี่ยนคำค้นหาใหม่อีกครั้ง</div>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="search-store-grid">${list.slice(0,100).map((s,i) => storeCardHTML(s, i, null, null)).join('')}</div>`;
  if (list.length > 100) el.innerHTML += `<div style="text-align:center;padding:12px;font-size:12px;color:#8a96a3">แสดง 100 จาก ${list.length} รายการ</div>`;
}

// ── Card HTML ─────────────────────────────────────────────
function statusColor(s) {
  const v = (s||'').toLowerCase();
  if (v.includes('ว่าง')||v.includes('open')||v.includes('available')) return 'tag-status-open';
  if (v.includes('เต็ม')||v.includes('full')||v.includes('close'))     return 'tag-status-full';
  return 'tag-status-other';
}
function openMaps(lat, lng) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank');
}
function storeCardHTML(s, i, distKm, durationSec) {
  const tagArea   = s.area   ? `<span class="tag tag-area">${s.area}</span>` : '';
  const tagType   = s.type   ? `<span class="tag tag-gray">${s.type}</span>` : '';
  const tagStatus = s.status ? `<span class="tag ${statusColor(s.status)}">${s.status}</span>` : '';
  // หน้าแผนที่: คลิก card = zoom, คลิกชื่อร้าน = Google Maps
  // หน้าค้นหา: คลิก card ทั้งหมด = Google Maps
  const cardClick = distKm !== null
    ? `onclick="focusMarker(${i})"`
    : `onclick="openMaps(${s.lat}, ${s.lng})"`;
  const nameLink = `onclick="event.stopPropagation(); openMaps(${s.lat}, ${s.lng})"`;

  let distHTML = '';
  if (distKm !== null) {
    distHTML = `<div class="store-dist-wrap">
      <div class="store-dist">🚗 ${formatDist(distKm)}</div>
      ${durationSec ? `<div class="store-duration">${formatDuration(durationSec)}</div>` : ''}
    </div>`;
  }

  return `<div class="store-card" ${cardClick}>
    <div class="store-card-top">
      <div class="store-num">${i+1}</div>
      <div class="store-name">
        <span class="store-name-text" ${nameLink}>${s.name}</span>
        ${s.id ? `<span class="store-id">${s.id}</span>` : ""}
      </div>
      ${distHTML}
    </div>
    <div class="store-tags">${tagArea}${tagType}${tagStatus}</div>
    <div class="store-meta-grid">
      <div class="meta-item"><div class="meta-label">อัตราจ้าง</div><div class="meta-value">${s.wage||'-'}</div></div>
      <div class="meta-item"><div class="meta-label">วันทำงาน</div><div class="meta-value">${s.workday||'-'}</div></div>
      <div class="meta-item"><div class="meta-label">เวลาทำงาน</div><div class="meta-value">${s.worktime||'-'}</div></div>
    </div>
    <div class="store-card-footer">
      <button class="btn-maps" onclick="event.stopPropagation(); openMaps(${s.lat}, ${s.lng})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Google Maps
      </button>
    </div>
  </div>`;
}

// ── Map tab search ────────────────────────────────────────
function useMyLocation() {
  setStatus('search-status', 'กำลังขอตำแหน่ง GPS...', '');
  if (!navigator.geolocation) { setStatus('search-status', 'browser ไม่รองรับ GPS', 'err'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(7);
      const lng = pos.coords.longitude.toFixed(7);
      document.getElementById('coord-input').value = `${lat},${lng}`;
      setStatus('search-status', `ได้ตำแหน่ง: ${lat}, ${lng}`, 'ok');
      doSearch(parseFloat(lat), parseFloat(lng));
    },
    err => setStatus('search-status', 'ไม่สามารถรับตำแหน่ง: ' + err.message, 'err')
  );
}
function searchFromInput() {
  const val = document.getElementById('coord-input').value.trim();
  if (!val) { setStatus('search-status', 'กรุณากรอกพิกัด', 'err'); return; }
  const parts = val.split(',').map(s => parseFloat(s.trim()));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    setStatus('search-status', 'รูปแบบพิกัดไม่ถูกต้อง เช่น 13.6951,100.4990', 'err');
    return;
  }
  doSearch(parts[0], parts[1]);
}

async function doSearch(userLat, userLng) {
  if (!stores.length) { setStatus('search-status', 'กรุณาโหลดข้อมูลร้านค้าก่อน', 'err'); return; }
  const radius = parseInt(document.getElementById('radius-slider').value);

  // pre-filter ด้วย haversine (เร็ว) ขยาย 30% เผื่อถนนอ้อม
  const candidates = stores
    .map(s => ({ ...s, straightDist: haversine(userLat, userLng, s.lat, s.lng) }))
    .filter(s => s.straightDist <= radius * 1.3)
    .sort((a,b) => a.straightDist - b.straightDist)
    .slice(0, 150);

  setStatus('search-status', 'กำลังคำนวณระยะทางขับรถ (OSRM)...', '');
  document.getElementById('results-section').style.display = '';
  renderMapList([]); // clear list ระหว่างโหลด

  await fetchDrivingDistances(userLat, userLng, candidates);

  const nearby = candidates.map(s => {
    const cached = driveCache[cacheKey(userLat, userLng, s.lat, s.lng)];
    return { ...s, distKm: cached ? cached.distKm : s.straightDist, durationSec: cached ? cached.durationSec : null };
  })
  .filter(s => s.distKm <= radius)
  .sort((a,b) => a.distKm - b.distKm);

  setStatus('search-status', `พบ ${nearby.length} ร้านในรัศมี ${radius} กม. (ระยะขับรถ)`, nearby.length > 0 ? 'ok' : 'warn');
  document.getElementById('result-label').textContent = `พิกัดในรัศมี ${radius} กม.`;
  document.getElementById('result-count').textContent = `${nearby.length} รายการ`;

  renderUserMarker(userLat, userLng);
  renderStoreMarkers(nearby);
  renderMapList(nearby);

  if (nearby.length > 0) mapInstance.fitBounds(L.latLngBounds([[userLat,userLng],...nearby.map(s=>[s.lat,s.lng])]), { padding:[40,40] });
  else mapInstance.setView([userLat, userLng], 13);
}

function renderUserMarker(lat, lng) {
  if (userMarker) userMarker.remove();
  userMarker = L.marker([lat,lng], { icon: L.divIcon({
    html: `<div style="width:18px;height:18px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(37,99,235,0.4)"></div>`,
    className:'', iconAnchor:[9,9]
  })}).addTo(mapInstance).bindPopup('<b>📍 ตำแหน่งของคุณ</b>');
}
function renderStoreMarkers(nearby) {
  markers.forEach(m => m.remove());
  markers = nearby.map((s,i) => {
    const m = L.marker([s.lat,s.lng], { icon: L.divIcon({
      html: `<div style="background:#1a8a5a;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2.5px solid white;box-shadow:0 2px 8px rgba(26,138,90,0.35)">${i+1}</div>`,
      className:'', iconAnchor:[14,14]
    })}).addTo(mapInstance);
    const dur = s.durationSec ? formatDuration(s.durationSec) : '';
    m.bindPopup([`<b>${s.name}</b>`,`🚗 ${formatDist(s.distKm)}${dur?' · '+dur:''}`,s.area?`📌 ${s.area}`:'',s.type?`🏪 ${s.type}`:'',s.status?`⭕ ${s.status}`:'',s.wage?`💰 ${s.wage}`:'',s.worktime?`🕐 ${s.worktime}`:''].filter(Boolean).join('<br>'));
    return m;
  });
}
function renderMapList(nearby) {
  document.getElementById('store-list').innerHTML = nearby.length === 0
    ? `<div style="text-align:center;padding:2rem;color:#8a96a3;font-size:13px">ไม่พบร้านค้าในรัศมีที่กำหนด</div>`
    : nearby.slice(0,50).map((s,i) => storeCardHTML(s, i, s.distKm, s.durationSec)).join('') +
      (nearby.length > 50 ? `<div style="text-align:center;font-size:12px;color:#8a96a3;padding:10px">แสดง 50 จาก ${nearby.length} รายการ</div>` : '');
}
function focusMarker(i) {
  if (markers[i]) { mapInstance.setView(markers[i].getLatLng(), 15); markers[i].openPopup(); }
}
