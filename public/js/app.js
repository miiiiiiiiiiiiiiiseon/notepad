// ----------------------------- 상태 -----------------------------
const state = {
  notebooks: [],
  tags: [],
  notes: [],
  currentNote: null,   // 현재 열린 노트 객체
  filter: { type: 'all', id: null }, // all | notebook | tag
  search: '',
};

let quill;
let saveTimer = null;

// --------------------------- API 헬퍼 ---------------------------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) { location.href = '/login'; return; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '요청 실패');
  }
  return res.status === 204 ? null : res.json();
}

// --------------------------- 초기화 ----------------------------
function initEditor() {
  quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: '여기에 내용을 입력하세요...',
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
        [{ color: [] }, { background: [] }],
        ['blockquote', 'code-block', 'link'],
        ['clean'],
      ],
    },
  });
  quill.on('text-change', (d, o, source) => {
    if (source === 'user') scheduleSave();
  });
}

// --------------------------- 사이드바 --------------------------
async function loadSidebar() {
  [state.notebooks, state.tags] = await Promise.all([
    api('GET', '/api/notebooks'),
    api('GET', '/api/tags'),
  ]);
  renderNotebooks();
  renderTags();
  renderNotebookOptions();
}

function renderNotebooks() {
  const ul = document.getElementById('notebookList');
  ul.innerHTML = '';
  state.notebooks.forEach((nb) => {
    const li = document.createElement('li');
    li.className = state.filter.type === 'notebook' && state.filter.id === nb.id ? 'active' : '';
    li.innerHTML = `<span class="nb-name">📓 ${escapeHtml(nb.name)}</span>
                    <span class="count">${nb.note_count}</span>
                    <button class="del-x" title="삭제">✕</button>`;
    li.querySelector('.nb-name').onclick = () => setFilter('notebook', nb.id, nb.name);
    li.querySelector('.del-x').onclick = (e) => { e.stopPropagation(); deleteNotebook(nb); };
    ul.appendChild(li);
  });
}

function renderTags() {
  const ul = document.getElementById('tagList');
  ul.innerHTML = '';
  if (!state.tags.length) {
    ul.innerHTML = '<li style="opacity:.5;cursor:default">태그 없음</li>';
    return;
  }
  state.tags.forEach((t) => {
    const li = document.createElement('li');
    li.className = state.filter.type === 'tag' && state.filter.id === t.id ? 'active' : '';
    li.innerHTML = `<span class="nb-name"># ${escapeHtml(t.name)}</span>
                    <span class="count">${t.note_count}</span>`;
    li.onclick = () => setFilter('tag', t.id, '# ' + t.name);
    ul.appendChild(li);
  });
}

function renderNotebookOptions() {
  const sel = document.getElementById('noteNotebook');
  sel.innerHTML = '<option value="">(노트북 없음)</option>' +
    state.notebooks.map((nb) => `<option value="${nb.id}">${escapeHtml(nb.name)}</option>`).join('');
}

// --------------------------- 필터/목록 -------------------------
function setFilter(type, id, label) {
  state.filter = { type, id };
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  if (type === 'all') document.querySelector('[data-filter="all"]').classList.add('active');
  document.getElementById('listTitle').textContent = label || '모든 노트';
  renderNotebooks();
  renderTags();
  loadNotes();
}

async function loadNotes() {
  const params = new URLSearchParams();
  if (state.filter.type === 'notebook') params.set('notebook', state.filter.id);
  if (state.filter.type === 'tag') params.set('tag', state.filter.id);
  if (state.search) params.set('q', state.search);
  state.notes = await api('GET', '/api/notes?' + params.toString());
  renderNoteList();
}

function renderNoteList() {
  const ul = document.getElementById('noteList');
  ul.innerHTML = '';
  if (!state.notes.length) {
    ul.innerHTML = '<li class="empty-hint" style="cursor:default">노트가 없습니다.</li>';
    return;
  }
  state.notes.forEach((n) => {
    const li = document.createElement('li');
    if (state.currentNote && state.currentNote.id === n.id) li.className = 'active';
    li.innerHTML = `<div class="nl-title">${escapeHtml(n.title) || '(제목 없음)'}</div>
                    <div class="nl-preview">${escapeHtml(n.preview || '')}</div>
                    <div class="nl-date">${formatDate(n.updated_at)}</div>`;
    li.onclick = () => openNote(n.id);
    ul.appendChild(li);
  });
}

// --------------------------- 노트 열기 -------------------------
async function openNote(id) {
  const note = await api('GET', '/api/notes/' + id);
  state.currentNote = note;
  document.getElementById('editorEmpty').classList.add('hidden');
  document.getElementById('editorWrap').classList.remove('hidden');
  document.getElementById('noteTitle').value = note.title;
  document.getElementById('noteNotebook').value = note.notebook_id || '';
  document.getElementById('noteTags').value = (note.tags || []).join(', ');
  quill.root.innerHTML = note.content || '';
  document.getElementById('saveStatus').textContent = '';
  renderNoteList();
}

// --------------------------- 새 노트 --------------------------
async function newNote() {
  const notebook_id = state.filter.type === 'notebook' ? state.filter.id : null;
  const note = await api('POST', '/api/notes', { title: '', content: '', notebook_id });
  await loadNotes();
  await loadSidebar();
  openNote(note.id);
  document.getElementById('noteTitle').focus();
}

// --------------------------- 저장 -----------------------------
function scheduleSave() {
  document.getElementById('saveStatus').textContent = '입력 중...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 800);
}

async function saveNote() {
  if (!state.currentNote) return;
  const tags = document.getElementById('noteTags').value
    .split(',').map((t) => t.trim()).filter(Boolean);
  const payload = {
    title: document.getElementById('noteTitle').value,
    content: quill.root.innerHTML,
    notebook_id: document.getElementById('noteNotebook').value || null,
    tags,
  };
  try {
    const updated = await api('PUT', '/api/notes/' + state.currentNote.id, payload);
    state.currentNote = updated;
    document.getElementById('saveStatus').textContent = '✓ 저장됨';
    await loadNotes();
    await loadSidebar();
  } catch (e) {
    document.getElementById('saveStatus').textContent = '저장 실패: ' + e.message;
  }
}

// --------------------------- 삭제 -----------------------------
async function deleteCurrentNote() {
  if (!state.currentNote) return;
  if (!confirm('이 노트를 삭제할까요?')) return;
  await api('DELETE', '/api/notes/' + state.currentNote.id);
  state.currentNote = null;
  document.getElementById('editorWrap').classList.add('hidden');
  document.getElementById('editorEmpty').classList.remove('hidden');
  await loadNotes();
  await loadSidebar();
}

async function addNotebook() {
  const name = prompt('새 노트북 이름:');
  if (!name || !name.trim()) return;
  await api('POST', '/api/notebooks', { name: name.trim() });
  await loadSidebar();
}

async function deleteNotebook(nb) {
  if (!confirm(`노트북 "${nb.name}"을(를) 삭제할까요? (노트는 유지됩니다)`)) return;
  await api('DELETE', '/api/notebooks/' + nb.id);
  if (state.filter.type === 'notebook' && state.filter.id === nb.id) {
    setFilter('all', null, '모든 노트');
  } else {
    await loadSidebar();
  }
}

// --------------------------- 유틸 -----------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}
let searchTimer = null;

// --------------------------- 이벤트 ---------------------------
function bindEvents() {
  document.getElementById('newNoteBtn').onclick = newNote;
  document.getElementById('addNotebookBtn').onclick = addNotebook;
  document.getElementById('deleteNoteBtn').onclick = deleteCurrentNote;
  document.querySelector('[data-filter="all"]').onclick = (e) => {
    e.preventDefault(); setFilter('all', null, '모든 노트');
  };
  document.getElementById('noteTitle').addEventListener('input', scheduleSave);
  document.getElementById('noteTags').addEventListener('input', scheduleSave);
  document.getElementById('noteNotebook').addEventListener('change', saveNote);
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadNotes, 300);
  });
}

// --------------------------- 시작 -----------------------------
(async function main() {
  initEditor();
  bindEvents();
  await loadSidebar();
  await loadNotes();
})();
