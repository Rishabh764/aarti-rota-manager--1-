/* ============================================================
   Aarti rota manager — app logic.
   BASE (data.js) is never mutated; it is the reset point.
   Working state lives in localStorage so edits survive a reload.
   ============================================================ */

'use strict';

const STORE_KEY = 'aarti-rota-2026';
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

let state;

/* Expenses and the change log live in Firestore subcollections so that
   appends from two devices cannot overwrite each other. These arrays are
   the local mirror, and the only copy when Firebase is not connected. */
let expenses = [];
let changeLog = [];

/* ---------------- state ---------------- */

function freshState(){
  return {
    vacant: BASE.vacant.slice(),
    schedule: JSON.parse(JSON.stringify(BASE.schedule)),
    donations: {},
    expenses: [],
    log: []
  };
}

function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return freshState();
    const s = JSON.parse(raw);
    if(!s || !s.schedule || !Array.isArray(s.vacant)) return freshState();
    s.donations = s.donations || {};
    s.expenses  = Array.isArray(s.expenses) ? s.expenses : [];
    s.log       = Array.isArray(s.log) ? s.log : [];
    return s;
  }catch(e){
    return freshState();
  }
}

function saveLocal(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }catch(e){
    toast('Could not save to this browser.', true);
  }
}

function save(){
  saveLocal();
  // sync.js sets this once Firestore is connected. Without it the tool
  // behaves exactly as before, on local storage alone.
  if(window.RotaSync && window.RotaSync.ready) window.RotaSync.push(state);
}

let remoteReady = false;

/* Called by sync.js when a change arrives from Firestore, whether it was made
   here or on someone else's device. Never pushes back — that would loop. */
function applyRemote(remote, updatedAtMs){
  const changed = JSON.stringify(remote) !== JSON.stringify(state);
  if(changed){
    state = remote;
    saveLocal();
    renderAll();
    if(remoteReady) toast('Rota updated from another device.');
  }
  showSyncTime(updatedAtMs);
  remoteReady = true;
}

function showSyncTime(ms){
  const el = document.getElementById('sync-time');
  if(!el) return;
  el.textContent = ms
    ? 'last change ' + new Date(ms).toLocaleString('en-IN',
        { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : '';
}

/* ---------------- lookups ---------------- */

const dayInfo = {};
FESTIVAL.days.forEach(d => { dayInfo[d.day] = d; });

const fmtDate = iso => { const [y,m,d] = iso.split('-'); return `${d}-${m}-${y}`; };

function weekdayOf(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(y, m-1, d).getDay()];
}

function partnerOf(flat){
  for(const [a,b] of BASE.pairs){
    if(a === flat) return b;
    if(b === flat) return a;
  }
  return null;
}

const groupOf = flat => { const p = partnerOf(flat); return p ? [flat,p].sort() : [flat]; };

function dayOf(flat){
  for(const day of Object.keys(state.schedule)){
    if(state.schedule[day].some(s => s.includes(flat))) return Number(day);
  }
  return null;
}

const isVacant = flat => state.vacant.includes(flat);
const slotLabel = slot => slot.join(' + ');

function hostColumns(){
  let max = FESTIVAL.slotColumns;
  Object.values(state.schedule).forEach(s => { max = Math.max(max, s.length); });
  return max;
}

function donationOf(flat){
  const v = state.donations[flat];
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

const rupees = n => '\u20B9\u00A0' + n.toLocaleString('en-IN');

/* ---------------- mutations ---------------- */

function detach(flat){
  for(const day of Object.keys(state.schedule)){
    const i = state.schedule[day].findIndex(s => s.includes(flat));
    if(i !== -1){ state.schedule[day].splice(i,1); return Number(day); }
  }
  return null;
}

function moveFlat(flat, newDay){
  const group = groupOf(flat);
  const wasVacant = group.some(isVacant);
  const from = dayOf(flat);

  if(from === newDay){
    return { ok:false, msg:`${flat} is already on day ${newDay}, ${fmtDate(dayInfo[newDay].iso)}.` };
  }

  detach(flat);
  group.forEach(f => {
    const i = state.vacant.indexOf(f);
    if(i !== -1) state.vacant.splice(i,1);
  });
  state.schedule[String(newDay)].push(group.slice());
  save();

  const label = slotLabel(group);
  const to = `day ${newDay}, ${fmtDate(dayInfo[newDay].iso)}`;
  let msg;
  if(wasVacant) msg = `${label} added back on ${to}.`;
  else msg = `${label} moved from day ${from} to ${to}.`;
  if(group.length > 1) msg += ' Both flats moved together, one owner.';
  logChange(msg);
  return { ok:true, msg };
}

function removeFlat(flat){
  const group = groupOf(flat);
  if(group.every(isVacant)){
    return { ok:false, msg:`${flat} is already off the rota.` };
  }
  const from = dayOf(flat);
  detach(flat);
  group.forEach(f => { if(!isVacant(f)) state.vacant.push(f); });
  save();

  let msg = `${slotLabel(group)} removed from day ${from}.`;
  if(group.length > 1) msg += ' Both flats go together, one owner.';
  logChange(msg);
  return { ok:true, msg };
}

/* ---------------- change log ---------------- */

const syncOn = () => !!(window.RotaSync && window.RotaSync.ready);

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function stamp(ms){
  return new Date(ms).toLocaleString('en-IN',
    { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

/* Every change worth remembering goes through here. Writes straight to
   Firestore when connected, otherwise keeps it locally. */
function logChange(text, kind){
  const entry = { id:newId(), text, kind: kind || 'rota', at: Date.now() };
  if(syncOn()){
    window.RotaSync.addLog(entry);       // snapshot brings it back and re-renders
  } else {
    changeLog.unshift(entry);
    state.log = changeLog.slice(0, 500);
    saveLocal();
    renderLog();
  }
}

function renderLog(){
  const el = document.getElementById('log-list');
  if(!el) return;
  const count = document.getElementById('log-count');
  if(count) count.textContent = changeLog.length ? changeLog.length + ' entries' : '';
  el.innerHTML = changeLog.length
    ? changeLog.map(e =>
        `<li class="log-${e.kind || 'rota'}"><span class="t">${stamp(e.at)}</span> ${esc(e.text)}</li>`).join('')
    : '<li class="log-empty">No changes yet.</li>';
}

/* ---------------- expenses ---------------- */

const expenseTotal = () => expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0);
const fundTotal    = () => BASE.flats.reduce((a, f) => a + donationOf(f), 0);

function esc(s){
  return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}

function addExpense(what, amount){
  const entry = { id:newId(), what, amount, at: Date.now() };
  if(syncOn()){
    window.RotaSync.addExpense(entry);
  } else {
    expenses.unshift(entry);
    state.expenses = expenses;
    saveLocal();
    renderExpenses();
    renderStats();
  }
  logChange(`Expense added: ${what} — ${rupees(amount)}`, 'money');
}

function deleteExpense(id){
  const gone = expenses.find(e => e.id === id);
  if(syncOn()){
    window.RotaSync.removeExpense(id);
  } else {
    expenses = expenses.filter(e => e.id !== id);
    state.expenses = expenses;
    saveLocal();
    renderExpenses();
    renderStats();
  }
  if(gone) logChange(`Expense removed: ${gone.what} — ${rupees(gone.amount)}`, 'money');
}

function renderExpenses(){
  const el = document.getElementById('exp-list');
  if(!el) return;
  el.innerHTML = expenses.length
    ? expenses.map(e => `<li>
        <span class="exp-what">${esc(e.what)}</span>
        <span class="exp-when">${stamp(e.at)}</span>
        <span class="exp-amt">${rupees(Number(e.amount) || 0)}</span>
        <button type="button" class="exp-del" data-id="${e.id}"
                aria-label="Delete ${esc(e.what)}">&times;</button>
      </li>`).join('')
    : '<li class="log-empty">Nothing spent yet.</li>';
  const tot = document.getElementById('exp-total');
  if(tot) tot.textContent = rupees(expenseTotal());
}

/* ---------------- rendering ---------------- */

function renderSchedule(){
  const cols = hostColumns();
  const tbl = document.getElementById('tbl-schedule');

  const head = ['Day','Date','Weekday'];
  for(let i=1;i<=cols;i++) head.push('Host ' + i);
  head.push('Slots','Contribution');
  tbl.tHead.innerHTML = '<tr>' + head.map((h,i) =>
    `<th${i >= cols+3 ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr>';

  let totalSlots = 0, totalMoney = 0;
  tbl.tBodies[0].innerHTML = FESTIVAL.days.map(d => {
    const slots = state.schedule[String(d.day)];
    const heavy = slots.length > FESTIVAL.slotColumns;
    totalSlots += slots.length;
    const money = slots.flat().reduce((a,f) => a + donationOf(f), 0);
    totalMoney += money;

    let cells = `<td class="day-n">${d.day}</td>` +
                `<td class="date-cell">${fmtDate(d.iso)}</td>` +
                `<td>${weekdayOf(d.iso)}</td>`;
    for(let i=0;i<cols;i++){
      const s = slots[i];
      cells += s
        ? `<td class="${s.length>1 ? 'cell-pair' : ''}">${slotLabel(s)}</td>`
        : '<td class="cell-open">free</td>';
    }
    cells += `<td class="num">${slots.length}</td>` +
             `<td class="num">${money ? rupees(money) : '\u2014'}</td>`;
    return `<tr class="${heavy ? 'row-full' : ''}">${cells}</tr>`;
  }).join('');

  tbl.tFoot.innerHTML = `<tr><td colspan="${cols+3}">Total</td>` +
    `<td class="num">${totalSlots}</td><td class="num">${rupees(totalMoney)}</td></tr>`;
}

function renderFlats(){
  const q = document.getElementById('f-search').value.trim().toLowerCase();
  const wing = document.getElementById('f-wing').value;
  const status = document.getElementById('f-status').value;

  const shown = BASE.flats.filter(f => {
    if(wing && f[0] !== wing) return false;
    const vac = isVacant(f);
    if(status === 'Occupied' && vac) return false;
    if(status === 'Vacant' && !vac) return false;
    if(q){
      const day = dayOf(f);
      const hay = (f + ' ' + (day ? fmtDate(dayInfo[day].iso) + ' ' + weekdayOf(dayInfo[day].iso) + ' day ' + day : 'off rota')).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  document.querySelector('#tbl-flats tbody').innerHTML = shown.length
    ? shown.map(f => {
        const vac = isVacant(f);
        const day = dayOf(f);
        const partner = partnerOf(f);
        const note = vac ? 'Off the rota'
          : (partner && !isVacant(partner) ? `Joint aarti with ${partner}, one owner` : '');
        const don = vac ? '\u2014'
          : `<input class="don-input" type="number" min="0" step="50" data-flat="${f}"
               value="${state.donations[f] != null ? state.donations[f] : ''}" placeholder="0"
               aria-label="Contribution from ${f}">`;
        return `<tr class="${vac ? 'row-vacant' : ''}">
          <td class="flat-id">${f}</td><td>${f[0]}</td><td>${f[2]}</td>
          <td>${vac ? 'Off rota' : 'On rota'}</td>
          <td>${day ? fmtDate(dayInfo[day].iso) : '\u2014'}</td>
          <td>${day ? weekdayOf(dayInfo[day].iso) + ', day ' + day : '\u2014'}</td>
          <td class="num">${don}</td><td>${note}</td></tr>`;
      }).join('')
    : '<tr><td colspan="8">Nothing matches those filters.</td></tr>';

  document.getElementById('f-count').textContent =
    `${shown.length} of ${BASE.flats.length} flats`;
}

function renderStats(){
  const occupied = BASE.flats.filter(f => !isVacant(f)).length;
  const used = Object.values(state.schedule).reduce((a,s) => a + s.length, 0);
  const capacity = FESTIVAL.days.length * FESTIVAL.slotColumns;
  const fund  = fundTotal();
  const spent = expenseTotal();
  const left  = fund - spent;

  document.getElementById('s-host').textContent = occupied;
  document.getElementById('s-vac').textContent  = state.vacant.length;
  document.getElementById('s-slot').textContent = used;
  document.getElementById('s-free').textContent = Math.max(0, capacity - used);
  document.getElementById('s-fund').textContent = rupees(fund);
  document.getElementById('s-exp').textContent  = rupees(spent);

  const leftEl = document.getElementById('s-left');
  leftEl.textContent = rupees(left);
  leftEl.classList.toggle('negative', left < 0);
}

function renderWarnings(){
  const box = document.getElementById('warnings');
  const out = [];

  const unplaced = BASE.flats.filter(f => !isVacant(f) && dayOf(f) === null);
  if(unplaced.length){
    out.push(`${unplaced.length} flat${unplaced.length>1?'s are':' is'} on the rota but has no date: ${unplaced.join(', ')}.`);
  }
  const empty = FESTIVAL.days.filter(d => state.schedule[String(d.day)].length === 0);
  if(empty.length){
    out.push(`No one is hosting on ${empty.map(d => fmtDate(d.iso)).join(', ')}.`);
  }
  const heavy = FESTIVAL.days.filter(d => state.schedule[String(d.day)].length > FESTIVAL.slotColumns);
  if(heavy.length){
    out.push(`More than ${FESTIVAL.slotColumns} flats are hosting on ${heavy.map(d => fmtDate(d.iso)).join(', ')}. Extra columns have been added to the table.`);
  }

  box.innerHTML = out.map(t => `<p class="warn-item">${t}</p>`).join('');
}

function renderAll(){
  renderSchedule();
  renderFlats();
  renderExpenses();
  renderStats();
  renderWarnings();
}

/* ---------------- picker validation ---------------- */

function readPicker(prefix){
  const wingEl  = document.getElementById(prefix + '-wing');
  const floorEl = document.getElementById(prefix + '-floor');
  const numEl   = document.getElementById(prefix + '-num');
  [wingEl, floorEl, numEl].forEach(el => el.classList.remove('bad'));

  const wing = wingEl.value, floor = floorEl.value, num = numEl.value.trim();

  if(!wing){  wingEl.classList.add('bad');  return { err:'Choose a tower.' }; }
  if(!floor){ floorEl.classList.add('bad'); return { err:'Choose a floor.' }; }
  if(!/^\d{3}$/.test(num)){
    numEl.classList.add('bad');
    return { err:`Flat number must be three digits. Floor ${floor} has ${floor}01 to ${floor}04.` };
  }
  if(num[0] !== floor){
    numEl.classList.add('bad');
    return { err:`${num} is not on floor ${floor}. Use ${floor}01 to ${floor}04, or change the floor.` };
  }
  if(num[1] !== '0' || !'1234'.includes(num[2])){
    numEl.classList.add('bad');
    return { err:`There is no flat ${num}. Each floor has only ${floor}01, ${floor}02, ${floor}03 and ${floor}04.` };
  }
  const flat = `${wing}-${num}`;
  if(!BASE.flats.includes(flat)){
    numEl.classList.add('bad');
    return { err:`${flat} is not a flat in this society.` };
  }
  return { flat };
}

function setMsg(id, text, kind){
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

/* live echo of what the three pickers currently point at */
function updateResolved(prefix){
  const el = document.getElementById(prefix + '-resolved');
  const wing = document.getElementById(prefix + '-wing').value;
  const num  = document.getElementById(prefix + '-num').value.trim();
  if(!wing || !/^\d{3}$/.test(num)){ el.textContent = ''; return; }

  const flat = `${wing}-${num}`;
  if(!BASE.flats.includes(flat)){ el.textContent = ''; return; }

  const partner = partnerOf(flat);
  if(isVacant(flat)){
    el.innerHTML = `<b>${flat}</b> is currently off the rota.`;
    return;
  }
  const day = dayOf(flat);
  let txt = `<b>${flat}</b> currently hosts on ${fmtDate(dayInfo[day].iso)}, day ${day}.`;
  if(partner && !isVacant(partner)) txt += ` ${partner} goes with it.`;
  el.innerHTML = txt;
}

/* ---------------- export ---------------- */

const csvCell = v => '"' + String(v).replace(/"/g,'""') + '"';

function downloadCSV(){
  const cols = hostColumns();
  const lines = [];

  lines.push(csvCell('GANESH CHATURTHI 2026 - DAILY AARTI SCHEDULE'));
  const h = ['Day','Date','Weekday'];
  for(let i=1;i<=cols;i++) h.push('Host ' + i);
  h.push('Slots','Contribution (INR)');
  lines.push(h.map(csvCell).join(','));

  FESTIVAL.days.forEach(d => {
    const slots = state.schedule[String(d.day)];
    const row = [d.day, fmtDate(d.iso), weekdayOf(d.iso)];
    for(let i=0;i<cols;i++) row.push(slots[i] ? slotLabel(slots[i]) : '');
    row.push(slots.length, slots.flat().reduce((a,f) => a + donationOf(f), 0));
    lines.push(row.map(csvCell).join(','));
  });

  lines.push('');
  lines.push(csvCell('FUND SUMMARY'));
  lines.push(['Collected (INR)','Spent (INR)','Remaining (INR)'].map(csvCell).join(','));
  lines.push([fundTotal(), expenseTotal(), fundTotal() - expenseTotal()].map(csvCell).join(','));

  lines.push('');
  lines.push(csvCell('EXPENSES'));
  lines.push(['Date','Spent on','Amount (INR)'].map(csvCell).join(','));
  expenses.slice().reverse().forEach(e => {
    lines.push([stamp(e.at), e.what, Number(e.amount) || 0].map(csvCell).join(','));
  });

  lines.push('');
  lines.push(csvCell('CHANGE LOG'));
  lines.push(['Date','Change'].map(csvCell).join(','));
  changeLog.slice().reverse().forEach(e => {
    lines.push([stamp(e.at), e.text].map(csvCell).join(','));
  });

  lines.push('');
  lines.push(csvCell('FLAT LOOKUP'));
  lines.push(['Flat','Tower','Floor','Status','Aarti Date','Weekday','Day','Contribution (INR)','Notes']
    .map(csvCell).join(','));

  BASE.flats.forEach(f => {
    const vac = isVacant(f);
    const day = dayOf(f);
    const partner = partnerOf(f);
    lines.push([
      f, f[0], f[2], vac ? 'Off rota' : 'On rota',
      day ? fmtDate(dayInfo[day].iso) : '',
      day ? weekdayOf(dayInfo[day].iso) : '',
      day ? 'Day ' + day : '',
      vac ? '' : donationOf(f),
      vac ? 'Off the rota' : (partner && !isVacant(partner) ? 'Joint aarti with ' + partner + ', one owner' : '')
    ].map(csvCell).join(','));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'aarti-rota-2026.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  toast('CSV exported.');
}

/* ---------------- toast ---------------- */

let toastTimer;
function toast(text, isErr){
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 4200);
}

/* ---------------- wiring ---------------- */

function init(){
  state = load();
  expenses  = state.expenses || [];
  changeLog = state.log || [];

  document.getElementById('m-date').innerHTML =
    '<option value="">\u2014</option>' + FESTIVAL.days.map(d =>
      `<option value="${d.day}">Day ${d.day} \u2014 ${fmtDate(d.iso)}, ${weekdayOf(d.iso)}</option>`).join('');

  // tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        const on = t === tab;
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-selected', String(on));
      });
      document.getElementById('view-schedule').hidden = tab.dataset.view !== 'schedule';
      document.getElementById('view-flats').hidden    = tab.dataset.view !== 'flats';
      document.getElementById('view-title').textContent =
        tab.dataset.view === 'schedule' ? 'Schedule' : 'Flat lookup';
    });
  });

  // live echo on both pickers
  ['m','r'].forEach(p => {
    ['-wing','-floor','-num'].forEach(suffix => {
      const el = document.getElementById(p + suffix);
      el.addEventListener('input', () => updateResolved(p));
      el.addEventListener('change', () => updateResolved(p));
    });
    // the floor dropdown follows the number you type
    document.getElementById(p + '-num').addEventListener('input', e => {
      const v = e.target.value.replace(/\D/g,'').slice(0,3);
      e.target.value = v;
      if(v.length >= 1 && '1234'.includes(v[0])) document.getElementById(p + '-floor').value = v[0];
    });
  });

  // filters
  ['f-search','f-wing','f-status'].forEach(id =>
    document.getElementById(id).addEventListener('input', renderFlats));

  // contributions
  // One log entry per flat once typing settles, rather than one per keystroke.
  // Timers are kept per flat so editing two flats in quick succession logs both.
  const donPending = {};
  document.querySelector('#tbl-flats tbody').addEventListener('input', e => {
    const el = e.target;
    if(!el.classList.contains('don-input')) return;
    const flat = el.dataset.flat;

    if(!donPending[flat]) donPending[flat] = { before: donationOf(flat), timer: null };

    const v = parseFloat(el.value);
    if(el.value === '' || isNaN(v) || v < 0) delete state.donations[flat];
    else state.donations[flat] = v;
    save();
    renderSchedule();
    renderStats();

    clearTimeout(donPending[flat].timer);
    donPending[flat].timer = setTimeout(() => {
      const { before } = donPending[flat];
      const after = donationOf(flat);
      delete donPending[flat];
      if(after !== before) logChange(`Contribution for ${flat} set to ${rupees(after)}`, 'money');
    }, 1200);
  });

  // add an expense
  document.getElementById('form-expense').addEventListener('submit', e => {
    e.preventDefault();
    const whatEl = document.getElementById('exp-what');
    const amtEl  = document.getElementById('exp-amount');
    const what = whatEl.value.trim();
    const amt  = parseFloat(amtEl.value);
    whatEl.classList.remove('bad'); amtEl.classList.remove('bad');

    if(!what){ whatEl.classList.add('bad'); setMsg('exp-msg', 'Say what the money went on.', 'err'); return; }
    if(isNaN(amt) || amt <= 0){ amtEl.classList.add('bad'); setMsg('exp-msg', 'Enter an amount above zero.', 'err'); return; }

    addExpense(what, amt);
    whatEl.value = ''; amtEl.value = '';
    setMsg('exp-msg', 'Added.', 'ok');
    whatEl.focus();
  });

  // delete an expense
  document.getElementById('exp-list').addEventListener('click', e => {
    const btn = e.target.closest('.exp-del');
    if(!btn) return;
    const row = expenses.find(x => x.id === btn.dataset.id);
    if(row && confirm(`Delete "${row.what}" (${rupees(row.amount)})?`)) deleteExpense(btn.dataset.id);
  });

  // expenses and log arriving from Firestore
  window.addEventListener('rota:expenses', ev => {
    expenses = ev.detail;
    state.expenses = expenses;
    saveLocal();
    renderExpenses();
    renderStats();
  });
  window.addEventListener('rota:log', ev => {
    changeLog = ev.detail;
    state.log = changeLog.slice(0, 500);
    saveLocal();
    renderLog();
  });

  // move
  document.getElementById('form-move').addEventListener('submit', e => {
    e.preventDefault();
    const picked = readPicker('m');
    if(picked.err){ setMsg('m-msg', picked.err, 'err'); return; }
    const dayEl = document.getElementById('m-date');
    if(!dayEl.value){
      dayEl.classList.add('bad');
      setMsg('m-msg', 'Choose the new date.', 'err');
      return;
    }
    dayEl.classList.remove('bad');
    const res = moveFlat(picked.flat, Number(dayEl.value));
    setMsg('m-msg', res.msg, res.ok ? 'ok' : 'err');
    if(res.ok){ renderAll(); updateResolved('m'); updateResolved('r'); toast(res.msg); }
  });

  // remove
  document.getElementById('form-remove').addEventListener('submit', e => {
    e.preventDefault();
    const picked = readPicker('r');
    if(picked.err){ setMsg('r-msg', picked.err, 'err'); return; }
    if(!confirm(`Take ${picked.flat} off the rota?`)) return;
    const res = removeFlat(picked.flat);
    setMsg('r-msg', res.msg, res.ok ? 'ok' : 'err');
    if(res.ok){ renderAll(); updateResolved('m'); updateResolved('r'); toast(res.msg); }
  });

  // toolbar
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('btn-csv').addEventListener('click', downloadCSV);
  document.getElementById('btn-reset').addEventListener('click', () => {
    if(!confirm('Reset to the original rota? Every change, including contributions, will be cleared.')) return;
    state = freshState();
    if(syncOn()) window.RotaSync.clearAll();
    expenses = []; changeLog = [];
    save();
    setMsg('m-msg',''); setMsg('r-msg',''); setMsg('exp-msg','');
    document.getElementById('m-resolved').textContent = '';
    document.getElementById('r-resolved').textContent = '';
    renderAll(); renderLog();
    logChange('Rota reset to the original schedule.', 'reset');
    toast('Reset to the original rota.');
  });

  // sync.js reads and writes the rota through this.
  window.RotaApp = {
    getState: () => state,
    applyRemote
  };

  // connection pill in the top bar
  let localOnlyTimer = null;
  window.addEventListener('rota:status', e => {
    // A real status arrived, so the fallback below must not fire.
    if(localOnlyTimer){ clearTimeout(localOnlyTimer); localOnlyTimer = null; }
    const pill = document.getElementById('sync-status');
    if(!pill) return;
    pill.textContent = e.detail.text;
    pill.className = 'pill ' + (e.detail.tone || '');
    if(e.detail.hint) pill.title = e.detail.hint;
  });

  // If sync.js never loads at all — no internet, blocked CDN, opened over
  // file:// — say so. Cancelled the moment sync.js reports anything.
  localOnlyTimer = setTimeout(() => {
    const pill = document.getElementById('sync-status');
    if(pill){
      pill.textContent = 'Local only';
      pill.className = 'pill warn';
      pill.title = 'Firebase did not load. The rota works, but only on this browser.';
    }
  }, 6000);

  renderAll();
  renderLog();
}

document.addEventListener('DOMContentLoaded', init);