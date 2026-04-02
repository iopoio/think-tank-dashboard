/**
 * Think Tank Dashboard - app.js
 * 제대리 (Gemini 3.1) Implementation
 */

// --- Configuration & State ---
const GITHUB_REPO = "iopoio/think-tank-inbox";
const STATE = {
    theme: localStorage.getItem('theme') || 'light',
    activeTab: 'inbox',
    inbox: [],
    ideas: [],
    domains: [],
    journal: [],
    stats: {
        categories: { 'AI': 35, 'Finance': 25, 'Lifestyle': 20, 'Health': 10, 'Tech': 10 },
        weekly: [12, 19, 15, 22, 18, 30, 25] // Current week
    },
    reminders: [
        { id: 1, text: "수요일 3시: Inbox 리뷰", icon: "📅", time: "Every Wed 15:00" },
        { id: 2, text: "목요일 저녁: 주간 회고", icon: "📝", time: "Every Thu 20:00" },
        { id: 3, text: "격주 월요일 3시: Domains 점검", icon: "📚", time: "Bi-weekly Mon 15:00" },
        { id: 4, text: "4/15: AI 공모전 마감", icon: "🚀", time: "2026-04-15" }
    ]
};

// --- GitHub API Helper ---
const ghApi = {
    token: localStorage.getItem('gh_token') || (typeof CONFIG !== 'undefined' && CONFIG.GITHUB_TOKEN) || null,

    headers() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
        };
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
            body: JSON.stringify({ message: '[dashboard] 패스 처리', sha }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        return res.json();
    },

    repoUrl(path = '') {
        return `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    },

    isConnected() {
        return !!this.token;
    }
};

// --- PIN 잠금 ---
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
    const sessionOk = sessionStorage.getItem('tt_unlocked');

    // 이미 이 탭에서 인증됨 → 바로 진입
    if (savedHash && sessionOk === 'true') {
        app.style.display = 'flex';
        return true;
    }

    // PIN 미설정 + 처음 → 잠금 화면 표시
    lockScreen.style.display = 'flex';
    pinInput.focus();

    pinInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') {
            pinError.classList.add('hidden');
            return;
        }

        const pin = pinInput.value.trim();
        if (pin.length < 4) return;

        if (!savedHash) {
            // 최초 설정
            const hash = await hashPin(pin);
            localStorage.setItem('tt_pin_hash', hash);
            sessionStorage.setItem('tt_unlocked', 'true');
            lockScreen.style.display = 'none';
            app.style.display = 'flex';
            bootApp();
        } else {
            // 검증
            const hash = await hashPin(pin);
            if (hash === savedHash) {
                sessionStorage.setItem('tt_unlocked', 'true');
                lockScreen.style.display = 'none';
                app.style.display = 'flex';
                bootApp();
            } else {
                pinError.classList.remove('hidden');
                pinInput.value = '';
                pinInput.focus();
            }
        }
    });

    return false;
}

function bootApp() {
    initTheme();
    initTabs();
    initGitHubAuth();
    initModal();
    initReminders();
    initCharts();
    initSearch();

    if (ghApi.isConnected()) {
        loadLiveData();
    } else {
        renderInbox();
        renderIdeas();
        renderDomains();
        renderJournal();
    }
    updateStatsUI();
    todos.updateBadge();
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const alreadyUnlocked = initLock();
    if (alreadyUnlocked) {
        bootApp();
    }
});

// --- Theme Management ---
function initTheme() {
    const toggle = document.getElementById('dark-mode-toggle');
    const toggleMobile = document.getElementById('dark-mode-toggle-mobile');
    const icon = document.getElementById('theme-icon');
    const iconMobile = document.getElementById('theme-icon-mobile');

    function updateIcons() {
        const emoji = STATE.theme === 'dark' ? '☀️' : '🌙';
        if (icon) icon.textContent = emoji;
        if (iconMobile) iconMobile.textContent = emoji;
    }

    // Apply saved theme
    if (STATE.theme === 'dark') {
        document.documentElement.classList.add('dark');
    }
    updateIcons();

    function toggleTheme() {
        STATE.theme = STATE.theme === 'light' ? 'dark' : 'light';
        document.documentElement.classList.toggle('dark');
        updateIcons();
        localStorage.setItem('theme', STATE.theme);
    }

    if (toggle) toggle.addEventListener('click', toggleTheme);
    if (toggleMobile) toggleMobile.addEventListener('click', toggleTheme);
}

// --- Tab Navigation ---
function initTabs() {
    window.switchTab = (tabId) => {
        // Update State
        STATE.activeTab = tabId;

        // Update desktop sidebar tabs
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabId);
        });

        // Update mobile bottom tabs
        document.querySelectorAll('.mobile-tab').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabId);
        });

        // Update UI Panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('hidden', pane.id !== `tab-${tabId}`);
        });

        // 할일 탭 진입 시 렌더링
        if (tabId === 'todos') {
            todos.render();
        }

        // Refresh charts if needed
        if (tabId === 'stats') {
            refreshCharts();
        }
    };
}

// --- Reminders ---
function initReminders() {
    const reminderList = document.getElementById('reminder-list');
    reminderList.innerHTML = STATE.reminders.map(rem => `
        <div class="p-4 rounded-2xl bg-gray-50 dark:bg-dark-800 border border-gray-100 dark:border-gray-700/50 hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all cursor-pointer group">
            <div class="flex items-center gap-3 mb-1">
                <span class="text-lg">${rem.icon}</span>
                <p class="text-sm font-bold text-gray-800 dark:text-gray-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">${rem.text}</p>
            </div>
            <p class="text-[10px] text-gray-400 dark:text-gray-500 ml-7">${rem.time}</p>
        </div>
    `).join('');
}

// --- Charts Implementation ---
let categoryChart, weeklyChart;

function initCharts() {
    const ctxCategory = document.getElementById('category-chart').getContext('2d');
    const ctxWeekly = document.getElementById('weekly-chart').getContext('2d');
    
    // Category Pie Chart
    categoryChart = new Chart(ctxCategory, {
        type: 'doughnut',
        data: {
            labels: Object.keys(STATE.stats.categories),
            datasets: [{
                data: Object.values(STATE.stats.categories),
                backgroundColor: [
                    '#6366f1', // indigo
                    '#8b5cf6', // violet
                    '#ec4899', // pink
                    '#f59e0b', // amber
                    '#10b981'  // emerald
                ],
                borderWidth: 0,
                hoverOffset: 20
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: { family: 'Inter', size: 12 },
                        color: STATE.theme === 'dark' ? '#94a3b8' : '#64748b'
                    }
                }
            },
            cutout: '70%'
        }
    });

    // Weekly Bar Chart
    weeklyChart = new Chart(ctxWeekly, {
        type: 'bar',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Intake Count',
                data: STATE.stats.weekly,
                backgroundColor: '#6366f1',
                borderRadius: 8,
                hoverBackgroundColor: '#4f46e5'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function refreshCharts() {
    if (categoryChart) {
        // Update colors based on current theme if needed
        categoryChart.options.plugins.legend.labels.color = STATE.theme === 'dark' ? '#94a3b8' : '#64748b';
        categoryChart.update();
    }
}

function updateStatsUI() {
    document.getElementById('stat-total-intake').textContent = STATE.stats.weekly.reduce((a, b) => a + b, 0);
}

// --- GitHub Auth ---
function initModal() {
    const modal = document.getElementById('content-modal');
    document.getElementById('close-modal').addEventListener('click', () => {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            document.body.classList.remove('modal-open');
        }
    });
}

function openModal(title, bodyHtml) {
    const modal = document.getElementById('content-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function githubConnectHandler() {
    if (ghApi.isConnected()) {
        if (confirm('GitHub 연결을 해제하시겠습니까?')) {
            ghApi.token = null;
            localStorage.removeItem('gh_token');
            updateAuthUI();
            renderInbox();
            renderIdeas();
            renderDomains();
            renderJournal();
        }
    } else {
        const token = prompt(
            'GitHub Personal Access Token을 입력하세요.\n\n' +
            '생성 경로:\n' +
            'GitHub → Settings → Developer settings\n' +
            '→ Personal access tokens → Fine-grained tokens\n' +
            '→ Generate new token\n\n' +
            '권한: think-tank-inbox 리포에 Contents Read/Write'
        );
        if (token && token.trim()) {
            ghApi.token = token.trim();
            localStorage.setItem('gh_token', token.trim());
            updateAuthUI();
            loadLiveData();
        }
    }
}

function initGitHubAuth() {
    const connectBtn = document.getElementById('connect-github');
    const connectBtnMobile = document.getElementById('connect-github-mobile');
    const refreshBtn = document.getElementById('refresh-all');

    updateAuthUI();

    if (connectBtn) connectBtn.addEventListener('click', githubConnectHandler);
    if (connectBtnMobile) connectBtnMobile.addEventListener('click', githubConnectHandler);

    if (refreshBtn) refreshBtn.addEventListener('click', () => {
        if (ghApi.isConnected()) {
            loadLiveData();
        } else {
            alert('먼저 GitHub에 연결해주세요.');
        }
    });
}

function updateAuthUI() {
    ['connect-github', 'connect-github-mobile'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (ghApi.isConnected()) {
            btn.innerHTML = '<span>✓ 연결됨</span>';
            btn.classList.add('!bg-emerald-600', 'dark:!bg-emerald-600', 'dark:!text-white');
        } else {
            btn.innerHTML = '<span>GitHub 연결</span>';
            btn.classList.remove('!bg-emerald-600', 'dark:!bg-emerald-600', 'dark:!text-white');
        }
    });
}

async function loadLiveData() {
    try {
        await Promise.all([
            loadInboxFromGitHub(),
            loadIdeasFromGitHub(),
            loadDomainsFromGitHub(),
            loadJournalFromGitHub(),
        ]);
    } catch (e) {
        console.error('GitHub 데이터 로드 실패:', e);
        if (e.message.includes('401')) {
            alert('토큰이 만료되었거나 잘못되었습니다. 다시 연결해주세요.');
            ghApi.token = null;
            localStorage.removeItem('gh_token');
            updateAuthUI();
        }
    }
}

async function loadInboxFromGitHub() {
    const list = document.getElementById('inbox-list');
    list.innerHTML = '<div class="card animate-pulse h-32"></div>';

    try {
        const files = await ghApi.get(ghApi.repoUrl('inbox/'));
        const items = files.filter(f => f.type === 'file');

        STATE.inbox = items;
        ['inbox-badge', 'inbox-badge-mobile'].forEach(id => {
            const b = document.getElementById(id);
            if (!b) return;
            b.textContent = items.length;
            b.classList.toggle('hidden', items.length === 0);
        });

        if (items.length === 0) {
            list.innerHTML = '<div class="card text-center text-gray-500 py-12">🎉 Inbox가 비어있습니다!</div>';
            return;
        }

        list.innerHTML = items.map((item, i) => `
            <div class="card flex items-center justify-between group cursor-pointer hover:bg-indigo-50/10 active:scale-[0.99] transition-all" onclick="openInboxItem(${i})">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-xl">📄</div>
                    <div>
                        <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">${item.name.replace(/\.md$/i, '').replace(/[-_]/g, ' ')}</h4>
                        <div class="text-xs text-gray-500">inbox/${item.name}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="event.stopPropagation(); inboxAction('confirm', ${i})" class="p-2 rounded-lg bg-gray-100 dark:bg-dark-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-gray-500 hover:text-emerald-600 transition-colors" title="확인 (Domains로 이동)">✅</button>
                    <button onclick="event.stopPropagation(); inboxAction('execute', ${i})" class="p-2 rounded-lg bg-gray-100 dark:bg-dark-800 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-gray-500 hover:text-violet-600 transition-colors" title="실행 (마크)">▶️</button>
                    <button onclick="event.stopPropagation(); inboxAction('pass', ${i})" class="p-2 rounded-lg bg-gray-100 dark:bg-dark-800 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-gray-500 hover:text-rose-600 transition-colors" title="패스 (삭제)">⏭️</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="card text-center text-gray-500 py-12">inbox/ 폴더를 찾을 수 없습니다.</div>';
    }
}

async function openInboxItem(index) {
    const item = STATE.inbox[index];
    if (!item) return;

    try {
        const fileData = await ghApi.get(item.url);
        const content = atob(fileData.content);
        const decoded = new TextDecoder('utf-8').decode(
            Uint8Array.from(content, c => c.charCodeAt(0))
        );

        openModal(item.name.replace(/\.md$/i, ''), simpleMarkdown(decoded));
    } catch (e) {
        alert('파일 로드 실패: ' + e.message);
    }
}

function simpleMarkdown(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-4 mb-1">$1</h3>')
        .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-1">$1</h2>')
        .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-2">$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

async function inboxAction(action, index) {
    const item = STATE.inbox[index];
    if (!item) return;

    try {
        const fileData = await ghApi.get(item.url);

        if (action === 'confirm') {
            if (!confirm('이 항목을 domains/로 이동하시겠습니까?')) return;
            await ghApi.put(ghApi.repoUrl(`domains/${item.name}`), {
                message: `[dashboard] 확인: ${item.name} → domains/`,
                content: fileData.content,
            });
            await ghApi.delete(ghApi.repoUrl(`inbox/${item.name}`), fileData.sha);

        } else if (action === 'execute') {
            if (!confirm('이 항목을 "실행" 상태로 마크하시겠습니까?')) return;
            const content = atob(fileData.content);
            const newContent = `[ACTION_REQUIRED]\n\n${content}`;
            const encoded = btoa(unescape(encodeURIComponent(newContent)));
            await ghApi.put(ghApi.repoUrl(`inbox/${item.name}`), {
                message: `[dashboard] 실행 마크: ${item.name}`,
                content: encoded,
                sha: fileData.sha,
            });

        } else if (action === 'pass') {
            if (!confirm('이 항목을 삭제하시겠습니까?')) return;
            await ghApi.delete(ghApi.repoUrl(`inbox/${item.name}`), fileData.sha);
        }

        // 새로고침
        await loadInboxFromGitHub();
    } catch (e) {
        alert('처리 실패: ' + e.message);
    }
}

async function loadIdeasFromGitHub() {
    const list = document.getElementById('ideas-list');
    try {
        const files = await ghApi.get(ghApi.repoUrl('ideas/'));
        const items = files.filter(f => f.type === 'file');
        if (items.length === 0) {
            list.innerHTML = '<div class="card text-center text-gray-500 py-12">아이디어가 없습니다.</div>';
            return;
        }
        list.innerHTML = items.map(item => `
            <div class="card group hover:-translate-y-1 transition-all cursor-pointer">
                <h4 class="font-extrabold text-lg mb-2">${item.name.replace(/\.md$/i, '').replace(/[-_]/g, ' ')}</h4>
                <p class="text-sm text-gray-500">ideas/${item.name}</p>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="card text-center text-gray-500 py-12">ideas/ 폴더를 찾을 수 없습니다.</div>';
    }
}

async function loadDomainsFromGitHub() {
    const container = document.getElementById('domains-grid');
    try {
        const items = await ghApi.get(ghApi.repoUrl('domains/'));
        const colors = ['from-amber-400 to-orange-500', 'from-indigo-400 to-indigo-600', 'from-emerald-400 to-teal-600', 'from-violet-400 to-purple-600', 'from-pink-400 to-rose-600'];
        const icons = ['📁', '🤖', '💰', '🧬', '🏛️', '📚'];

        container.innerHTML = items.map((item, i) => `
            <div class="card !p-0 overflow-hidden group cursor-pointer">
                <div class="bg-gradient-to-r ${colors[i % colors.length]} h-2"></div>
                <div class="p-8">
                    <div class="text-3xl mb-4">${item.type === 'dir' ? icons[i % icons.length] : '📄'}</div>
                    <h4 class="text-xl font-black font-outfit mb-1">${item.name.replace(/[-_]/g, ' ')}</h4>
                    <p class="text-sm text-gray-500">${item.type === 'dir' ? 'Folder' : 'File'}</p>
                </div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div class="card text-center text-gray-500 py-12 col-span-full">domains/ 폴더를 찾을 수 없습니다.</div>';
    }
}

async function loadJournalFromGitHub() {
    const list = document.getElementById('journal-list');
    try {
        const files = await ghApi.get(ghApi.repoUrl('journal/'));
        const items = files.filter(f => f.type === 'file').reverse();
        if (items.length === 0) {
            list.innerHTML = '<div class="card text-center text-gray-500 py-12">회고가 없습니다.</div>';
            return;
        }
        list.innerHTML = items.map(item => `
            <div class="flex gap-6 group">
                <div class="hidden md:flex flex-col items-center">
                    <div class="w-4 h-4 rounded-full border-4 border-indigo-500 bg-white dark:bg-dark-950 z-10"></div>
                    <div class="w-0.5 h-full bg-gray-100 dark:bg-dark-800 -mt-1 group-last:hidden"></div>
                </div>
                <div class="card flex-grow !p-8 hover:translate-x-1 transition-transform">
                    <h4 class="text-xl font-extrabold mb-3">${item.name.replace(/\.md$/i, '').replace(/[-_]/g, ' ')}</h4>
                    <p class="text-gray-600 dark:text-gray-400 text-sm">journal/${item.name}</p>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="card text-center text-gray-500 py-12">journal/ 폴더를 찾을 수 없습니다.</div>';
    }
}

// --- Search Functionality ---
function initSearch() {
    const searchInput = document.getElementById('global-search');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (query.length > 2) {
            performSearch(query);
        }
    });
}

async function performSearch(query) {
    console.log(`Searching for: ${query}`);
    // In a real app, this would call GitHub Search API
    // Example: https://api.github.com/search/code?q=${query}+repo:${GITHUB_REPO}
}

// --- 모달 열기 공통 함수 ---
function showMockModal(title, body) {
    openModal(title, body.replace(/\\n/g, '<br>').replace(/\n/g, '<br>'));
}

// --- Rendering Logic (Mock Data for now) ---
function renderInbox() {
    const list = document.getElementById('inbox-list');
    // Mock data for initial UI check
    const items = [
        { id: 1, title: "[AI] GPT-5 아키텍처 인사이트", category: "AI", date: "2026-04-02", priority: "높음" },
        { id: 2, title: "[투자] KOSPI 배당 전략 분석", category: "투자", date: "2026-04-01", priority: "보통" },
        { id: 3, title: "[생활] Q1 개인 목표 리뷰", category: "생활", date: "2026-03-31", priority: "낮음" }
    ];
    
    STATE.inbox = items;
    document.getElementById('inbox-badge').textContent = items.length;
    document.getElementById('inbox-badge').classList.remove('hidden');

    list.innerHTML = items.map(item => `
        <div class="card flex items-center justify-between group cursor-pointer hover:bg-indigo-50/10 active:scale-[0.99] transition-all" onclick="showMockModal('${item.title}', '분류: ${item.category}\\n날짜: ${item.date}\\n우선순위: ${item.priority}')">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-xl">
                    ${item.category === 'AI' ? '🤖' : item.category === '투자' ? '📈' : '✨'}
                </div>
                <div>
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">${item.title}</h4>
                    <div class="flex items-center gap-3 text-xs text-gray-500">
                        <span class="flex items-center gap-1">📅 ${item.date}</span>
                        <span class="flex items-center gap-1">🏷️ ${item.category}</span>
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="event.stopPropagation(); handleInboxAction(${item.id}, 'check')" class="p-2 rounded-lg bg-gray-100 dark:bg-dark-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-gray-500 hover:text-emerald-600 transition-colors" title="확인 (Domains로 이동)">✅</button>
                <button onclick="event.stopPropagation(); handleInboxAction(${item.id}, 'execute')" class="p-2 rounded-lg bg-gray-100 dark:bg-dark-800 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-gray-500 hover:text-violet-600 transition-colors" title="실행 (활성 태스크)">▶️</button>
                <button onclick="event.stopPropagation(); handleInboxAction(${item.id}, 'pass')" class="p-2 rounded-lg bg-gray-100 dark:bg-dark-800 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-gray-500 hover:text-rose-600 transition-colors" title="패스 (보관)">⏭️</button>
            </div>
        </div>
    `).join('');
}

function handleInboxAction(id, action) {
    console.log(`Action [${action}] on item ${id}`);
    const item = STATE.inbox.find(i => i.id === id);
    if (!item) return;

    // Show feedback (could be a toast, here we just alert/log for now as it's a skeleton)
    const actionMap = {
        'check': 'Domains로 이동합니다 📚',
        'execute': '실행 마크 완료! ▶️',
        'pass': '보관 처리됨 ⏭️'
    };
    
    alert(`${item.title}: ${actionMap[action]}`);
    
    // Remove from UI (mock)
    STATE.inbox = STATE.inbox.filter(i => i.id !== id);
    renderInbox();
    updateStatsUI();
}

function renderIdeas() {
    const list = document.getElementById('ideas-list');
    const items = [
        { title: "AI 기반 종목 선정기", status: "구상중", desc: "LLM으로 분기 보고서를 자동 분석하는 시스템." },
        { title: "건강한 아침 루틴 v2", status: "진행중", desc: "명상과 고단백 아침 식사를 통합한 루틴." },
        { title: "스마트홈 대시보드", status: "완료", desc: "에너지 모니터링 + Hue 조명 제어 시스템." }
    ];
    
    list.innerHTML = items.map(item => `
        <div class="card group hover:-translate-y-1 transition-all cursor-pointer" onclick="showMockModal('${item.title}', '상태: ${item.status}\\n\\n${item.desc}')">
            <div class="flex justify-between mb-4">
                <span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${item.status === '완료' ? 'bg-emerald-100 text-emerald-700' : item.status === '구상중' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}">
                    ${item.status}
                </span>
                <span class="text-gray-300">•••</span>
            </div>
            <h4 class="font-extrabold text-lg mb-2">${item.title}</h4>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">${item.desc}</p>
            <div class="w-full bg-gray-100 dark:bg-dark-800 h-1 rounded-full overflow-hidden">
                <div class="bg-indigo-500 h-full w-[45%]"></div>
            </div>
        </div>
    `).join('');
}

function renderDomains() {
    const container = document.getElementById('domains-grid');
    const domains = [
        { name: "투자", count: 42, icon: "💰", color: "from-amber-400 to-orange-500" },
        { name: "AI", count: 128, icon: "🤖", color: "from-indigo-400 to-indigo-600" },
        { name: "건강 & 바이오", count: 15, icon: "🧬", color: "from-emerald-400 to-teal-600" },
        { name: "철학", count: 24, icon: "🏛️", color: "from-violet-400 to-purple-600" }
    ];
    
    container.innerHTML = domains.map(domain => `
        <div class="card !p-0 overflow-hidden group cursor-pointer" onclick="showMockModal('${domain.icon} ${domain.name}', '저장된 인사이트: ${domain.count}개\\n\\nGitHub 연결 후 실제 데이터를 확인할 수 있습니다.')">
            <div class="bg-gradient-to-r ${domain.color} h-2"></div>
            <div class="p-8">
                <div class="text-3xl mb-4 group-hover:scale-110 transition-transform origin-left">${domain.icon}</div>
                <h4 class="text-xl font-black font-outfit mb-1">${domain.name}</h4>
                <p class="text-sm text-gray-500">${domain.count}개 인사이트 저장됨</p>
                <div class="mt-8 flex items-center justify-between text-indigo-600 font-bold text-xs">
                    <span>도메인 탐색</span>
                    <span>→</span>
                </div>
            </div>
        </div>
    `).join('');
}

function renderJournal() {
    const list = document.getElementById('journal-list');
    const journals = [
        { week: "2026-W13", title: "3월 마무리 회고", date: "2026년 4월 2일", desc: "전반적으로 진행 양호. AI 리서치 속도에 집중 필요." },
        { week: "2026-W12", title: "분기 점검", date: "2026년 3월 26일", desc: "Q2 OKR 조정 중. 수익 흐름이 긍정적." }
    ];
    
    list.innerHTML = journals.map(j => `
        <div class="flex gap-6 group">
            <div class="hidden md:flex flex-col items-center">
                <div class="w-4 h-4 rounded-full border-4 border-indigo-500 bg-white dark:bg-dark-950 z-10"></div>
                <div class="w-0.5 h-full bg-gray-100 dark:bg-dark-800 -mt-1 group-last:hidden"></div>
            </div>
            <div class="card flex-grow !p-8 hover:translate-x-1 transition-transform cursor-pointer" onclick="showMockModal('${j.title}', '${j.week} · ${j.date}\\n\\n${j.desc}')">
                <div class="flex items-center gap-2 text-indigo-500 font-bold text-[10px] uppercase tracking-widest mb-2">
                    <span>${j.week}</span>
                    <span>•</span>
                    <span class="text-gray-400">${j.date}</span>
                </div>
                <h4 class="text-xl font-extrabold mb-3">${j.title}</h4>
                <p class="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">${j.desc}</p>
            </div>
        </div>
    `).join('');
}

// --- 할일 (Todo) 모듈 ---
const todos = {
    items: JSON.parse(localStorage.getItem('tt_todos') || '[]'),
    filter: 'all',

    save() {
        localStorage.setItem('tt_todos', JSON.stringify(this.items));
    },

    add() {
        const input = document.getElementById('todo-input');
        const text = input.value.trim();
        if (!text) return;

        this.items.unshift({
            id: Date.now(),
            text: text,
            done: false,
            createdAt: new Date().toISOString(),
        });
        this.save();
        this.render();
        input.value = '';
        input.focus();
    },

    toggle(id) {
        const item = this.items.find(t => t.id === id);
        if (item) {
            item.done = !item.done;
            if (item.done) item.doneAt = new Date().toISOString();
            this.save();
            this.render();
        }
    },

    remove(id) {
        this.items = this.items.filter(t => t.id !== id);
        this.save();
        this.render();
    },

    setFilter(f) {
        this.filter = f;
        document.querySelectorAll('.todo-filter').forEach(btn => {
            const label = { all: '전체', pending: '미완료', done: '완료' }[f];
            btn.classList.toggle('active', btn.textContent.trim() === label);
        });
        this.render();
    },

    getFiltered() {
        if (this.filter === 'pending') return this.items.filter(t => !t.done);
        if (this.filter === 'done') return this.items.filter(t => t.done);
        return this.items;
    },

    updateBadge() {
        const count = this.items.filter(t => !t.done).length;
        ['todo-badge', 'todo-badge-mobile'].forEach(id => {
            const badge = document.getElementById(id);
            if (!badge) return;
            if (count > 0) {
                badge.textContent = count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        });
    },

    formatDate(iso) {
        const d = new Date(iso);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    },

    render() {
        const list = document.getElementById('todo-list');
        if (!list) return;
        const filtered = this.getFiltered();
        this.updateBadge();

        if (filtered.length === 0) {
            const msg = this.filter === 'done' ? '완료된 할일이 없습니다.'
                      : this.filter === 'pending' ? '모두 완료했습니다!'
                      : '할일을 추가해보세요.';
            list.innerHTML = `<div class="card text-center text-gray-500 py-12">${msg}</div>`;
            return;
        }

        list.innerHTML = filtered.map(t => `
            <div class="card flex items-center gap-4 group ${t.done ? 'opacity-60' : ''}">
                <button onclick="todos.toggle(${t.id})" class="w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${t.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-indigo-500'}">
                    ${t.done ? '✓' : ''}
                </button>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium ${t.done ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-100'}">${this.escapeHtml(t.text)}</p>
                    <p class="text-xs text-gray-400 mt-1">${this.formatDate(t.createdAt)}에 추가${t.done && t.doneAt ? ' · ' + this.formatDate(t.doneAt) + '에 완료' : ''}</p>
                </div>
                <button onclick="todos.remove(${t.id})" class="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all" title="삭제">✕</button>
            </div>
        `).join('');
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};
