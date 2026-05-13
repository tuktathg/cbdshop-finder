// ── Config ─────────────────────────────────────────────
const SHEET_ID = '1sKiG1H1Cn9zSSXQzenhAm8theiEJf4_RlcxxcXwiK6I';
const GID      = '271631235';
const CSV_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

const COLORS = ['#185FA5','#1D9E75','#993556','#BA7517','#534AB7','#3B6D11','#D85A30','#0F6E56','#3C3489'];

// ── State ───────────────────────────────────────────────
let stores     = [];
let mapInstance = null;
let markers    = [];
let manualVisible = false;

// ── UI helpers ──────────────────────────────────────────
function setStatus(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' status-' + type : '');
}

function showLoadBar(pct) {
  const bar = document.getElementById('load-bar');
  const inner = document.getElementById('load-bar-inner');
  if (pct === null) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  inner.style.width = pct + '%';
}

function toggleManual() {
  manualVisible = !manualVisible;
  document.getElementById('manual-panel').classList.toggle('hidden', !manualVisible);
}

// ── Data loading ────────────────────────────────────────
async function fetchSheet() {
  const btn = document.getElementById('btn-fetch');
  btn.disabled = true;
  showLoadBar(20);
  setStatus('load-status', 'กำลังดึงข้อมูล...', '');

  try {
    const res = await fetch(CSV_URL);
    showLoadBar(70);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ตรวจสอบว่า Sheet เปิดเป็น Public`);
    const text = await res.text();
    showLoadBar(100);
    setTimeout(() => showLoadBar(null), 600);
    processCSVText(text);
  } catch (e) {
    showLoadBar(null);
    setStatus('load-status', `โหลดไม่ได้: ${e.message}`, 'err');
  }
  btn.disabled = false;
}

function parseCSV() {
  const raw = document.getElementById('csv-input').value.trim();
  if (!raw) { setStatus('load-status', 'กรุณาวาง CSV ก่อน', 'warn'); return; }
  processCSVText(raw);
}

function processCSVText(text) {
  const result = Papa.parse(text, { skipEmptyLines: true });
  const rows   = result.data;
  if (rows.length < 2) { setStatus('load-status', 'ไม่พบข้อมูลในไฟล์', 'err'); return; }

  const header = rows[0];
  let latCol = findCol(header, ['LAT','lat','Lat','latitude','LATITUDE']);
  let lngCol = findCol(header, ['LONG','lng','Lng','LON','LONGITUDE','longitude']);
  if (latCol === -1) latCol = 7;   // column H (0-indexed)
  if (lngCol === -1) lngCol = 8;   // column I

  const nameCol     = findCol(header, ['ชื่อร้าน','ชื่อ','name','Name','SHOP']) ?? 1;
  const typeCol     = findCol(header, ['ประเภท','type','Type','category','หมวดหมู่']);
  const provCol     = findCol(header, ['จังหวัด','province','Province']);
  const districtCol = findCol(header, ['อำเภอ','district','District']);

  stores = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length <= Math.max(latCol, lngCol)) { skipped++; continue; }
    const lat = parseFloat(row[latCol]);
    const lng = parseFloat(row[lngCol]);
    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }
    stores.push({
      name:     (row[nameCol] || `ร้าน #${i}`).trim(),
      lat, lng,
      type:     typeCol !== -1     ? (row[typeCol]     || '').trim() : '',
      province: provCol !== -1     ? (row[provCol]     || '').trim() : '',
      district: districtCol !== -1 ? (row[districtCol] || '').trim() : '',
    });
  }

  if (stores.length === 0) {
    setStatus('load-status', `ไม่พบแถวที่มีพิกัด (ตรวจสอบคอลัม H/I)`, 'err');
    return;
  }

  const msg = `โหลดสำเร็จ ${stores.length} ร้าน${skipped > 0 ? ` (ข้าม ${skipped} แถว)` : ''}`;
  setStatus('load-status', msg, 'ok');

  const badge = document.getElementById('store-count-badge');
  badge.textContent = `${stores.length} ร้านทั้งหมด`;
  badge.classList.remove('hidden');
}

function findCol(header, candidates) {
  for (const c of candidates) {
    const idx = header.findIndex(h => h && h.trim().toLowerCase() === c.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// ── Geolocation ─────────────────────────────────────────
function useMyLocation() {
  setStatus('search-status', 'กำลังขอตำแหน่ง GPS...', '');
  if (!navigator.geolocation) { setStatus('search-status', 'browser ไม่รองรับ GPS', 'err'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('user-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('user-lng').value = pos.coords.longitude.toFixed(6);
      setStatus('search-status', `ได้ตำแหน่ง: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`, 'ok');
    },
    err => setStatus('search-status', 'ไม่สามารถรับตำแหน่งได้: ' + err.message, 'err')
  );
}

// ── Search ──────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function findNearby() {
  const userLat = parseFloat(document.getElementById('user-lat').value);
  const userLng = parseFloat(document.getElementById('user-lng').value);
  const radius  = parseInt(document.getElementById('radius-slider').value);

  if (isNaN(userLat) || isNaN(userLng)) { setStatus('search-status', 'กรุณากรอกพิกัดของคุณ', 'err'); return; }
  if (stores.length === 0)               { setStatus('search-status', 'กรุณาโหลดข้อมูลร้านค้าก่อน', 'err'); return; }

  const nearby = stores
    .map(s => ({ ...s, dist: haversine(userLat, userLng, s.lat, s.lng) }))
    .filter(s => s.dist <= radius)
    .sort((a, b) => a.dist - b.dist);

  setStatus('search-status', `พบ ${nearby.length} ร้านในรัศมี ${radius} กม.`, nearby.length > 0 ? 'ok' : 'warn');
  document.getElementById('result-count').textContent = `${nearby.length} ร้าน`;
  document.getElementById('results-card').classList.remove('hidden');

  renderMap(userLat, userLng, nearby);
  renderList(nearby);
}

// ── Map ─────────────────────────────────────────────────
function renderMap(userLat, userLng, nearby) {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapInstance = L.map('map').setView([userLat, userLng], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(mapInstance);

  // User marker
  const userIcon = L.divIcon({
    html: `<div style="width:16px;height:16px;background:#E24B4A;border:2.5px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(226,75,74,0.22)"></div>`,
    className: '', iconAnchor: [8, 8]
  });
  L.marker([userLat, userLng], { icon: userIcon })
    .addTo(mapInstance)
    .bindPopup('<b>📍 ตำแหน่งของคุณ</b>');

  // Store markers
  markers = nearby.map((s, i) => {
    const color = COLORS[i % COLORS.length];
    const icon  = L.divIcon({
      html: `<div style="background:${color};color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.2)">${i+1}</div>`,
      className: '', iconAnchor: [13, 13]
    });
    const dist    = formatDist(s.dist);
    const popLines = [`<b>${s.name}</b>`, `📏 ${dist}`];
    if (s.type)     popLines.push(`🏪 ${s.type}`);
    if (s.province) popLines.push(`📌 ${s.province}${s.district ? ' › ' + s.district : ''}`);
    return L.marker([s.lat, s.lng], { icon })
      .addTo(mapInstance)
      .bindPopup(popLines.join('<br>'));
  });

  if (nearby.length > 0) {
    const allPts = [[userLat, userLng], ...nearby.map(s => [s.lat, s.lng])];
    mapInstance.fitBounds(L.latLngBounds(allPts), { padding: [36, 36] });
  }

  setTimeout(() => mapInstance && mapInstance.invalidateSize(), 200);
}

// ── List ─────────────────────────────────────────────────
function renderList(nearby) {
  const el = document.getElementById('store-list');
  if (nearby.length === 0) {
    el.innerHTML = `<p style="font-size:13px;color:var(--text-3);text-align:center;padding:1.5rem 0">ไม่พบร้านค้าในรัศมีที่กำหนด<br>ลองเพิ่มรัศมีการค้นหา</p>`;
    return;
  }

  el.innerHTML = nearby.slice(0, 50).map((s, i) => {
    const color = COLORS[i % COLORS.length];
    const meta  = [s.type, s.province, s.district].filter(Boolean).join(' · ');
    return `<div class="store-row" onclick="focusMarker(${i})">
      <div class="store-num" style="background:${color}22;color:${color}">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div class="store-name">${s.name}</div>
        ${meta ? `<div class="store-meta">${meta}</div>` : ''}
      </div>
      <div class="store-dist" style="color:${color}">${formatDist(s.dist)}</div>
    </div>`;
  }).join('');

  if (nearby.length > 50) {
    el.innerHTML += `<p style="font-size:11px;color:var(--text-3);text-align:center;padding:8px 0">แสดง 50 จาก ${nearby.length} ร้าน</p>`;
  }
}

function focusMarker(i) {
  if (markers[i]) {
    mapInstance.setView(markers[i].getLatLng(), 15);
    markers[i].openPopup();
  }
}

function formatDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} ม.` : `${km.toFixed(2)} กม.`;
}

// ── Init ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', fetchSheet);
