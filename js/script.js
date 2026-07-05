(function(){
  const STORAGE_KEY = 'lectureLedger.v1';

  let entries = [];
  let troublemakers = [];
  let editingId = null;
  let editingTroubleId = null;
  let pendingPhoto = null; // base64 string for the entry currently being composed

  /* ---------- Simple password lock ----------
     Note: this deters casual access on a shared device (e.g. a school computer).
     It is NOT real security — all code and data still live in this browser, and
     anyone with developer tools could bypass it. Don't rely on it to protect
     sensitive information. */
  const PW_HASH_KEY = 'lectureLedger.pwHash';
  const UNLOCKED_KEY = 'lectureLedger.unlocked';

  const lockScreen = document.getElementById('lockScreen');
  const appContent = document.getElementById('appContent');
  const lockSetupView = document.getElementById('lockSetupView');
  const lockLoginView = document.getElementById('lockLoginView');
  const lockError = document.getElementById('lockError');

  async function sha256Hex(text){
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function showApp(){
    lockScreen.style.display = 'none';
    appContent.style.display = 'block';
  }

  function showLock(){
    appContent.style.display = 'none';
    lockScreen.style.display = 'flex';
    const hasPassword = !!localStorage.getItem(PW_HASH_KEY);
    lockSetupView.style.display = hasPassword ? 'none' : 'block';
    lockLoginView.style.display = hasPassword ? 'block' : 'none';
    if(lockError) lockError.textContent = '';
  }

  function initLock(){
    const hasPassword = !!localStorage.getItem(PW_HASH_KEY);
    const unlocked = localStorage.getItem(UNLOCKED_KEY) === 'true';
    if(hasPassword && unlocked) showApp();
    else showLock();
  }

  document.getElementById('lockSetupForm')?.addEventListener('submit', async function(ev){
    ev.preventDefault();
    const pw = document.getElementById('lockSetupPassword').value;
    const confirmPw = document.getElementById('lockSetupConfirm').value;
    if(pw.length < 4){ lockError.textContent = 'Use at least 4 characters.'; return; }
    if(pw !== confirmPw){ lockError.textContent = "Passwords don't match."; return; }
    const hash = await sha256Hex(pw);
    localStorage.setItem(PW_HASH_KEY, hash);
    localStorage.setItem(UNLOCKED_KEY, 'true');
    showApp();
  });

  document.getElementById('lockLoginForm')?.addEventListener('submit', async function(ev){
    ev.preventDefault();
    const pwField = document.getElementById('lockLoginPassword');
    const hash = await sha256Hex(pwField.value);
    if(hash === localStorage.getItem(PW_HASH_KEY)){
      localStorage.setItem(UNLOCKED_KEY, 'true');
      pwField.value = '';
      showApp();
    } else {
      lockError.textContent = 'Wrong password. Try again.';
    }
  });

  document.getElementById('lockForgotBtn')?.addEventListener('click', function(){
    if(confirm('This resets your lock password — it does NOT delete your lecture data, just the password protecting this screen. Continue?')){
      localStorage.removeItem(PW_HASH_KEY);
      localStorage.removeItem(UNLOCKED_KEY);
      showLock();
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', function(){
    if(confirm('Log out? You\'ll need your password to get back in on this device.')){
      localStorage.removeItem(UNLOCKED_KEY);
      showLock();
    }
  });

  initLock();

  /* ---------- Local storage (auto-save on this device) ---------- */
  function saveToStorage(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, troublemakers }));
      setSaveIndicator('Saved to this browser');
    } catch(err){
      console.error('Could not save to localStorage:', err);
      setSaveIndicator('Could not auto-save — storage may be full. Export a backup soon.', true);
    }
  }

  function loadFromStorage(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return;
      const data = JSON.parse(raw);
      if(Array.isArray(data.entries)) entries = data.entries;
      if(Array.isArray(data.troublemakers)) troublemakers = data.troublemakers;
    } catch(err){
      console.error('Could not read saved data:', err);
    }
  }

  let saveIndicatorTimer = null;
  function setSaveIndicator(text, isWarning){
    const el = document.getElementById('saveIndicator');
    if(!el) return;
    el.textContent = text;
    el.style.color = isWarning ? '#C9584A' : '';
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = setTimeout(() => { el.textContent = ''; }, 2500);
  }

  const form = document.getElementById('entryForm');
  const ledgerBody = document.getElementById('ledgerBody');
  const emptyState = document.getElementById('emptyState');
  const statsRow = document.getElementById('statsRow');
  const submitBtn = document.getElementById('submitBtn');
  const photoInput = document.getElementById('photo');
  const photoFileName = document.getElementById('photoFileName');

  const fStandard = document.getElementById('filterStandard');
  const fDivision = document.getElementById('filterDivision');
  const fStatus = document.getElementById('filterStatus');
  const fSearch = document.getElementById('searchTopic');

  const troubleForm = document.getElementById('troubleForm');
  const troubleBody = document.getElementById('troubleBody');
  const troubleEmptyState = document.getElementById('troubleEmptyState');
  const troubleSubmitBtn = document.getElementById('troubleSubmitBtn');
  const tLectureSelect = document.getElementById('tLecture');
  const troubleSearch = document.getElementById('troubleSearch');

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');

  function uid(prefix){ return (prefix||'e') + Math.random().toString(36).slice(2, 10); }

  function statusPillClass(status){
    if(status === 'Regular Class') return 'pill-regular';
    if(status === 'Vacation') return 'pill-vacation';
    return 'pill-noclass';
  }

  function fmtDate(iso){
    if(!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  function fmtTime(t){
    if(!t) return '—';
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = ((h % 12) || 12);
    return `${h12}:${String(m).padStart(2,'0')} ${period}`;
  }

  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /* ---------- Photo handling (resize to keep file sizes sane) ---------- */
  function resizeImage(file, maxWidth, quality){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e){
        const img = new Image();
        img.onload = function(){
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  photoInput.addEventListener('change', function(){
    const file = photoInput.files[0];
    if(!file){ pendingPhoto = null; photoFileName.textContent = ''; return; }
    photoFileName.textContent = 'Processing ' + file.name + '…';
    resizeImage(file, 900, 0.72).then(dataUrl => {
      pendingPhoto = dataUrl;
      photoFileName.textContent = 'Attached: ' + file.name;
    }).catch(() => {
      pendingPhoto = null;
      photoFileName.textContent = 'Could not read that image — try another file.';
    });
  });

  lightbox.addEventListener('click', function(e){ if(e.target === lightbox) closeLightbox(); });
  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  function openLightbox(src){ lightboxImg.src = src; lightbox.classList.add('open'); }
  function closeLightbox(){ lightbox.classList.remove('open'); lightboxImg.src=''; }

  /* ---------- Stats ---------- */
  function renderStats(){
    const total = entries.length;
    const regular = entries.filter(e => e.status === 'Regular Class').length;
    const troubleCount = troublemakers.length;
    statsRow.innerHTML = `
      <div class="stat"><span class="num">${total}</span><span class="label">Total lectures</span></div>
      <div class="stat"><span class="num">${regular}</span><span class="label">Regular classes</span></div>
      <div class="stat"><span class="num">${troubleCount}</span><span class="label">Troublemaker notes</span></div>
    `;
  }

  /* ---------- Lecture entries ---------- */
  function getFilteredEntries(){
    return entries.slice()
      .sort((a,b) => (b.date || '').localeCompare(a.date || ''))
      .filter(e => !fStandard.value || e.standard === fStandard.value)
      .filter(e => !fDivision.value || e.division === fDivision.value)
      .filter(e => !fStatus.value || e.status === fStatus.value)
      .filter(e => !fSearch.value || e.topic.toLowerCase().includes(fSearch.value.toLowerCase()));
  }

  function lectureLabel(e){
    const timePart = e.time ? ', ' + fmtTime(e.time) : '';
    return `${fmtDate(e.date)}${timePart} — ${e.standard} ${e.division} · ${e.group}`;
  }

  function parseTroublePairs(rollsStr, namesStr){
    const rolls = (rollsStr || '').split(',').map(s => s.trim()).filter(Boolean);
    const names = (namesStr || '').split(',').map(s => s.trim()).filter(Boolean);
    const len = Math.max(rolls.length, names.length);
    const pairs = [];
    for(let i = 0; i < len; i++){
      const roll = rolls[i] || '';
      const name = names[i] || '';
      if(roll || name) pairs.push({ roll, name });
    }
    return pairs;
  }

  function troubleDisplayForEntry(e){
    const linked = troublemakers.filter(t => t.lectureId === e.id);
    if(linked.length === 0) return '—';
    return linked.map(t => t.roll && t.name ? `${t.roll} - ${t.name}` : (t.name || t.roll)).join(', ');
  }

  function renderLectureOptions(){
    const current = tLectureSelect.value;
    const sorted = entries.slice().sort((a,b) => (b.date||'').localeCompare(a.date||''));
    tLectureSelect.innerHTML = '<option value="">Not linked to a specific class</option>' +
      sorted.map(e => `<option value="${e.id}">${escapeHtml(lectureLabel(e))}</option>`).join('');
    tLectureSelect.value = current;
  }

  function renderLectures(){
    const rows = getFilteredEntries();
    ledgerBody.innerHTML = '';
    emptyState.style.display = entries.length === 0 ? 'block' : 'none';

    rows.forEach(e => {
      const tr = document.createElement('tr');
      const photoCell = e.photo
        ? `<img class="thumb" src="${e.photo}" data-full="${e.photo}" alt="Class photo">`
        : `<span class="no-photo">—</span>`;
      tr.innerHTML = `
        <td class="date-cell">${fmtDate(e.date)}</td>
        <td class="date-cell">${fmtTime(e.time)}</td>
        <td>${e.standard}</td>
        <td>${e.division}</td>
        <td>${e.group}</td>
        <td>${escapeHtml(e.topic)}</td>
        <td>${e.present !== '' ? e.present : '—'}</td>
        <td>${e.absent ? escapeHtml(e.absent) : '—'}</td>
        <td>${e.excelled === 'N/A' ? 'N/A' : (e.excelled !== '' && e.excelled !== undefined ? e.excelled + '%' : '—')}</td>
        <td><span class="pill ${statusPillClass(e.status)}">${e.status}</span></td>
        <td>${photoCell}</td>
        <td>${escapeHtml(troubleDisplayForEntry(e))}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-action="edit" data-id="${e.id}" title="Edit">✎</button>
            <button class="icon-btn" data-action="delete" data-id="${e.id}" title="Delete">🗑</button>
          </div>
        </td>
      `;
      ledgerBody.appendChild(tr);
    });

    ledgerBody.querySelectorAll('img.thumb').forEach(img => {
      img.addEventListener('click', () => openLightbox(img.dataset.full));
    });

    renderStats();
    renderLectureOptions();
  }

  function readForm(){
    return {
      date: document.getElementById('date').value,
      time: document.getElementById('time').value,
      standard: document.getElementById('standard').value,
      division: document.getElementById('division').value,
      group: document.getElementById('group').value,
      topic: document.getElementById('topic').value.trim(),
      outcomes: document.getElementById('outcomes').value.trim(),
      present: document.getElementById('present').value,
      absent: document.getElementById('absent').value.trim(),
      excelled: document.getElementById('excelled').value,
      status: document.getElementById('status').value,
      note: document.getElementById('note').value.trim(),
      photo: pendingPhoto,
    };
  }

  function fillForm(entry){
    document.getElementById('date').value = entry.date;
    document.getElementById('time').value = entry.time || '';
    document.getElementById('standard').value = entry.standard;
    document.getElementById('division').value = entry.division;
    document.getElementById('group').value = entry.group;
    document.getElementById('topic').value = entry.topic;
    document.getElementById('outcomes').value = entry.outcomes || '';
    document.getElementById('present').value = entry.present;
    document.getElementById('absent').value = entry.absent || '';
    document.getElementById('excelled').value = entry.excelled;
    document.getElementById('status').value = entry.status;
    document.getElementById('note').value = entry.note || '';
    pendingPhoto = entry.photo || null;
    photoFileName.textContent = entry.photo ? 'Current photo kept (choose a file to replace it)' : '';
  }

  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    const data = readForm();

    const missing = [];

    // Standard / Division / Group are required for every status except "No Class"
    if(data.status !== 'No Class'){
      if(!data.standard) missing.push('Standard');
      if(!data.division) missing.push('Division');
      if(!data.group) missing.push('Group');
    }

    // Topic, outcomes, and attendance only matter when a class actually happened
    if(data.status === 'Regular Class'){
      if(!data.topic) missing.push('Topic covered');
      if(data.present === '') missing.push('Students present');
    }

    // A note explaining why is required specifically for "No Class"
    if(data.status === 'No Class' && !data.note){
      missing.push('Note (reason for no class)');
    }

    if(missing.length){
      alert('Please fill in: ' + missing.join(', '));
      return;
    }

    if(data.status !== 'Regular Class'){
      // fill anything still blank with N/A so reports/exports show it clearly
      ['standard','division','group','topic','present','absent','excelled'].forEach(key => {
        if(data[key] === '' || data[key] === undefined || data[key] === null) data[key] = 'N/A';
      });
    }

    let savedEntry;
    if(editingId){
      const idx = entries.findIndex(e => e.id === editingId);
      if(idx > -1){ entries[idx] = { ...entries[idx], ...data }; savedEntry = entries[idx]; }
      editingId = null;
      submitBtn.textContent = 'Add entry';
    } else {
      savedEntry = { id: uid('e'), ...data };
      entries.push(savedEntry);
    }

    if(savedEntry && savedEntry.photo) writeLocalPhotoFile(savedEntry);

    form.reset();
    pendingPhoto = null;
    photoFileName.textContent = '';
    renderLectures();
    renderTroublemakers();
    saveToStorage(); autoSyncIfEnabled(); writeLocalDataFile();
  });

  document.getElementById('resetBtn').addEventListener('click', function(){
    form.reset();
    editingId = null;
    pendingPhoto = null;
    photoFileName.textContent = '';
    submitBtn.textContent = 'Add entry';
  });

  ledgerBody.addEventListener('click', function(ev){
    const btn = ev.target.closest('button[data-action]');
    if(!btn) return;
    const id = btn.dataset.id;
    const entry = entries.find(e => e.id === id);
    if(!entry) return;

    if(btn.dataset.action === 'delete'){
      if(confirm('Delete this lecture entry? Any troublemaker notes linked to it will stay in the list, just unlinked.')){
        entries = entries.filter(e => e.id !== id);
        troublemakers.forEach(t => { if(t.lectureId === id) t.lectureId = ''; });
        renderLectures();
        renderTroublemakers();
        saveToStorage(); autoSyncIfEnabled(); writeLocalDataFile();
      }
    } else if(btn.dataset.action === 'edit'){
      fillForm(entry);
      editingId = id;
      submitBtn.textContent = 'Save changes';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  [fStandard, fDivision, fStatus].forEach(el => el.addEventListener('change', renderLectures));
  fSearch.addEventListener('input', renderLectures);

  /* ---------- Troublemakers ---------- */
  function getFilteredTroublemakers(){
    const q = troubleSearch.value.toLowerCase();
    return troublemakers.slice()
      .filter(t => !q || t.name.toLowerCase().includes(q) || String(t.roll).toLowerCase().includes(q));
  }

  function renderTroublemakers(){
    const rows = getFilteredTroublemakers();
    troubleBody.innerHTML = '';
    troubleEmptyState.style.display = troublemakers.length === 0 ? 'block' : 'none';

    const countByRoll = {};
    troublemakers.forEach(t => { countByRoll[t.roll] = (countByRoll[t.roll]||0) + 1; });

    rows.forEach(t => {
      const linked = entries.find(e => e.id === t.lectureId);
      const times = countByRoll[t.roll] || 1;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(t.roll)}</td>
        <td>${escapeHtml(t.name)}</td>
        <td>${escapeHtml(t.note)}</td>
        <td>${linked ? escapeHtml(lectureLabel(linked)) : '—'}</td>
        <td style="text-align:center;">
          <input type="checkbox" class="met-parent-toggle" data-id="${t.id}" ${t.metParent ? 'checked' : ''} title="Have you met this student's parent(s)?">
        </td>
        <td>${times > 1 ? `<span class="pill pill-repeat">${times}×</span>` : '1'}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-action="edit" data-id="${t.id}" title="Edit">✎</button>
            <button class="icon-btn" data-action="delete" data-id="${t.id}" title="Delete">🗑</button>
          </div>
        </td>
      `;
      troubleBody.appendChild(tr);
    });

    renderStats();
  }

  function readTroubleForm(){
    return {
      roll: document.getElementById('tRoll').value.trim(),
      name: document.getElementById('tName').value.trim(),
      note: document.getElementById('tNote').value.trim(),
      lectureId: tLectureSelect.value,
    };
  }

  function fillTroubleForm(t){
    document.getElementById('tRoll').value = t.roll;
    document.getElementById('tName').value = t.name;
    document.getElementById('tNote').value = t.note;
    tLectureSelect.value = t.lectureId || '';
  }

  troubleForm.addEventListener('submit', function(ev){
    ev.preventDefault();
    const data = readTroubleForm();
    const pairs = parseTroublePairs(data.roll, data.name);

    if(pairs.length === 0){
      alert('Enter at least one roll number or name.');
      return;
    }

    if(editingTroubleId){
      // editing an existing note: update it with the first pair; any extra pairs become new notes
      const idx = troublemakers.findIndex(t => t.id === editingTroubleId);
      if(idx > -1){
        troublemakers[idx] = { ...troublemakers[idx], roll: pairs[0].roll, name: pairs[0].name, note: data.note, lectureId: data.lectureId };
      }
      pairs.slice(1).forEach(p => {
        troublemakers.push({ id: uid('t'), roll: p.roll, name: p.name, note: data.note, lectureId: data.lectureId, source: 'manual' });
      });
      editingTroubleId = null;
      troubleSubmitBtn.textContent = 'Add note';
    } else {
      pairs.forEach(p => {
        troublemakers.push({ id: uid('t'), roll: p.roll, name: p.name, note: data.note, lectureId: data.lectureId, source: 'manual' });
      });
    }

    troubleForm.reset();
    renderTroublemakers();
    saveToStorage(); autoSyncIfEnabled(); writeLocalDataFile();
  });

  document.getElementById('troubleResetBtn').addEventListener('click', function(){
    troubleForm.reset();
    editingTroubleId = null;
    troubleSubmitBtn.textContent = 'Add note';
  });

  troubleBody.addEventListener('click', function(ev){
    const btn = ev.target.closest('button[data-action]');
    if(!btn) return;
    const id = btn.dataset.id;
    const t = troublemakers.find(t => t.id === id);
    if(!t) return;

    if(btn.dataset.action === 'delete'){
      if(confirm('Delete this troublemaker note?')){
        troublemakers = troublemakers.filter(t => t.id !== id);
        renderTroublemakers();
        saveToStorage(); autoSyncIfEnabled(); writeLocalDataFile();
      }
    } else if(btn.dataset.action === 'edit'){
      fillTroubleForm(t);
      editingTroubleId = id;
      troubleSubmitBtn.textContent = 'Save changes';
      document.getElementById('troubleForm').scrollIntoView({ behavior:'smooth', block:'center' });
    }
  });

  troubleBody.addEventListener('change', function(ev){
    const box = ev.target.closest('.met-parent-toggle');
    if(!box) return;
    const t = troublemakers.find(t => t.id === box.dataset.id);
    if(!t) return;
    t.metParent = box.checked;
    saveToStorage(); autoSyncIfEnabled(); writeLocalDataFile();
  });

  troubleSearch.addEventListener('input', renderTroublemakers);

  /* ---------- Export / Import ---------- */
  function downloadFile(content, filename, mime){
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  document.getElementById('exportCsv').addEventListener('click', function(){
    if(entries.length === 0){ alert('No entries to export yet.'); return; }
    const headers = ['Date','Time','Standard','Division','Group','Topic Covered','Learning Outcomes','Students Present','Absent Roll Numbers','% Excelled','Status','Note','Photo Attached','Troublemakers'];
    const rows = entries.slice().sort((a,b)=> (a.date||'').localeCompare(b.date||'')).map(e => [
      e.date, e.time || '', e.standard, e.division, e.group,
      `"${(e.topic||'').replace(/"/g,'""')}"`,
      `"${(e.outcomes||'').replace(/"/g,'""')}"`, e.present,
      `"${(e.absent||'').replace(/"/g,'""')}"`, e.excelled, e.status,
      `"${(e.note||'').replace(/"/g,'""')}"`,
      e.photo ? 'Yes' : 'No',
      `"${troubleDisplayForEntry(e).replace(/"/g,'""')}"`
    ].join(','));
    downloadFile([headers.join(','), ...rows].join('\n'), 'lecture-ledger.csv', 'text/csv');
  });

  document.getElementById('exportTroubleCsv').addEventListener('click', function(){
    if(troublemakers.length === 0){ alert('No troublemaker notes to export yet.'); return; }
    const headers = ['Roll Number','Name','Note','Linked Lecture','Met Parent'];
    const rows = troublemakers.map(t => {
      const linked = entries.find(e => e.id === t.lectureId);
      return [
        `"${(t.roll||'').replace(/"/g,'""')}"`,
        `"${(t.name||'').replace(/"/g,'""')}"`,
        `"${(t.note||'').replace(/"/g,'""')}"`,
        `"${linked ? lectureLabel(linked).replace(/"/g,'""') : ''}"`,
        t.metParent ? 'Yes' : 'No'
      ].join(',');
    });
    downloadFile([headers.join(','), ...rows].join('\n'), 'troublemakers.csv', 'text/csv');
  });

  document.getElementById('exportJson').addEventListener('click', function(){
    if(entries.length === 0 && troublemakers.length === 0){ alert('Nothing to export yet.'); return; }
    downloadFile(JSON.stringify({ entries, troublemakers }, null, 2), 'lecture-ledger.json', 'application/json');
  });

  document.getElementById('importJsonBtn').addEventListener('click', function(){
    document.getElementById('importJsonFile').click();
  });

  document.getElementById('importJsonFile').addEventListener('change', function(ev){
    const file = ev.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e){
      try{
        const imported = JSON.parse(e.target.result);
        let newEntries, newTroublemakers;
        if(Array.isArray(imported)){
          newEntries = imported; newTroublemakers = [];
        } else if(imported && Array.isArray(imported.entries)){
          newEntries = imported.entries;
          newTroublemakers = Array.isArray(imported.troublemakers) ? imported.troublemakers : [];
        } else {
          throw new Error('Invalid file');
        }
        newEntries.forEach(item => { if(!item.id) item.id = uid('e'); });
        newTroublemakers.forEach(item => { if(!item.id) item.id = uid('t'); });
        entries = newEntries;
        troublemakers = newTroublemakers;
        renderLectures();
        renderTroublemakers();
        saveToStorage(); autoSyncIfEnabled(); writeLocalDataFile();
        alert('Imported ' + entries.length + ' lecture(s) and ' + troublemakers.length + ' troublemaker note(s).');
      } catch(err){
        alert('Could not read that file. Make sure it is a Lecture Ledger JSON export.');
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  });

  /* ---------- Monthly report (PDF) ---------- */
  const TEACHER_KEY = 'lectureLedger.teacherName';
  const reportTeacherInput = document.getElementById('reportTeacher');

  if(reportTeacherInput){
    reportTeacherInput.value = localStorage.getItem(TEACHER_KEY) || '';
    reportTeacherInput.addEventListener('change', function(){
      localStorage.setItem(TEACHER_KEY, reportTeacherInput.value.trim());
    });
  }

  function monthLabel(monthValue){
    if(!monthValue) return '';
    const [y, m] = monthValue.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  document.getElementById('reportForm')?.addEventListener('submit', function(ev){
    ev.preventDefault();

    const teacher = reportTeacherInput.value.trim();
    const month = document.getElementById('reportMonth').value; // "YYYY-MM"
    const standard = document.getElementById('reportStandard').value;
    const division = document.getElementById('reportDivision').value;

    if(!month || !standard || !division){
      alert('Please fill in month, standard, and division.');
      return;
    }

    const matching = entries
      .filter(e => e.standard === standard && e.division === division && (e.date || '').startsWith(month))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));

    if(matching.length === 0){
      alert('No lectures logged for ' + standard + ' ' + division + ' in ' + monthLabel(month) + ' yet.');
      return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
      alert('The PDF library did not load — check your internet connection and try again.');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Performance Report (Innovation Lab)', 40, 40);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const headerY = 62;
    doc.text(`Teacher: ${teacher || '—'}`, 40, headerY);
    doc.text(`Class: ${standard}`, 250, headerY);
    doc.text(`Div: ${division}`, 350, headerY);
    doc.text(`Month: ${monthLabel(month)}`, 450, headerY);

    const rows = matching.map((e, i) => [
      String(i + 1),
      fmtDate(e.date) + (e.time ? ', ' + fmtTime(e.time) : ''),
      e.topic || '—',
      e.outcomes || '—',
      e.present !== '' && e.present !== undefined ? String(e.present) : '—',
      e.absent ? e.absent : '—',
      e.status || '—',
    ]);

    doc.autoTable({
      startY: 78,
      head: [['Session', 'Date', 'Class Activity', 'Learning Outcomes', 'Present', 'Absent (roll no.)', 'Status']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 6, valign: 'top' },
      headStyles: { fillColor: [31, 61, 52], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 45 },
        1: { cellWidth: 85 },
        4: { cellWidth: 45 },
        5: { cellWidth: 90 },
        6: { cellWidth: 60 },
      },
    });

    const safeStandard = standard.replace(/\W+/g, '');
    doc.save(`Performance-Report_${safeStandard}${division}_${month}.pdf`);
  });

  /* ---------- Google Sheets backup (via Apps Script web app link) ---------- */
  const GS_SETTINGS_KEY = 'lectureLedger.gsSettings';

  const gsWebAppUrlInput = document.getElementById('gsWebAppUrl');
  const gsSecretInput = document.getElementById('gsSecret');
  const gsAutoSyncCheckbox = document.getElementById('gsAutoSync');
  const gsStatus = document.getElementById('gsStatus');
  const gsSyncBtn = document.getElementById('gsSyncBtn');

  function loadGsSettings(){
    try{
      const raw = localStorage.getItem(GS_SETTINGS_KEY);
      if(!raw) return;
      const s = JSON.parse(raw);
      if(gsWebAppUrlInput) gsWebAppUrlInput.value = s.webAppUrl || '';
      if(gsSecretInput) gsSecretInput.value = s.secret || '';
      if(gsAutoSyncCheckbox) gsAutoSyncCheckbox.checked = !!s.autoSync;
    } catch(err){ console.error('Could not read Google Sheets settings:', err); }
  }

  function saveGsSettings(){
    const s = {
      webAppUrl: gsWebAppUrlInput.value.trim(),
      secret: gsSecretInput.value.trim(),
      autoSync: gsAutoSyncCheckbox.checked,
    };
    localStorage.setItem(GS_SETTINGS_KEY, JSON.stringify(s));
    return s;
  }

  function setGsStatus(text, isWarning){
    if(!gsStatus) return;
    gsStatus.textContent = text;
    gsStatus.style.color = isWarning ? '#C9584A' : '';
  }

  document.getElementById('sheetsSettingsForm')?.addEventListener('submit', function(ev){
    ev.preventDefault();
    saveGsSettings();
    setGsStatus('Settings saved. Click "Sync now" to test the connection.');
  });

  gsAutoSyncCheckbox?.addEventListener('change', saveGsSettings);

  function buildSheetRows(){
    const headers = ['Date','Time','Standard','Division','Group','Topic Covered','Learning Outcomes','Students Present','Absent Roll Numbers','% Excelled','Status','Note','Photo Attached','Troublemakers'];
    const sorted = entries.slice().sort((a,b) => (a.date||'').localeCompare(b.date||'') || (a.time||'').localeCompare(b.time||''));
    const rows = sorted.map(e => [
      e.date || '', e.time || '', e.standard || '', e.division || '', e.group || '',
      e.topic || '', e.outcomes || '',
      e.present !== '' && e.present !== undefined ? String(e.present) : '',
      e.absent || '', e.excelled || '', e.status || '',
      e.note || '',
      e.photo ? 'Yes' : 'No',
      troubleDisplayForEntry(e),
    ]);
    return [headers, ...rows];
  }

  async function syncToGoogleSheet(){
    const settings = saveGsSettings();
    if(!settings.webAppUrl){
      alert('Paste your Google Apps Script web app URL and click "Save settings" first.');
      return;
    }

    setGsStatus('Syncing…');
    const values = buildSheetRows();

    try{
      // sent as text/plain to avoid a CORS preflight, which Apps Script web apps don't handle
      const resp = await fetch(settings.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: settings.secret, values }),
      });

      const result = await resp.json().catch(() => null);

      if(!resp.ok || !result || result.ok === false){
        throw new Error((result && result.error) || ('HTTP ' + resp.status));
      }

      setGsStatus('Synced ✓ (' + entries.length + ' lectures) at ' + new Date().toLocaleTimeString());
    } catch(err){
      console.error('Google Sheets sync failed:', err);
      setGsStatus('Sync failed: ' + err.message + ' — check the URL and secret.', true);
    }
  }

  gsSyncBtn?.addEventListener('click', syncToGoogleSheet);

  function autoSyncIfEnabled(){
    const settings = JSON.parse(localStorage.getItem(GS_SETTINGS_KEY) || '{}');
    if(settings.autoSync && settings.webAppUrl) syncToGoogleSheet();
  }

  loadGsSettings();

  /* ---------- Local Excel (.xlsx) backup ---------- */
  document.getElementById('exportExcelBtn')?.addEventListener('click', function(){
    if(!window.XLSX){ alert('The Excel library did not load — check your internet connection and try again.'); return; }
    if(entries.length === 0 && troublemakers.length === 0){ alert('Nothing to export yet.'); return; }

    const lectureHeaders = ['id','date','time','standard','division','group','topic','outcomes','present','absent','excelled','status','note','photo'];
    const lectureRows = entries.map(e => lectureHeaders.map(h => e[h] ?? ''));

    const troubleHeaders = ['id','roll','name','note','lectureId','metParent','source'];
    const troubleRows = troublemakers.map(t => troubleHeaders.map(h => t[h] ?? ''));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([lectureHeaders, ...lectureRows]), 'Lectures');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([troubleHeaders, ...troubleRows]), 'Troublemakers');

    XLSX.writeFile(wb, 'lecture-ledger-backup.xlsx');
  });

  document.getElementById('importExcelBtn')?.addEventListener('click', function(){
    document.getElementById('importExcelFile').click();
  });

  document.getElementById('importExcelFile')?.addEventListener('change', function(ev){
    const file = ev.target.files[0];
    if(!file) return;
    if(!window.XLSX){ alert('The Excel library did not load — check your internet connection and try again.'); ev.target.value = ''; return; }

    const reader = new FileReader();
    reader.onload = function(e){
      try{
        const wb = XLSX.read(e.target.result, { type: 'array' });

        const lectureSheet = wb.Sheets['Lectures'];
        const troubleSheet = wb.Sheets['Troublemakers'];
        if(!lectureSheet) throw new Error('No "Lectures" sheet found in this file.');

        const lectureAoa = XLSX.utils.sheet_to_json(lectureSheet, { header: 1, defval: '' });
        const lectureHeaders = lectureAoa[0];
        const newEntries = lectureAoa.slice(1).filter(r => r.length && r.some(c => c !== '')).map(row => {
          const obj = {};
          lectureHeaders.forEach((h, i) => { obj[h] = row[i] ?? ''; });
          if(!obj.id) obj.id = uid('e');
          return obj;
        });

        let newTroublemakers = [];
        if(troubleSheet){
          const troubleAoa = XLSX.utils.sheet_to_json(troubleSheet, { header: 1, defval: '' });
          const troubleHeaders = troubleAoa[0];
          newTroublemakers = troubleAoa.slice(1).filter(r => r.length && r.some(c => c !== '')).map(row => {
            const obj = {};
            troubleHeaders.forEach((h, i) => { obj[h] = row[i] ?? ''; });
            if(!obj.id) obj.id = uid('t');
            obj.metParent = obj.metParent === true || obj.metParent === 'true' || obj.metParent === 'TRUE';
            return obj;
          });
        }

        entries = newEntries;
        troublemakers = newTroublemakers;
        renderLectures();
        renderTroublemakers();
        saveToStorage();
        alert('Imported ' + entries.length + ' lecture(s) and ' + troublemakers.length + ' troublemaker note(s) from Excel.');
      } catch(err){
        console.error(err);
        alert('Could not read that file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    ev.target.value = '';
  });

  /* ---------- Auto-save to a local data file (Chrome/Edge desktop only) ---------- */
  const IDB_NAME = 'lectureLedgerFS';
  const IDB_STORE = 'handles';
  const LOCAL_FILE_NAME = 'lecture-ledger-data.json';
  let dirHandle = null;

  const connectFolderBtn = document.getElementById('connectFolderBtn');
  const folderStatus = document.getElementById('folderStatus');

  function setFolderStatus(text, isWarning){
    if(!folderStatus) return;
    folderStatus.textContent = text;
    folderStatus.style.color = isWarning ? '#C9584A' : '';
  }

  function idbOpen(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key){
    try{
      const db = await idbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch(err){ console.error('IndexedDB read failed:', err); return null; }
  }

  async function idbSet(key, value){
    try{
      const db = await idbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch(err){ console.error('IndexedDB write failed:', err); }
  }

  async function getSubDir(name){
    if(!dirHandle) return null;
    try{
      return await dirHandle.getDirectoryHandle(name, { create: true });
    } catch(err){
      console.error('Could not open/create "' + name + '" folder:', err);
      return null;
    }
  }

  async function writeLocalDataFile(){
    if(!dirHandle) return;
    try{
      const dataDir = await getSubDir('data');
      if(!dataDir) return;
      const fileHandle = await dataDir.getFileHandle(LOCAL_FILE_NAME, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify({ entries, troublemakers, savedAt: new Date().toISOString() }, null, 2));
      await writable.close();
      setFolderStatus('Connected ✓ — last saved to data/' + LOCAL_FILE_NAME + ' at ' + new Date().toLocaleTimeString());
    } catch(err){
      console.error('Could not write local data file:', err);
      setFolderStatus('Could not save automatically — click "Connect a folder" again.', true);
    }
  }

  function dataUrlToBlob(dataUrl){
    const [meta, base64] = dataUrl.split(',');
    const mimeMatch = meta.match(/data:(.*);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function writeLocalPhotoFile(entry){
    if(!dirHandle || !entry || !entry.photo) return;
    try{
      const photosDir = await getSubDir('photos');
      if(!photosDir) return;
      const ext = entry.photo.startsWith('data:image/png') ? 'png' : 'jpg';
      const filename = (entry.date || 'undated') + '_' + entry.id + '.' + ext;
      const blob = dataUrlToBlob(entry.photo);
      const fileHandle = await photosDir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch(err){
      console.error('Could not write photo file:', err);
    }
  }

  async function connectFolder(){
    if(!window.showDirectoryPicker){
      alert('This feature needs Chrome or Edge on a computer — it isn\'t available in this browser. Use Export/Import or Google Sheets sync instead.');
      return;
    }
    try{
      let handle = await idbGet('dirHandle');
      let needsPicker = !handle;

      if(handle){
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if(perm !== 'granted'){
          const req = await handle.requestPermission({ mode: 'readwrite' });
          if(req !== 'granted'){ needsPicker = true; }
        }
      }

      if(needsPicker){
        handle = await window.showDirectoryPicker();
        await idbSet('dirHandle', handle);
      }

      dirHandle = handle;
      await writeLocalDataFile();
      const withPhotos = entries.filter(e => e.photo);
      for(const e of withPhotos){ await writeLocalPhotoFile(e); }
      if(withPhotos.length) setFolderStatus('Connected ✓ — synced data and ' + withPhotos.length + ' existing photo(s).');
    } catch(err){
      if(err.name !== 'AbortError'){
        console.error('Could not connect folder:', err);
        setFolderStatus('Could not connect: ' + err.message, true);
      }
    }
  }

  connectFolderBtn?.addEventListener('click', connectFolder);

  // On load, try to silently resume a previous connection (only works if permission
  // was already granted earlier in this browser — otherwise a click is needed).
  (async function tryResumeFolder(){
    if(!window.showDirectoryPicker || !connectFolderBtn) return;
    const handle = await idbGet('dirHandle');
    if(!handle) return;
    try{
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if(perm === 'granted'){
        dirHandle = handle;
        setFolderStatus('Connected ✓ (resumed from last time)');
      } else {
        setFolderStatus('Previously connected to "' + handle.name + '" — click "Connect a folder" to resume.');
      }
    } catch(err){
      console.error('Could not resume folder connection:', err);
    }
  })();

  document.getElementById('resetAllBtn')?.addEventListener('click', function(){
    if(confirm('This clears ALL lectures and troublemaker notes saved in this browser. Export a backup first if you want to keep them. Continue?')){
      entries = [];
      troublemakers = [];
      localStorage.removeItem(STORAGE_KEY);
      renderLectures();
      renderTroublemakers();
      setSaveIndicator('All data cleared');
    }
  });

  loadFromStorage();
  renderLectures();
  renderTroublemakers();
})();
