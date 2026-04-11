/** Think Tank Dashboard - app.js */
const esc = (t) => t ? String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])) : '';
const refreshIcons = () => { if (typeof lucide !== 'undefined') lucide.createIcons(); };
const CLASSIFY_ICONS = { ideas: '💡', domains: '📚', journal: '📝', todo: '📌' };
const CLASSIFY_LABELS = { ideas: '아이디어', domains: '도메인', journal: '회고', todo: '할일' };
// 파일명 → 읽기 좋은 제목 (날짜/시간/태그 제거)
function cleanTitle(filename) {
    let name = filename.replace(/\.md$/i, '');
    // 날짜+시간 제거: "2026-04-05_0339_주제" → "주제"
    name = name.replace(/^\d{4}[-.]?\d{2}[-.]?\d{2}[_\s-]?\d{0,4}[_\s-]?/, '');
    // 마크다운 볼드 제거
    name = name.replace(/\*\*/g, '');
    // 쉼표로 된 태그 → 첫 번째 의미 있는 것만 (또는 전체를 · 로 구분)
    if (name.includes(',')) name = name.split(',').filter(s => s.trim()).join(' · ');
    // 언더스코어/하이픈 정리
    name = name.replace(/[-_]/g, ' ').trim();
    return name || filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
}
const GITHUB_REPO = 'iopoio/think-tank-inbox';
const STATE = {
    theme: localStorage.getItem('theme') || 'light',
    activeTab: 'inbox',
    inbox: [],
    ideas: [],
    domains: [],
    loaded: {},  // 탭별 로드 완료 플래그 (캐싱)
    reminders: [
        { text: '수요일 3시: Inbox 리뷰', icon: '📅', time: '매주 수 15:00' },
        { text: '목요일 저녁: 주간 회고', icon: '📝', time: '매주 목 20:00' },
        { text: '격주 월요일 3시: Domains 점검', icon: '📚', time: '격주 월 15:00' },
    ]
};

// GitHub API
const ghApi = {
    token: localStorage.getItem('gh_token') || (typeof CONFIG !== 'undefined' && CONFIG.GITHUB_TOKEN) || null,

    headers() {
        return { 'Authorization': `Bearer ${this.token}`, 'Accept': 'application/vnd.github.v3+json' };
    },

    async get(url) {
        const res = await fetch(url, { headers: this.headers() });
        if (!res.ok) throw new Error(`API ${res.status}`);
        return res.json();
    },

    async put(url, body) {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        return res.json();
    },

    async delete(url, sha) {
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: '[dashboard] 삭제', sha }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        return res.json();
    },

    repoUrl(path = '') {
        const encoded = path.split('/').map(p => encodeURIComponent(p)).join('/');
        return `https://api.github.com/repos/${GITHUB_REPO}/contents/${encoded}`;
    },

    isConnected() { return !!this.token; }
};

// 읽음 상태 관리
const readStatus = {
    _key: 'tt_read_items',
    _data: null,

    getData() {
        if (!this._data) {
            const raw = JSON.parse(localStorage.getItem(this._key) || '{}');
            for (const k in raw) {
                if (typeof raw[k] === 'string') raw[k] = { status: 'done', date: raw[k] };
            }
            this._data = raw;
        }
        return this._data;
    },

    _save() { localStorage.setItem(this._key, JSON.stringify(this._data)); },
    getStatus(path) { const d = this.getData()[path]; return d ? d.status : null; },
    isRead(path) { return !!this.getData()[path]; },

    markRead(path) {
        const d = this.getData();
        if (!d[path]) d[path] = { status: 'read', date: new Date().toISOString() };
        this._save();
    },
    markLater(path) { this.getData()[path] = { status: 'later', date: new Date().toISOString() }; this._save(); },
    markDone(path) { this.getData()[path] = { status: 'done', date: new Date().toISOString() }; this._save(); },
    unmark(path) { delete this.getData()[path]; this._save(); },

    countUnread(paths) { return paths.filter(p => !this.isRead(p)).length; },
    countByStatus(paths, s) { return paths.filter(p => this.getStatus(p) === s).length; },
};

// 할일 (Todo)
const todos = {
    items: JSON.parse(localStorage.getItem('tt_todos') || '[]'),
    filter: 'all',

    save() { localStorage.setItem('tt_todos', JSON.stringify(this.items)); },

    add() {
        const input = document.getElementById('todo-input');
        const text = input.value.trim();
        if (!text) return;
        this.items.unshift({ id: Date.now(), text, done: false, createdAt: new Date().toISOString() });
        this.save(); this.render();
        input.value = ''; input.focus();
    },

    toggle(id) {
        const item = this.items.find(t => t.id === id);
        if (item) { item.done = !item.done; if (item.done) item.doneAt = new Date().toISOString(); this.save(); this.render(); }
    },

    remove(id) { this.items = this.items.filter(t => t.id !== id); this.save(); this.render(); },

    setFilter(f) {
        this.filter = f;
        document.querySelectorAll('.todo-filter').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.trim() === { all: '전체', pending: '미완료', done: '완료' }[f]);
        });
        this.render();
    },

    updateBadge() {
        const count = this.items.filter(t => !t.done).length;
        ['todo-badge', 'todo-badge-mobile'].forEach(id => {
            const b = document.getElementById(id);
            if (!b) return;
            b.textContent = count;
            b.classList.toggle('hidden', count === 0);
        });
    },

    render() {
        const list = document.getElementById('todo-list');
        if (!list) return;
        const filtered = this.filter === 'pending' ? this.items.filter(t => !t.done)
                       : this.filter === 'done' ? this.items.filter(t => t.done) : this.items;
        this.updateBadge();

        if (filtered.length === 0) {
            const msg = this.filter === 'done' ? '완료된 할일이 없습니다.' : this.filter === 'pending' ? '모두 완료했습니다!' : '할일을 추가해보세요.';
            list.innerHTML = `<div class="card text-center text-gray-500 py-12">${msg}</div>`;
            return;
        }

        const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        const fmt = (iso) => { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}`; };

        list.innerHTML = filtered.map(t => `
            <div class="card flex items-center gap-4 group ${t.done ? 'opacity-60' : ''}">
                <button onclick="todos.toggle(${t.id})" class="w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${t.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-indigo-500'}">${t.done ? '✓' : ''}</button>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium ${t.done ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-100'}">${esc(t.text)}</p>
                    <p class="text-xs text-gray-400 mt-1">${fmt(t.createdAt)}에 추가${t.done && t.doneAt ? ' · ' + fmt(t.doneAt) + '에 완료' : ''}</p>
                </div>
                <button onclick="todos.remove(${t.id})" class="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all" title="삭제">✕</button>
            </div>
        `).join('');
    },
};

// ============================================================
// 5. 데이터 파싱 (frontmatter, 확신도, 자동 분류)
// ============================================================
function parseFrontmatter(text) {
    const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};
    const meta = {};
    match[1].split('\n').forEach(line => {
        const m = line.match(/^(\w+):\s*(.+)/);
        if (m) {
            let val = m[2].trim();
            if (val.startsWith('[') && val.endsWith(']')) val = val.slice(1, -1).split(',').map(s => s.trim());
            meta[m[1]] = val;
        }
    });
    return meta;
}

function parseConfidence(text) {
    const g = (text.match(/🟢/g) || []).length, y = (text.match(/🟡/g) || []).length, r = (text.match(/🔴/g) || []).length;
    return (g + y + r === 0) ? null : { green: g, yellow: y, red: r, total: g - r };
}
function confidenceBadge(conf) {
    if (!conf) return '';
    const color = conf.total >= 3 ? 'text-emerald-500' : conf.total >= 1 ? 'text-amber-500' : 'text-red-500';
    return `<span class="text-[10px] font-bold ${color}">확신도 ${conf.total}점</span>`;
}
function classifyItem(meta, content) {
    const tags = [].concat(meta.tags || []), text = content.toLowerCase(), nm = (meta._filename || '').toLowerCase();
    if (tags.some(t => /아이디어|idea|구상/.test(t.toLowerCase())) || /idea|아이디어/.test(nm)) return { target: 'ideas', reason: '태그/파일명' };
    if (tags.some(t => /회고|일기|journal|review/.test(t.toLowerCase())) || /회고|journal/.test(nm)) return { target: 'journal', reason: '태그/파일명' };
    if (/AI|ai|투자|효율화|인테리어|기타/.test(tags[0])) return { target: 'domains', subfolder: tags[0], reason: '태그' };
    if (/해야|할일|예정|todo|공모전/.test(text)) return { target: 'todo', reason: '키워드' };
    return { target: 'domains', subfolder: tags[0] || '미분류', reason: '기본값' };
}
const simpleMarkdown = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-4 mb-1">$1</h3>').replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-1">$1</h2>').replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-2">$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>').replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');

// ============================================================
// 6. 공통 UI 컴포넌트 (모달, 카드, 상태 표시)
// ============================================================
function initModal() {
    const modal = document.getElementById('content-modal');
    document.getElementById('close-modal').addEventListener('click', () => { modal.style.display = 'none'; document.body.classList.remove('modal-open'); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.style.display = 'none'; document.body.classList.remove('modal-open'); } });
}

function openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('content-modal').style.display = 'flex';
    document.body.classList.add('modal-open');
}

function closeModal() {
    document.getElementById('content-modal').style.display = 'none';
    document.body.classList.remove('modal-open');
}

function statusIndicator(path) {
    const s = readStatus.getStatus(path);
    if (s === 'done') return { icon: '✓', color: 'text-emerald-500', label: '완료', opacity: 'opacity-50', sort: 2 };
    if (s === 'later') return { icon: '⏳', color: 'text-blue-500', label: '나중으로', opacity: '', sort: 1 };
    if (s === 'read') return { icon: '○', color: 'text-gray-400', label: '읽음', opacity: '', sort: 1 };
    return { icon: '●', color: 'text-amber-500', label: '안읽음', opacity: '', sort: 0 };
}

function renderItemCard(item, path, title) {
    const st = statusIndicator(path);
    const safeUrl = encodeURIComponent(item.url);
    const safePath = encodeURIComponent(path);
    const safeTitle = encodeURIComponent(title);
    return `
    <div class="card cursor-pointer transition-all ${st.opacity}" onclick="openItemViewerSafe('${safeUrl}', '${safePath}', '${safeTitle}')">
        <div class="flex items-center gap-3">
            <span class="${st.color} text-sm">${st.icon}</span>
            <div class="flex-1 min-w-0">
                <h4 class="font-bold text-sm truncate">${title}</h4>
                <p class="text-[10px] ${st.color}">${st.label}</p>
            </div>
        </div>
    </div>`;
}

function openItemViewerSafe(encodedUrl, encodedPath, encodedTitle) {
    openItemViewer(decodeURIComponent(encodedUrl), decodeURIComponent(encodedPath), decodeURIComponent(encodedTitle));
}

function renderSortedItems(items, section, prefix) {
    const mapped = items.map(item => {
        const path = prefix ? `${prefix}/${item.name}` : `${section}/${item.name}`;
        const title = cleanTitle(item.name);
        return { item, path, title, st: statusIndicator(path) };
    });
    mapped.sort((a, b) => a.st.sort - b.st.sort);
    return mapped.map(m => renderItemCard(m.item, m.path, m.title)).join('');
}

function statusSummary(items, prefix) {
    const paths = items.map(f => `${prefix}/${f.name}`);
    const parts = [];
    const unread = readStatus.countUnread(paths);
    const later = readStatus.countByStatus(paths, 'later');
    const done = readStatus.countByStatus(paths, 'done');
    if (unread > 0) parts.push(`<span class="text-amber-500">${unread} 안읽음</span>`);
    if (later > 0) parts.push(`<span class="text-blue-500">${later} 나중으로</span>`);
    if (done > 0) parts.push(`<span class="text-emerald-500">${done} 완료</span>`);
    return parts.length > 0 ? `<p class="text-xs font-bold mb-4">${parts.join(' · ')}</p>` : '';
}

// ============================================================
// 7. 아이템 뷰어 + 액션
// ============================================================
async function openItemViewer(url, path, title) {
    openModal(title, '<div class="text-center text-gray-500 py-8">불러오는 중...</div>');
    try {
        const fileData = await ghApi.get(url);
        const raw = atob(fileData.content);
        const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
        readStatus.markRead(path);
        const actions = `
            <div class="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">액션</p>
                <div class="flex gap-2 flex-wrap">
                    <button onclick="itemAction('done', '${path}', '${encodeURIComponent(title)}')" class="sort-btn text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20">✅ 완료</button>
                    <button onclick="itemAction('develop', '${path}', '${encodeURIComponent(title)}')" class="sort-btn text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20">🚀 발전시키기</button>
                    <button onclick="itemAction('later', '${path}', '${encodeURIComponent(title)}')" class="sort-btn text-blue-600 bg-blue-50 dark:bg-blue-900/20">⏳ 나중으로</button>
                    <button onclick="itemAction('delete', '${path}', '${encodeURIComponent(title)}')" class="sort-btn text-red-500 bg-red-50 dark:bg-red-900/20">🗑️ 삭제</button>
                </div>
            </div>`;
        openModal(title, simpleMarkdown(decoded) + actions);
        refreshCurrentTab();
    } catch (e) {
        openModal(title, '<div class="text-center text-red-400 py-8">로드 실패</div>');
    }
}

async function itemAction(action, path, encodedTitle) {
    const title = decodeURIComponent(encodedTitle);
    if (action === 'done') {
        readStatus.markDone(path);
    } else if (action === 'develop') {
        const note = prompt(`"${title}" 발전시키기\n\n추가할 메모나 아이디어를 적어주세요:`);
        if (note === null) return;
        todos.items.unshift({ id: Date.now(), text: `🚀 ${title}: ${note || '발전시키기'}`, done: false, createdAt: new Date().toISOString() });
        todos.save(); todos.updateBadge();
        readStatus.markDone(path);
    } else if (action === 'later') {
        readStatus.markLater(path);
    } else if (action === 'delete') {
        if (!confirm(`"${title}"을(를) 삭제하시겠습니까?`)) return;
        try {
            const fileData = await ghApi.get(ghApi.repoUrl(path));
            await ghApi.delete(ghApi.repoUrl(path), fileData.sha);
            closeModal(); refreshCurrentTab();
        } catch (e) { alert('삭제 실패: ' + e.message); }
        return;
    }
    closeModal(); refreshCurrentTab();
}

function refreshCurrentTab() {
    const tab = STATE.activeTab;
    if (tab === 'ideas') loadIdeasFromGitHub(true);
    else if (tab === 'domains') loadDomainsFromGitHub(true);
    else if (tab === 'journal') loadJournalFromGitHub(true);
    else if (tab === 'inbox') loadInboxFromGitHub();
    updateStats();
}

// ============================================================
// 8. Inbox (자동 분류 + 전체 실행)
// ============================================================
async function loadInboxFromGitHub() {
    const list = document.getElementById('inbox-list');
    list.innerHTML = '<div class="card animate-pulse h-32"></div><div class="card animate-pulse h-32"></div>';
    try {
        const files = await ghApi.get(ghApi.repoUrl('inbox/'));
        const items = files.filter(f => f.type === 'file').sort((a, b) => b.name.localeCompare(a.name));
        const enriched = await Promise.all(items.map(async (item) => {
            try {
                const fileData = await ghApi.get(item.url);
                const raw = atob(fileData.content);
                const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
                const meta = parseFrontmatter(decoded); meta._filename = item.name;
                return { ...item, fileData, decoded, meta, classification: classifyItem(meta, decoded), confidence: parseConfidence(decoded) };
            } catch { return { ...item, fileData: null, decoded: '', meta: {}, classification: { target: 'domains', subfolder: '미분류', reason: '로드 실패' } }; }
        }));
        STATE.inbox = enriched;
        updateInboxBadge(enriched.length);
        renderInboxList();
    } catch (e) {
        list.innerHTML = '<div class="card text-center text-gray-500 py-12">inbox/ 폴더를 찾을 수 없습니다.</div>';
    }
}

function updateInboxBadge(count) {
    ['inbox-badge', 'inbox-badge-mobile'].forEach(id => {
        const b = document.getElementById(id); if (!b) return;
        b.textContent = count; b.classList.toggle('hidden', count === 0);
    });
}

function renderInboxCard(item, i) {
    const c = item.classification;
    const icon = CLASSIFY_ICONS[c.target] || '📄';
    const label = CLASSIFY_LABELS[c.target] || c.target;
    const sub = c.subfolder ? ` / ${c.subfolder}` : '';
    const title = cleanTitle(item.name);
    const confHtml = confidenceBadge(item.confidence);
    const colorClass = c.target === 'ideas' ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' : c.target === 'journal' ? 'text-violet-600 bg-violet-50 dark:bg-violet-900/20' : c.target === 'todo' ? 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' : 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20';
    return `
    <div class="card cursor-pointer hover:bg-indigo-50/10 active:scale-[0.99] transition-all" onclick="openInboxItem(${i})">
        <div class="flex items-center justify-between mb-2">
            <h4 class="font-bold text-gray-800 dark:text-gray-100 text-sm flex-1 truncate mr-2">${title}</h4>
            ${confHtml}
        </div>
        <div class="flex items-center justify-between mb-3">
            <span class="sort-btn ${colorClass}">${icon} ${label}${sub}</span>
            <span class="text-[10px] text-gray-400">${c.reason}</span>
        </div>
        <div class="flex gap-1.5 flex-wrap">
            <button onclick="event.stopPropagation(); reclassify(${i}, 'ideas')" class="text-[10px] px-2 py-1 rounded-lg ${c.target === 'ideas' ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}">💡</button>
            <button onclick="event.stopPropagation(); reclassify(${i}, 'domains')" class="text-[10px] px-2 py-1 rounded-lg ${c.target === 'domains' ? 'bg-indigo-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}">📚</button>
            <button onclick="event.stopPropagation(); reclassify(${i}, 'journal')" class="text-[10px] px-2 py-1 rounded-lg ${c.target === 'journal' ? 'bg-violet-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}">📝</button>
            <button onclick="event.stopPropagation(); reclassify(${i}, 'todo')" class="text-[10px] px-2 py-1 rounded-lg ${c.target === 'todo' ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}">📌</button>
            <button onclick="event.stopPropagation(); reclassify(${i}, 'pass')" class="text-[10px] px-2 py-1 rounded-lg text-gray-400 bg-gray-100 dark:bg-gray-800">✕</button>
        </div>
    </div>`;
}

function renderInboxList() {
    const enriched = STATE.inbox;
    const list = document.getElementById('inbox-list');
    if (!enriched || enriched.length === 0) {
        list.innerHTML = '<div class="card text-center text-gray-500 py-12">🎉 Inbox가 비어있습니다!</div>';
        return;
    }
    let html = `<div class="flex items-center justify-between mb-4">
        <p class="text-sm text-gray-500">${enriched.length}개 항목 자동 분류됨</p>
        <button onclick="executeAllClassify()" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-all">전체 분류 실행</button>
    </div>`;
    html += enriched.map((item, i) => renderInboxCard(item, i)).join('');
    list.innerHTML = html;
}

function reclassify(index, newTarget) {
    const item = STATE.inbox[index]; if (!item) return;
    item.classification = { target: newTarget, reason: '수동 변경' };
    if (newTarget === 'domains' && item.meta && item.meta.tags) {
        const tags = Array.isArray(item.meta.tags) ? item.meta.tags : [item.meta.tags];
        if (tags.length > 0) item.classification.subfolder = tags[0];
    }
    renderInboxList();
}

// 도메인 서브폴더 목록 (Think 공식 태그)
const DOMAIN_SUBS = ['AI', '투자', '효율화', '인테리어', '기타'];

async function openInboxItem(index) {
    const item = STATE.inbox[index]; if (!item) return;
    STATE._reviewIndex = index; // 리뷰 모드용 현재 인덱스
    const c = item.classification;
    const icon = CLASSIFY_ICONS[c.target] || '📄';
    const label = CLASSIFY_LABELS[c.target] || c.target;
    const sub = c.subfolder ? ` / ${c.subfolder}` : '';
    const total = STATE.inbox.length;
    const confHtml = confidenceBadge(item.confidence);

    // 네비게이션 (리뷰 모드)
    const nav = `<div class="flex items-center justify-between mb-4">
        <button onclick="reviewNav(-1)" class="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 ${index === 0 ? 'opacity-30 pointer-events-none' : ''}">← 이전</button>
        <span class="text-xs text-gray-400">${index + 1} / ${total}</span>
        <button onclick="reviewNav(1)" class="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 ${index >= total - 1 ? 'opacity-30 pointer-events-none' : ''}">다음 →</button>
    </div>`;

    // 자동 분류 정보
    const info = `<div class="mb-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
        <div class="flex items-center justify-between">
            <span class="text-sm font-bold">${icon} ${label}${sub}</span>
            <span class="text-[10px] text-gray-400">${c.reason}</span>
        </div>
        ${confHtml ? '<div class="mt-2">' + confHtml + '</div>' : ''}
    </div>`;

    // 내용
    const content = simpleMarkdown(item.decoded || '');

    // 액션 버튼 (개별 리뷰)
    const domainBtns = DOMAIN_SUBS.map(d =>
        `<button onclick="inboxItemAction('domains', ${index}, '${d}')" class="sort-btn text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20">📚 ${d}</button>`
    ).join('');

    const actions = `
        <div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">분류하기</p>
            <div class="flex gap-2 flex-wrap mb-3">
                <button onclick="inboxItemAction('ideas', ${index})" class="sort-btn text-amber-600 bg-amber-50 dark:bg-amber-900/20">💡 아이디어</button>
                ${domainBtns}
            </div>
            <div class="flex gap-2 flex-wrap">
                <button onclick="inboxItemAction('journal', ${index})" class="sort-btn text-violet-600 bg-violet-50 dark:bg-violet-900/20">📝 회고</button>
                <button onclick="inboxItemAction('todo', ${index})" class="sort-btn text-orange-600 bg-orange-50 dark:bg-orange-900/20">📌 할일</button>
                <button onclick="inboxItemAction('pass', ${index})" class="sort-btn text-gray-500 bg-gray-100 dark:bg-gray-800">⏭️ 패스</button>
                <button onclick="inboxItemAction('later', ${index})" class="sort-btn text-blue-600 bg-blue-50 dark:bg-blue-900/20">⏳ 나중에</button>
            </div>
        </div>`;

    openModal(cleanTitle(item.name), nav + info + content + actions);
}

// 리뷰 모드 네비게이션
function reviewNav(dir) {
    const next = (STATE._reviewIndex || 0) + dir;
    if (next >= 0 && next < STATE.inbox.length) openInboxItem(next);
}

// 개별 아이템 액션 (모달에서 분류)
async function inboxItemAction(target, index, subfolder) {
    const item = STATE.inbox[index];
    if (!item || !item.fileData) return;

    try {
        if (target === 'later') {
            // 나중에 — 그냥 다음 글로 넘어감
            const next = index + 1;
            if (next < STATE.inbox.length) { openInboxItem(next); }
            else { closeModal(); }
            return;
        }

        // 최신 SHA 재조회 (409 Conflict 방지)
        const fresh = await ghApi.get(ghApi.repoUrl(`inbox/${item.name}`));
        const sha = fresh.sha;
        const content = fresh.content;

        if (target === 'todo') {
            todos.items.unshift({ id: Date.now(), text: cleanTitle(item.name), done: false, createdAt: new Date().toISOString() });
            todos.save(); todos.updateBadge();
            await ghApi.delete(ghApi.repoUrl(`inbox/${item.name}`), sha);
        } else if (target === 'pass') {
            await ghApi.delete(ghApi.repoUrl(`inbox/${item.name}`), sha);
        } else {
            const folder = subfolder ? `${target}/${subfolder}` : target;
            // 대상 파일이 이미 있으면 SHA 포함해서 덮어쓰기
            let existingSha = null;
            try {
                const existing = await ghApi.get(ghApi.repoUrl(`${folder}/${item.name}`));
                existingSha = existing.sha;
            } catch { /* 없으면 새로 생성 */ }

            const putBody = {
                message: `[dashboard] 리뷰 분류: ${item.name} → ${folder}/`,
                content: content,
            };
            if (existingSha) putBody.sha = existingSha;
            await ghApi.put(ghApi.repoUrl(`${folder}/${item.name}`), putBody);
            await ghApi.delete(ghApi.repoUrl(`inbox/${item.name}`), sha);
        }

        // 처리 완료 → 목록에서 제거 + 다음 글로 자동 이동
        STATE.inbox.splice(index, 1);
        updateInboxBadge(STATE.inbox.length);
        renderInboxList();

        if (STATE.inbox.length === 0) {
            closeModal();
            renderInboxList(); // 빈 상태 표시
        } else {
            const nextIdx = Math.min(index, STATE.inbox.length - 1);
            openInboxItem(nextIdx);
        }
    } catch (e) {
        alert('처리 실패: ' + e.message);
    }
}

async function executeAllClassify() {
    const items = STATE.inbox.filter(item => item.fileData); if (items.length === 0) return;
    if (!confirm(`${items.length}개 항목을 분류하시겠습니까?`)) return;
    let success = 0;
    for (const item of items) {
        try {
            const c = item.classification, folder = c.subfolder ? `${c.target}/${c.subfolder}` : c.target;
            if (c.target === 'todo') { todos.items.unshift({ id: Date.now() + Math.random(), text: cleanTitle(item.name), done: false, createdAt: new Date().toISOString() }); todos.save(); }
            else if (c.target !== 'pass') await ghApi.put(ghApi.repoUrl(`${folder}/${item.name}`), { message: `자동 분류: ${item.name}`, content: item.fileData.content });
            await ghApi.delete(ghApi.repoUrl(`inbox/${item.name}`), item.fileData.sha);
            success++;
        } catch (e) { console.error(e); }
    }
    todos.updateBadge(); alert(`${success}건 분류 완료`); await loadInboxFromGitHub();
}

// ============================================================
// 9. Ideas / Domains / Journal 로드
// ============================================================
async function loadIdeasFromGitHub(force = false) {
    if (!force && STATE.loaded.ideas) return;
    const list = el('ideas-list');
    list.innerHTML = '<div class="card animate-pulse h-24"></div>';
    try {
        const files = await ghApi.get(ghApi.repoUrl('ideas/'));
        const items = files.filter(f => f.type === 'file' && f.name.endsWith('.md'));
        STATE.ideas = items;
        list.innerHTML = statusSummary(items, 'ideas') + renderSortedItems(items, 'ideas');
        STATE.loaded.ideas = true;
        await dnaView.load(); // 미리 로드
    } catch (e) { list.innerHTML = '<div class="card text-center py-12">ideas/ 로드 실패</div>'; }
}

window.switchSubTab = (subId) => {
    document.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b.id === `subtab-${subId}`));
    document.querySelectorAll('.subtab-content').forEach(c => c.classList.toggle('hidden', !c.id.includes(subId)));
    if (subId === 'cluster') dnaView.render();
};

const dnaView = {
    data: null, idMap: {}, themeGroups: {},
    async load() {
        try {
            const f = await ghApi.get(ghApi.repoUrl('ideas/아이디어_DNA_인덱스.json'));
            const res = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(f.content), c => c.charCodeAt(0))));
            this.data = res; this.idMap = res.ideas.reduce((acc, i) => { acc[i.id] = i; return acc; }, {});
            this.themeGroups = res.ideas.reduce((acc, i) => { if (!acc[i.theme]) acc[i.theme] = []; acc[i.theme].push(i); return acc; }, {});
        } catch (e) { console.error('DNA JSON 로드 실패'); }
    },
    render() {
        const cont = el('cluster-container'); if (!this.data) { cont.innerHTML = '<p class="p-8 text-center text-gray-500">로딩 중...</p>'; return; }
        cont.innerHTML = this.data.themes.map(t => {
            const items = this.themeGroups[t.id] || [];
            return `
            <div id="group-${t.id}" class="cluster-group">
                <div class="theme-header" style="border-color: ${t.color}20" onclick="this.nextElementSibling.classList.toggle('hidden'); dnaView.drawLines();">
                    <div class="flex items-center gap-3">
                        <span class="theme-badge">${esc(t.name)}</span>
                        <span class="text-xs text-on-variant/40 font-bold">${items.length}개</span>
                    </div>
                    <span class="text-on-variant/30">▾</span>
                </div>
                <div class="hidden p-4 relative">
                    <svg id="svg-${t.id}" class="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-visible"></svg>
                    <div class="cluster-cards-container relative z-10 py-4">${this.renderClusterCards(items, t.id)}</div>
                </div>
            </div>`;
        }).join('');
        setTimeout(() => { this.drawLines(); refreshIcons(); }, 100);
    },
    renderClusterCards(items, theme) {
        return items.map(i => {
            const statusLabels = { active: '🔥 진행중', done: '✅ 완료', archived: '💤 잠자는', sleeping: '💤 잠자는', completed: '✅ 완료' };
            const statusClass = `status-${i.status}`;
            const keywords = (i.keywords || []).map(k => `<span class="keyword-tag">#${esc(k)}</span>`).join(' ');
            let ddayHtml = '', urgentClass = '';
            if (i.deadline) {
                const diff = Math.ceil((new Date(i.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                const ddayText = diff === 0 ? 'D-Day' : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
                if (diff <= 7) urgentClass = 'urgent';
                ddayHtml = `<span class="status-badge bg-red-50 text-red-600 dark:bg-red-900/30 ml-auto">${ddayText}</span>`;
            }
            const onClick = (i.detail_path && i.detail_path !== 'None') ? `onclick="window.open('https://github.com/iopoio/think-tank-inbox/blob/main/${encodeURI(i.detail_path)}', '_blank')"` : '';
            return `<div id="card-${i.id}" class="cluster-card ${urgentClass} cursor-pointer" ${onClick}>
                <span class="status-badge ${statusClass} mb-2 inline-block">${statusLabels[i.status] || esc(i.status)}</span>
                <h4 class="font-bold text-[11px] text-on-surface leading-snug mb-1.5">${esc(i.name)}</h4>
                <p class="text-[8px] text-on-variant/40 mb-1">${esc(i.year) || ''}</p>
                <div class="flex flex-wrap gap-0.5 overflow-hidden max-h-8">${keywords}</div>
                ${ddayHtml ? '<div class="mt-1.5">' + ddayHtml + '</div>' : ''}
            </div>`;
        }).join('');
    },
    drawLines() {
        if (window.innerWidth < 768) return;
        this.data.themes.forEach(t => {
            const svg = el(`svg-${t.id}`); if (!svg) return;
            const container = svg.parentElement; if (container.classList.contains('hidden')) return;
            svg.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="cluster-arrow"/></marker></defs>';
            (this.themeGroups[t.id] || []).forEach(i => {
                const s = el(`card-${i.id}`); if (!s || !i.connections) return;
                i.connections.filter(cid => cid !== '-').forEach(cid => {
                    const e = el(`card-${cid}`); if (!e) return;
                    const sr = s.getBoundingClientRect(), er = e.getBoundingClientRect(), cr = container.getBoundingClientRect();
                    const x1 = sr.right - cr.left, y1 = sr.top + sr.height / 2 - cr.top;
                    const x2 = er.left - cr.left, y2 = er.top + er.height / 2 - cr.top;
                    svg.innerHTML += `<path d="M ${x1} ${y1} L ${x2} ${y2}" class="cluster-line" marker-end="url(#arrow)"/>`;
                });
            });
        });
    }
};

async function loadDomainsFromGitHub(force = false) {
    if (!force && STATE.loaded.domains) return;
    const container = document.getElementById('domains-grid');
    container.innerHTML = '<div class="card animate-pulse h-32 col-span-full"></div>';
    const icons = { 'AI': 'cpu', '투자': 'trending-up', '효율화': 'zap', '인테리어': 'home', '기타': 'archive', '미분류': 'file-text' };
    const colors = { 'AI': 'from-indigo-400 to-indigo-600', '투자': 'from-amber-400 to-orange-500', '효율화': 'from-emerald-400 to-teal-600', '인테리어': 'from-pink-400 to-rose-500', '기타': 'from-gray-400 to-gray-500' };
    try {
        const folders = await ghApi.get(ghApi.repoUrl('domains/'));
        let html = '';
        STATE.domains = [];
        for (const folder of folders) {
            if (folder.type !== 'dir') continue;
            const icon = icons[folder.name] || '📁';
            const color = colors[folder.name] || 'from-violet-400 to-purple-600';
            try {
                const files = await ghApi.get(folder.url);
                const items = files.filter(f => f.type === 'file');
                const prefix = `domains/${folder.name}`;
                STATE.domains.push(...items.map(i => ({ ...i, path: `${prefix}/${i.name}` })));
                html += `<div class="col-span-full"><div class="flex items-center gap-3 mb-3 mt-6">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-r ${color} flex items-center justify-center text-white"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
                    <div><h3 class="font-extrabold text-lg font-display">${folder.name}</h3>${statusSummary(items, prefix)}</div>
                </div></div>`;
                html += items.length === 0 ? '<div class="col-span-full text-sm text-gray-500 pl-14 mb-4">비어있음</div>' : renderSortedItems(items, 'domains', prefix);
            } catch { /* 빈 폴더 무시 */ }
        }
        container.innerHTML = html || '<div class="card text-center text-gray-500 py-12 col-span-full">도메인이 없습니다.</div>';
        STATE.loaded.domains = true; refreshIcons();
    } catch (e) { container.innerHTML = '<div class="card text-center text-gray-500 py-12 col-span-full">domains/ 폴더를 찾을 수 없습니다.</div>'; }
}

async function loadJournalFromGitHub(force = false) {
    if (!force && STATE.loaded.journal) return;
    const list = document.getElementById('journal-list');
    list.innerHTML = '<div class="card animate-pulse h-24"></div>';
    try {
        const files = await ghApi.get(ghApi.repoUrl('journal/'));
        const items = files.filter(f => f.type === 'file').reverse();
        if (items.length === 0) { list.innerHTML = '<div class="card text-center text-gray-500 py-12">회고가 없습니다.</div>'; return; }
        list.innerHTML = statusSummary(items, 'journal') + renderSortedItems(items, 'journal');
        STATE.loaded.journal = true;
    } catch (e) { list.innerHTML = '<div class="card text-center text-gray-500 py-12">journal/ 폴더를 찾을 수 없습니다.</div>'; }
}

// 초기화
async function hashPin(pin) {
    const data = new TextEncoder().encode(pin + '_thinktank_salt');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function initLock() {
    const lockScreen = document.getElementById('lock-screen');
    const app = document.getElementById('app');
    const pinInput = document.getElementById('pin-input');
    const pinError = document.getElementById('pin-error');
    const savedHash = localStorage.getItem('tt_pin_hash');

    if (savedHash && sessionStorage.getItem('tt_unlocked') === 'true') { app.style.display = 'flex'; return true; }

    lockScreen.style.display = 'flex';
    pinInput.focus();
    pinInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') { pinError.classList.add('hidden'); return; }
        const pin = pinInput.value.trim();
        if (pin.length < 4) return;
        const hash = await hashPin(pin);
        if (!savedHash) {
            localStorage.setItem('tt_pin_hash', hash);
            sessionStorage.setItem('tt_unlocked', 'true');
            lockScreen.style.display = 'none'; app.style.display = 'flex'; bootApp();
        } else if (hash === savedHash) {
            sessionStorage.setItem('tt_unlocked', 'true');
            lockScreen.style.display = 'none'; app.style.display = 'flex'; bootApp();
        } else {
            pinError.classList.remove('hidden'); pinInput.value = ''; pinInput.focus();
        }
    });
    return false;
}

function initTheme() {
    const icon = document.getElementById('theme-icon');
    const iconM = document.getElementById('theme-icon-mobile');
    const update = () => { const e = STATE.theme === 'dark' ? '☀️' : '🌙'; if (icon) icon.textContent = e; if (iconM) iconM.textContent = e; };
    if (STATE.theme === 'dark') document.documentElement.classList.add('dark');
    update();
    const toggle = () => { STATE.theme = STATE.theme === 'light' ? 'dark' : 'light'; document.documentElement.classList.toggle('dark'); update(); localStorage.setItem('theme', STATE.theme); };
    const t1 = document.getElementById('dark-mode-toggle'), t2 = document.getElementById('dark-mode-toggle-mobile');
    if (t1) t1.addEventListener('click', toggle);
    if (t2) t2.addEventListener('click', toggle);
}

function initTabs() {
    const tabTitles = { inbox: '받은함', ideas: '아이디어', domains: '도메인', journal: '회고', todos: '할일', stats: '통계', generator: '생각 발전소' };
    const tabDescs = { inbox: '새로운 인사이트가 도착했습니다.', ideas: '아이디어를 발전시키세요.', domains: '분야별 지식 베이스.', journal: '주간 회고와 진행 기록.', todos: '해야 할 것들을 모아두세요.', stats: '데이터 기반 성과 지표.', generator: '과거의 생각을 연료로 발전하세요.' };
    window.switchTab = (tabId) => {
        STATE.activeTab = tabId;
        document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tabId));
        document.querySelectorAll('.mobile-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tabId));
        document.querySelectorAll('.tab-pane').forEach(el => el.classList.toggle('hidden', el.id !== `tab-${tabId}`));
        const titleEl = el('tab-title-display'); if (titleEl) titleEl.textContent = tabTitles[tabId] || tabId;
        const descEl = titleEl?.nextElementSibling; if (descEl) descEl.textContent = tabDescs[tabId] || '';
        if (tabId === 'todos') todos.render();
        if (tabId === 'stats') refreshCharts();
        if (tabId === 'generator') generator.run();
    };
}

function githubConnectHandler() {
    if (ghApi.isConnected()) {
        if (confirm('GitHub 연결을 해제하시겠습니까?')) {
            ghApi.token = null; localStorage.removeItem('gh_token'); updateAuthUI();
        }
    } else {
        const token = prompt('GitHub Personal Access Token을 입력하세요.\n\n생성: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens\n권한: think-tank-inbox 리포에 Contents Read/Write');
        if (token && token.trim()) { ghApi.token = token.trim(); localStorage.setItem('gh_token', token.trim()); updateAuthUI(); loadLiveData(); }
    }
}

function initGitHubAuth() {
    updateAuthUI();
    ['connect-github', 'connect-github-mobile'].forEach(id => { const b = document.getElementById(id); if (b) b.addEventListener('click', githubConnectHandler); });
}

function updateAuthUI() {
    ['connect-github', 'connect-github-mobile'].forEach(id => {
        const btn = document.getElementById(id); if (!btn) return;
        if (ghApi.isConnected()) { btn.innerHTML = '<span>✓ 연결됨</span>'; btn.classList.add('!bg-emerald-600', 'dark:!bg-emerald-600', 'dark:!text-white'); }
        else { btn.innerHTML = '<span>GitHub 연결</span>'; btn.classList.remove('!bg-emerald-600', 'dark:!bg-emerald-600', 'dark:!text-white'); }
    });
}

async function loadLiveData() {
    STATE.loaded = {}; // 캐시 초기화
    try { await Promise.all([loadInboxFromGitHub(), loadIdeasFromGitHub(true), loadDomainsFromGitHub(true), loadJournalFromGitHub(true)]); }
    catch (e) { console.error('GitHub 데이터 로드 실패:', e); if (e.message.includes('401')) { alert('토큰이 만료되었거나 잘못되었습니다.'); ghApi.token = null; localStorage.removeItem('gh_token'); updateAuthUI(); } }
}

function initReminders() {
    const el = document.getElementById('reminder-list'); if (!el) return;
    el.innerHTML = STATE.reminders.map(r => `
        <div class="p-4 rounded-2xl bg-gray-50 dark:bg-dark-800 border border-gray-100 dark:border-gray-700/50">
            <div class="flex items-center gap-3 mb-1"><span class="text-lg">${r.icon}</span><p class="text-sm font-bold text-gray-800 dark:text-gray-200">${r.text}</p></div>
            <p class="text-[10px] text-gray-400 ml-7">${r.time}</p>
        </div>`).join('');
}

let categoryChart, weeklyChart;
function initCharts() {
    const ctxC = document.getElementById('category-chart');
    const ctxW = document.getElementById('weekly-chart');
    if (!ctxC || !ctxW) return;
    categoryChart = new Chart(ctxC.getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['AI', '투자', '효율화', '인테리어', '기타'], datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#94a3b8'], borderWidth: 0, hoverOffset: 20 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20, font: { family: 'Inter', size: 12 }, color: '#94a3b8' } } }, cutout: '70%' }
    });
    weeklyChart = new Chart(ctxW.getContext('2d'), {
        type: 'bar',
        data: { labels: ['월', '화', '수', '목', '금', '토', '일'], datasets: [{ label: '인테이크', data: [0, 0, 0, 0, 0, 0, 0], backgroundColor: '#6366f1', borderRadius: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { display: false }, ticks: { color: '#94a3b8' } }, x: { grid: { display: false }, ticks: { color: '#94a3b8' } } }, plugins: { legend: { display: false } } }
    });
}
function refreshCharts() { if (categoryChart) categoryChart.update(); }

function updateStats() {
    const data = readStatus.getData();
    const readCount = Object.keys(data).length;
    const todoCount = todos.items.filter(t => !t.done).length;
    const doneCount = todos.items.filter(t => t.done).length;
    const el = (id) => document.getElementById(id);
    if (el('stat-total-intake')) el('stat-total-intake').textContent = readCount;
    if (el('stat-execution-rate')) { const t = todoCount + doneCount; el('stat-execution-rate').textContent = t > 0 ? Math.round(doneCount / t * 100) + '%' : '0%'; }
}

function initSearch() {
    const input = el('global-search'); if (!input) return;
    input.addEventListener('input', (e) => { if (e.target.value.length > 2) console.log('검색:', e.target.value); });
}

// ============================================================
// 12. 생각 발전소 (Generator) — 3단계: 추첨 + 카드 + 🎲 재추첨
// ============================================================
const generator = {
    // sessionStorage 키
    _seenKey: 'tt_gen_seen',
    _currentKey: 'tt_gen_current',
    _longSeenKey: 'tt_gen_long_seen',  // {path: timestamp} — 7일 쿨다운 (세션 간 유지)
    _WEEK_MS: 7 * 24 * 60 * 60 * 1000,

    // seen 배열: 이번 세션에서 이미 본 경로들
    getSeen() { return JSON.parse(sessionStorage.getItem(this._seenKey) || '[]'); },
    addSeen(path) {
        const seen = this.getSeen();
        if (!seen.includes(path)) { seen.push(path); sessionStorage.setItem(this._seenKey, JSON.stringify(seen)); }
        // 장기 쿨다운 기록: 7일 안에는 다시 등장 안 함
        const longSeen = this.getLongSeen();
        longSeen[path] = Date.now();
        localStorage.setItem(this._longSeenKey, JSON.stringify(longSeen));
    },
    resetSeen() { sessionStorage.removeItem(this._seenKey); sessionStorage.removeItem(this._currentKey); },

    // 장기 쿨다운 조회 (localStorage, 세션 간 유지)
    getLongSeen() { return JSON.parse(localStorage.getItem(this._longSeenKey) || '{}'); },

    // 현재 카드 경로 저장/복원 (세션 내 재진입 시 유지)
    saveCurrent(picked) {
        if (picked) sessionStorage.setItem(this._currentKey, JSON.stringify(picked));
        else sessionStorage.removeItem(this._currentKey);
    },
    loadCurrent() {
        const raw = sessionStorage.getItem(this._currentKey);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
    },

    // 파일명에서 날짜 추출
    parseDate(filename) {
        const m = filename.match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    },

    // 경과일 계산
    daysAgo(date) {
        return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    },

    // 경과일 → 읽기 좋은 텍스트
    daysAgoLabel(days) {
        if (days < 7) return `${days}일 전`;
        if (days < 30) return `${Math.floor(days / 7)}주 전`;
        if (days < 365) return `${Math.floor(days / 30)}개월 전`;
        return `${Math.floor(days / 365)}년 전`;
    },

    // 추첨 풀 구성: 작성 후 7일 이상 + 세션 중복 제외 + 7일 장기 쿨다운
    buildPool() {
        const seen = this.getSeen();
        const longSeen = this.getLongSeen();
        const now = Date.now();
        const pool = [];
        const addItems = (items, section) => {
            for (const item of items) {
                const path = item.path || `${section}/${item.name}`;
                if (seen.includes(path)) continue;
                // 장기 쿨다운: 최근 7일 내에 본 건 제외 (세션 넘어가도 유지)
                if (longSeen[path] && (now - longSeen[path]) < this._WEEK_MS) continue;
                const fileDate = this.parseDate(item.name);
                if (!fileDate) continue;
                const days = this.daysAgo(fileDate);
                // 작성 후 7일 이상 경과한 것만 풀에 포함
                if (days < 7) continue;
                pool.push({ item, path, section, fileDate, days });
            }
        };
        addItems(STATE.ideas, 'ideas');
        addItems(STATE.domains, 'domains');
        return pool;
    },

    // 랜덤 1건 선택
    pick() {
        const pool = this.buildPool();
        if (pool.length === 0) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    },

    // 본문 요약 추출 (frontmatter 이후 첫 2~3줄)
    extractSummary(text) {
        let body = text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
        const lines = body.split('\n').filter(l => l.trim()).slice(0, 3);
        return lines.join('\n');
    },

    // 풀 소진 안내 카드
    renderExhausted() {
        return `<div class="card text-center py-16">
            <div class="text-4xl mb-4">🔋</div>
            <p class="text-lg font-bold text-on-surface dark:text-gray-100 mb-2">모든 연료를 다 썼네요</p>
            <p class="text-sm text-on-surface-variant dark:text-gray-400 mb-6">이번 세션에서 추첨 가능한 카드를 모두 확인했습니다.</p>
            <button onclick="generator.handleReset()" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition-all">🔄 처음부터 다시 보기</button>
        </div>`;
    },

    // 데이터 없음 안내 카드
    renderEmpty() {
        return `<div class="card text-center py-16">
            <div class="text-4xl mb-4">⚡</div>
            <p class="text-lg font-bold text-on-surface dark:text-gray-100 mb-2">오늘은 발전할 연료가 없네요</p>
            <p class="text-sm text-on-surface-variant dark:text-gray-400">30/90/180일 전 아이디어가 쌓이면 여기에 나타납니다.</p>
        </div>`;
    },

    // 카드 HTML 렌더링 (XSS 방지: esc() 전역 함수 사용)
    renderCard(picked) {
        const { item, path, section, days } = picked;
        const title = esc(cleanTitle(item.name));
        const daysLabel = esc(this.daysAgoLabel(days));
        const sectionIcon = section === 'ideas' ? '💡' : '📚';
        const sectionLabel = section === 'ideas' ? '아이디어' : '도메인';
        const isBookmarked = this.isBookmarked(path);
        const bookmarkLabel = isBookmarked ? '📌 북마크됨' : '📌 북마크';
        const bookmarkStyle = isBookmarked
            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700';

        return `<div id="gen-card" class="card p-0 overflow-hidden">
            <div class="bg-gradient-to-r from-indigo-500 to-purple-600 p-6">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-white/70 text-xs font-bold uppercase tracking-widest">${sectionIcon} ${esc(sectionLabel)}</span>
                    <span class="bg-white/20 text-white text-xs px-3 py-1 rounded-full font-bold">🕐 ${daysLabel}</span>
                </div>
                <h3 class="text-white text-xl font-extrabold font-display leading-tight">${title}</h3>
            </div>
            <div id="gen-card-body" class="p-6">
                <div class="animate-pulse space-y-2">
                    <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                </div>
            </div>
            <div class="px-6 pb-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">액션</p>
                <div class="flex gap-2 flex-wrap mb-3">
                    <button onclick="generator.handleAction('revive')" class="gen-action-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-all active:scale-95">🔥 다시 살리기</button>
                    <button onclick="generator.handleAction('bookmark')" class="gen-action-btn px-3 py-1.5 rounded-lg text-xs font-bold ${bookmarkStyle} transition-all active:scale-95">${bookmarkLabel}</button>
                    <button onclick="generator.handleAction('realized')" class="gen-action-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-all active:scale-95">✅ 이미 했음</button>
                    <button onclick="generator.handleAction('archived')" class="gen-action-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all active:scale-95">🗑️ 그만 봄</button>
                </div>
                <div class="flex justify-end">
                    <button onclick="generator.handleReroll()" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 font-bold text-sm hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-all active:scale-95">🎲 다시 추첨</button>
                </div>
            </div>
        </div>`;
    },

    // ── 토스트 알림 ──
    showToast(message, type = 'info') {
        const existing = document.getElementById('gen-toast');
        if (existing) existing.remove();
        const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-indigo-600', warning: 'bg-amber-600' };
        const toast = document.createElement('div');
        toast.id = 'gen-toast';
        toast.className = `fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 ${colors[type] || colors.info} text-white px-5 py-3 rounded-xl shadow-lg text-sm font-bold z-50 transition-all`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    },

    // ── 북마크 관리 (localStorage) ──
    _bookmarkKey: 'tt_gen_bookmarks',
    getBookmarks() { return JSON.parse(localStorage.getItem(this._bookmarkKey) || '[]'); },
    isBookmarked(path) { return this.getBookmarks().includes(path); },
    toggleBookmark(path) {
        const bm = this.getBookmarks();
        const idx = bm.indexOf(path);
        if (idx >= 0) { bm.splice(idx, 1); } else { bm.push(path); }
        localStorage.setItem(this._bookmarkKey, JSON.stringify(bm));
        return idx < 0;
    },

    // ── frontmatter status 수정 ──
    updateFrontmatterStatus(content, newStatus) {
        if (/^status:\s*.+$/m.test(content)) {
            return content.replace(/^status:\s*.+$/m, `status: ${newStatus}`);
        }
        if (/^---\s*$/m.test(content)) {
            return content.replace(/^(---\s*\n[\s\S]*?)(^---)/m, `$1status: ${newStatus}\n$2`);
        }
        return null;
    },

    // ── GitHub API PUT: frontmatter status 전이 ──
    async updateStatusOnGitHub(path, newStatus) {
        const fileData = await ghApi.get(ghApi.repoUrl(path));
        const raw = atob(fileData.content);
        const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
        const updated = this.updateFrontmatterStatus(decoded, newStatus);
        if (updated === null) throw { status: 422, _msg: '파일에 frontmatter가 없습니다.' };
        const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(updated)));
        await ghApi.put(ghApi.repoUrl(path), {
            message: `[발전소] ${cleanTitle(path.split('/').pop())} → ${newStatus}`,
            content: encoded, sha: fileData.sha,
        });
    },

    // ── 에러 메시지 (보안: 원본 API 에러 노출 금지) ──
    friendlyError(err) {
        const msg = err?.message || '';
        if (err?._msg) return err._msg;
        if (msg.includes('401')) return 'GitHub 인증 만료. 재연결해주세요.';
        if (msg.includes('404')) return '파일을 찾을 수 없습니다.';
        if (msg.includes('409')) return '파일이 동시에 수정됐습니다. 다시 시도해주세요.';
        return '처리 중 문제가 발생했습니다.';
    },

    // ── 액션 핸들러 (낙관적 UI 업데이트) ──
    async handleAction(action) {
        const saved = this.loadCurrent();
        if (!saved || !saved.path) return;
        const path = saved.path;

        // 📌 북마크: localStorage만
        if (action === 'bookmark') {
            const added = this.toggleBookmark(path);
            this.showToast(added ? '📌 북마크에 추가했습니다.' : '📌 북마크를 해제했습니다.', 'success');
            saved.fileDate = this.parseDate(saved.item.name);
            saved.days = saved.fileDate ? this.daysAgo(saved.fileDate) : saved.days;
            const container = el('generator-container');
            if (container) { container.innerHTML = this.renderCard(saved); await this.loadCardContent(saved); }
            return;
        }

        // 낙관적 UI: 먼저 다음 카드로 전환
        this.saveCurrent(null);
        this.handleReroll();
        const actionLabels = { revive: '🔥 다시 살리기', realized: '✅ 이미 했음', archived: '🗑️ 그만 봄' };
        this.showToast(`${actionLabels[action] || action} 처리 중...`, 'info');

        if (!ghApi.isConnected()) {
            this.showToast('GitHub 미연결. 연결 후 다시 시도해주세요.', 'warning');
            return;
        }
        try {
            await this.updateStatusOnGitHub(path, action);
            this.showToast(`${actionLabels[action]} 완료!`, 'success');
        } catch (err) {
            if (err?.message?.includes('409')) {
                try { await this.updateStatusOnGitHub(path, action); this.showToast(`${actionLabels[action]} 완료! (재시도)`, 'success'); return; }
                catch (retryErr) { this.showToast(this.friendlyError(retryErr), 'error'); return; }
            }
            this.showToast(this.friendlyError(err), 'error');
        }
    },

    // 카드 본문 비동기 로드 (목데이터 모드: url 없으면 목 콘텐츠 표시)
    async loadCardContent(picked) {
        if (!picked) return;
        const bodyEl = document.getElementById('gen-card-body');
        if (!bodyEl) return;

        // url이 없는 경우 (목데이터) → 목 콘텐츠 표시
        if (!picked.item.url) {
            bodyEl.innerHTML = `<div class="text-sm text-on-surface-variant dark:text-gray-300 leading-relaxed border-l-2 border-indigo-200 dark:border-indigo-700 pl-3">${esc(cleanTitle(picked.item.name))} — 상세 내용은 GitHub 연결 후 확인 가능합니다.</div>`;
            this.addSeen(picked.path);
            return;
        }

        try {
            const fileData = await ghApi.get(picked.item.url);
            const raw = atob(fileData.content);
            const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
            const meta = parseFrontmatter(decoded);
            const conf = parseConfidence(decoded);
            const summary = this.extractSummary(decoded);
            const tags = [].concat(meta.tags || []);

            let html = '';
            if (tags.length > 0) {
                html += `<div class="flex gap-1.5 flex-wrap mb-3">${tags.map(t => `<span class="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 font-bold">${esc(t)}</span>`).join('')}</div>`;
            }
            if (conf) { html += `<div class="mb-3">${confidenceBadge(conf)}</div>`; }
            if (summary) {
                html += `<div class="text-sm text-on-surface-variant dark:text-gray-300 leading-relaxed border-l-2 border-indigo-200 dark:border-indigo-700 pl-3">${esc(summary)}</div>`;
            } else {
                html += `<p class="text-sm text-gray-400 italic">본문이 비어있습니다.</p>`;
            }
            if (meta.status) {
                html += `<div class="mt-3"><span class="text-[10px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-bold">상태: ${esc(meta.status)}</span></div>`;
            }
            bodyEl.innerHTML = html;
            this.addSeen(picked.path);
        } catch {
            bodyEl.innerHTML = '<p class="text-sm text-red-400">내용을 불러올 수 없습니다.</p>';
        }
    },

    // 데이터 미로드 시 lazy load
    async ensureData() {
        if (!ghApi.isConnected()) return;
        if (!STATE.loaded.ideas) await loadIdeasFromGitHub();
        if (!STATE.loaded.domains) await loadDomainsFromGitHub();
    },

    // 🎲 다시 추첨 핸들러
    handleReroll() {
        const container = el('generator-container');
        if (!container) return;
        const picked = this.pick();
        if (!picked) {
            // 풀 소진
            container.innerHTML = this.renderExhausted();
            this.saveCurrent(null);
            return;
        }
        container.innerHTML = this.renderCard(picked);
        this.saveCurrent(picked);
        refreshIcons();
        this.loadCardContent(picked);
    },

    // 🔄 리셋 핸들러
    handleReset() {
        this.resetSeen();
        this.run();
    },

    // 메인 실행: 탭 진입 시 호출
    async run() {
        const container = el('generator-container');
        if (!container) return;

        // 세션 내 현재 카드가 있으면 재노출
        const saved = this.loadCurrent();
        if (saved && saved.path) {
            // 날짜 재계산 (Date 객체는 직렬화 안 됨)
            saved.fileDate = this.parseDate(saved.item.name);
            saved.days = saved.fileDate ? this.daysAgo(saved.fileDate) : saved.days;
            container.innerHTML = this.renderCard(saved);
            refreshIcons();
            await this.loadCardContent(saved);
            return;
        }

        // 로딩 표시
        container.innerHTML = `<div class="card text-center py-12 animate-pulse">
            <i data-lucide="zap" class="w-10 h-10 mx-auto mb-3 text-indigo-300"></i>
            <p class="text-sm text-gray-400">추첨 풀을 구성하는 중...</p>
        </div>`;
        refreshIcons();

        // 데이터 확보
        await this.ensureData();

        // 추첨
        const picked = this.pick();
        if (!picked) {
            // 풀이 비었는지 vs 데이터 자체가 없는지 구분
            const totalItems = (STATE.ideas?.length || 0) + (STATE.domains?.length || 0);
            container.innerHTML = totalItems > 0 && this.getSeen().length > 0
                ? this.renderExhausted()
                : this.renderEmpty();
            return;
        }
        container.innerHTML = this.renderCard(picked);
        this.saveCurrent(picked);
        refreshIcons();
        await this.loadCardContent(picked);
    },
};


const el = (id) => document.getElementById(id);

// ============================================================
// 11. 부팅
// ============================================================
function showConnectGuide() {
    const guide = `<div class="text-center py-16 px-6">
        <div class="text-5xl mb-6">🔗</div>
        <h3 class="text-xl font-extrabold mb-3">GitHub 연결이 필요합니다</h3>
        <p class="text-sm text-gray-500 mb-6 leading-relaxed">데이터를 불러오려면 GitHub에 연결해주세요.<br>상단의 <strong>GitHub 연결</strong> 버튼을 눌러 토큰을 입력하면 됩니다.</p>
    </div>`;
    ['inbox-list', 'ideas-list', 'domains-grid', 'journal-list'].forEach(id => {
        const e = el(id); if (e) e.innerHTML = guide;
    });
}

function bootApp() {
    initTheme(); initTabs(); initGitHubAuth(); initModal(); initReminders(); initCharts(); initSearch();
    if (ghApi.isConnected()) loadLiveData();
    else showConnectGuide();
    updateStats(); todos.updateBadge();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => {
    if (initLock()) bootApp();
});
