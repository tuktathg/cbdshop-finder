// ── Config ──────────────────────────────────────────────
const SHEET_ID = '1sKiG1H1Cn9zSSXQzenhAm8theiEJf4_RlcxxcXwiK6I';
const GID      = '271631235';
const CSV_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

// คอลัมน์ใน Sheet Total_ร้าน (0-indexed)
// A=รหัสร้านที่ทำงาน, B=ประเภทร้าน, C=ชื่อร้าน, D=พื้นที่,
// E=STATUS, F=อัตราจ้าง, G=วันทำงาน, H=เวลาทำงาน, I=LAT, J=LONG
const COL = {
  id:       0,  // A - รหัสร้านที่ทำงาน
  type:     1,  // B - ประเภทร้าน
  name:     2,  // C - ชื่อร้าน
  area:     3,  // D - พื้นที่
  status:   4,  // E - STATUS
  wage:     5,  // F - อัตราจ้าง
  workday:  6,  // G - วันทำงาน
  worktime: 7,  // H - เวลาทำงาน
  lat:      8,  // I - LAT
  lng:      9,  // J - LONG
};

// ── State ────────────────────────────────────────────────
let stores      = [];
let mapInstance = null;
let markers     = [];
let userMarker  = null;
let sidebarOpen = true;
let dataPanelOpen = true;
let manualVisible = false;

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchSheet();
});

function initMap() {
  mapInstance = L.map('map', { zoomControl: true }).setView([13.75, 100.5], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">Leaflet</a> | © <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(mapInstance);
}

// ── Sidebar & panels ─────────────────────────────────────
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  const sb = document.getElementById('sidebar');
  const icon = document.getElementById('toggle-icon');
  sb.classList.toggle('collapsed', !sidebarOpen);
  icon.style.transform = sidebarOpen ? '' : 'rotate(180deg)';
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

function formatDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} ม.` : `${km.toFixed(2)} กม.`;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function clearCoord() {
  document.getElementById('coord-input').value = '';
  setStatus('search-status', '', '');
}

// ── Fetch Sheet ──────────────────────────────────────────
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
  } catch (e) {
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
  const rows   = result.data;
  if (rows.length < 2) { setStatus('load-status', 'ไม่พบข้อมูล', 'err'); return; }

  // ตรวจสอบ header row เพื่อยืนยัน column mapping
  const header = rows[0];
  console.log('Header:', header);

  // ถ้า header ไม่ตรง fallback ไปหาชื่อคอลัมน์
  let latCol  = header.findIndex(h => h && h.trim().toLowerCase() === 'lat');
  let lngCol  = header.findIndex(h => h && h.trim().toLowerCase() === 'long');
  if (latCol  === -1) latCol  = COL.lat;
  if (lngCol  === -1) lngCol  = COL.lng;

  let nameCol     = header.findIndex(h => h && h.trim() === 'ชื่อร้าน');
  let typeCol     = header.findIndex(h => h && h.trim() === 'ประเภทร้าน');
  let areaCol     = header.findIndex(h => h && h.trim() === 'พื้นที่');
  let statusCol   = header.findIndex(h => h && h.trim() === 'STATUS');
  let wageCol     = header.findIndex(h => h && h.trim() === 'อัตราจ้าง');
  let workdayCol  = header.findIndex(h => h && h.trim() === 'วันทำงาน');
  let worktimeCol = header.findIndex(h => h && h.trim() === 'เวลาทำงาน');
  let idCol       = header.findIndex(h => h && h.trim() === 'รหัสร้านที่ทำงาน');

  // fallback ถ้าหาชื่อไม่เจอ
  if (nameCol     === -1) nameCol     = COL.name;
  if (typeCol     === -1) typeCol     = COL.type;
  if (areaCol     === -1) areaCol     = COL.area;
  if (statusCol   === -1) statusCol   = COL.status;
  if (wageCol     === -1) wageCol     = COL.wage;
  if (workdayCol  === -1) workdayCol  = COL.workday;
  if (worktimeCol === -1) worktimeCol = COL.worktime;
  if (idCol       === -1) idCol       = COL.id;

  stores = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length <= Math.max(latCol, lngCol)) { skipped++; continue; }
    const lat = parseFloat(r[latCol]);
    const lng = parseFloat(r[lngCol]);
    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }
    stores.push({
      id:       (r[idCol]       || '').trim(),
      name:     (r[nameCol]     || `ร้าน #${i}`).trim(),
      type:     (r[typeCol]     || '').trim(),
      area:     (r[areaCol]     || '').trim(),
      status:   (r[statusCol]   || '').trim(),
      wage:     (r[wageCol]     || '-').trim(),
      workday:  (r[workdayCol]  || '-').trim(),
      worktime: (r[worktimeCol] || '-').trim(),
      lat, lng,
    });
  }

  if (stores.length === 0) {
    setStatus('load-status', 'ไม่พบแถวที่มีพิกัด (ตรวจสอบคอลัม LAT/LONG)', 'err');
    return;
  }

  const msg = `โหลดสำเร็จ ${stores.length} ร้าน${skipped > 0 ? ` (ข้าม ${skipped})` : ''}`;
  setStatus('load-status', msg, 'ok');

  const badge = document.getElementById('total-badge');
  badge.textContent = `ข้อมูลทั้งหมด ${stores.length} รายการ`;
  badge.classList.remove('hidden');

  const mini = document.getElementById('data-count-badge');
  mini.textContent = stores.length;
  mini.classList.remove('hidden');
}

// ── Location ─────────────────────────────────────────────
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

function doSearch(userLat, userLng) {
  const radius = parseInt(document.getElementById('radius-slider').value);
  if (stores.length === 0) { setStatus('search-status', 'กรุณาโหลดข้อมูลร้านค้าก่อน', 'err'); return; }

  const nearby = stores
    .map(s => ({ ...s, dist: haversine(userLat, userLng, s.lat, s.lng) }))
    .filter(s => s.dist <= radius)
    .sort((a, b) => a.dist - b.dist);

  setStatus('search-status', `พบ ${nearby.length} ร้านในรัศมี ${radius} กม.`, nearby.length > 0 ? 'ok' : 'warn');

  document.getElementById('result-label').textContent = `พิกัดในรัศมี ${radius} กม.`;
  document.getElementById('result-count').textContent = `${nearby.length} รายการ`;
  document.getElementById('results-section').style.display = '';

  renderUserMarker(userLat, userLng);
  renderStoreMarkers(nearby);
  renderList(nearby);

  if (nearby.length > 0) {
    const bounds = L.latLngBounds([[userLat, userLng], ...nearby.map(s => [s.lat, s.lng])]);
    mapInstance.fitBounds(bounds, { padding: [40, 40] });
  } else {
    mapInstance.setView([userLat, userLng], 13);
  }
}

// ── Map markers ──────────────────────────────────────────
function renderUserMarker(lat, lng) {
  if (userMarker) userMarker.remove();
  const icon = L.divIcon({
    html: `<div style="width:18px;height:18px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(37,99,235,0.4)"></div>`,
    className: '', iconAnchor: [9, 9]
  });
  userMarker = L.marker([lat, lng], { icon }).addTo(mapInstance).bindPopup('<b>📍 ตำแหน่งของคุณ</b>');
}

function renderStoreMarkers(nearby) {
  markers.forEach(m => m.remove());
  markers = nearby.map((s, i) => {
    const icon = L.divIcon({
      html: `<div style="background:#1a8a5a;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2.5px solid white;box-shadow:0 2px 8px rgba(26,138,90,0.35)">${i+1}</div>`,
      className: '', iconAnchor: [14, 14]
    });
    const lines = [
      `<b>${s.name}</b>`,
      `📏 ${formatDist(s.dist)}`,
    ];
    if (s.area)     lines.push(`📌 ${s.area}`);
    if (s.type)     lines.push(`🏪 ${s.type}`);
    if (s.status)   lines.push(`⭕ ${s.status}`);
    if (s.wage)     lines.push(`💰 ${s.wage}`);
    if (s.worktime) lines.push(`🕐 ${s.worktime}`);
    return L.marker([s.lat, s.lng], { icon }).addTo(mapInstance).bindPopup(lines.join('<br>'));
  });
}

// ── Store list ───────────────────────────────────────────
function statusColor(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('ว่าง') || s.includes('open') || s.includes('available')) return 'tag-status-open';
  if (s.includes('เต็ม') || s.includes('full') || s.includes('close')) return 'tag-status-full';
  return 'tag-status-other';
}

function renderList(nearby) {
  const el = document.getElementById('store-list');
  if (nearby.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:2rem 1rem;color:#8a96a3;font-size:13px">ไม่พบร้านค้าในรัศมีที่กำหนด<br>ลองเพิ่มรัศมีการค้นหา</div>`;
    return;
  }

  el.innerHTML = nearby.slice(0, 50).map((s, i) => {
    const tagArea   = s.area   ? `<span class="tag tag-area">${s.area}</span>` : '';
    const tagType   = s.type   ? `<span class="tag tag-gray">${s.type}</span>` : '';
    const tagStatus = s.status ? `<span class="tag ${statusColor(s.status)}">${s.status}</span>` : '';

    return `<div class="store-card" onclick="focusMarker(${i})">
      <div class="store-card-top">
        <div class="store-num">${i+1}</div>
        <div class="store-name">${s.name}${s.id ? `<span class="store-id">${s.id}</span>` : ''}</div>
        <div class="store-dist">${formatDist(s.dist)}</div>
      </div>
      <div class="store-tags">
        ${tagArea}${tagType}${tagStatus}
      </div>
      <div class="store-meta-grid">
        <div class="meta-item">
          <div class="meta-label">อัตราจ้าง</div>
          <div class="meta-value">${s.wage || '-'}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">วันทำงาน</div>
          <div class="meta-value">${s.workday || '-'}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">เวลาทำงาน</div>
          <div class="meta-value">${s.worktime || '-'}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  if (nearby.length > 50) {
    el.innerHTML += `<div style="text-align:center;font-size:12px;color:#8a96a3;padding:10px">แสดง 50 จาก ${nearby.length} รายการ</div>`;
  }
}

function focusMarker(i) {
  if (markers[i]) {
    mapInstance.setView(markers[i].getLatLng(), 15);
    markers[i].openPopup();
  }
}
