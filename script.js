// --- データ管理 ---
const STORAGE_KEY = 'clf_wiki_data';

const CLF_DOMAINS = [
    {
        id: 'domain1', label: 'ドメイン1: クラウドの概念', pct: '24%', color: 'var(--cyber-blue)',
        topics: ['AWSの価値提案（なぜクラウドか）', 'クラウドの経済性・料金モデル', 'クラウド設計原則 (Well-Architected)', 'AWSグローバルインフラ（リージョン/AZ/エッジ）']
    },
    {
        id: 'domain2', label: 'ドメイン2: セキュリティとコンプライアンス', pct: '30%', color: 'var(--cyber-red)',
        topics: ['責任共有モデル', 'IAM（ユーザー・グループ・ロール・ポリシー）', 'MFA・パスワードポリシー', 'セキュリティサービス（Shield・WAF・GuardDuty）', 'AWS Artifact / コンプライアンス']
    },
    {
        id: 'domain3', label: 'ドメイン3: クラウドテクノロジーとサービス', pct: '34%', color: 'var(--aws-orange)',
        topics: ['コンピューティング（EC2・Lambda・ECS・Fargate）', 'ストレージ（S3・EBS・EFS・Glacier）', 'データベース（RDS・DynamoDB・ElastiCache）', 'ネットワーク（VPC・CloudFront・Route53・ELB）', '管理ツール（CloudWatch・CloudTrail・Config）', 'その他主要サービス（SNS・SQS・Step Functions）']
    },
    {
        id: 'domain4', label: 'ドメイン4: 請求・料金・サポート', pct: '12%', color: 'var(--cyber-green)',
        topics: ['料金モデル（オンデマンド・リザーブド・スポット・Savings Plans）', 'コスト管理（Cost Explorer・Budgets・Cost Allocation Tags）', 'AWSサポートプラン（Basic・Developer・Business・Enterprise）', 'AWS Organizations / 一括請求']
    }
];

let appData = {
    terms: [],
    scores: [null, null, null, null, null, null],
    radarScores: [0, 0, 0, 0],
    studyTime: {},
    settings: { apiKey: '', examDate: '', dailyGoal: 3 },
    milestones: [false, false, false, false],
    streak: { count: 0, lastLogin: '' },
    clfProgress: {}
};

// 初期ロード
function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        appData = JSON.parse(saved);
        if (!appData.settings) appData.settings = { apiKey: '', examDate: '', dailyGoal: 3 };
        if (!appData.settings.dailyGoal) appData.settings.dailyGoal = 3;
        if (!appData.studyTime) appData.studyTime = {};
        if (!appData.radarScores) appData.radarScores = [0, 0, 0, 0];
        if (!appData.clfProgress) appData.clfProgress = {};
        appData.terms.forEach(t => { if (!t.category) t.category = 'Other'; });
    }
    updateStreak();
    saveData();
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

// --- ストリーク計算 ---
function updateStreak() {
    const today = new Date().toISOString().split('T')[0];
    if (appData.streak.lastLogin === '') {
        appData.streak.count = 1;
        appData.streak.lastLogin = today;
    } else if (appData.streak.lastLogin !== today) {
        const lastDate = new Date(appData.streak.lastLogin);
        const currentDate = new Date(today);
        const diffTime = Math.abs(currentDate - lastDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        if (diffDays === 1) {
            appData.streak.count += 1;
        } else {
            appData.streak.count = 1; // 途切れたらリセット
        }
        appData.streak.lastLogin = today;
    }
}

// --- ルーティング (SPA) ---
document.querySelectorAll('.nav-links li').forEach(link => {
    link.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        const targetId = e.currentTarget.getAttribute('data-target');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
        document.getElementById(targetId).classList.add('active-view');

        if (targetId === 'dashboard') renderDashboard();
        if (targetId === 'dictionary') renderDictionary();
        if (targetId === 'logs') renderChart();
        if (targetId === 'settings') renderSettings();
        if (targetId === 'quiz') resetQuizUI();
        if (targetId === 'voice-coach') {
            if (typeof initVoiceCoachWelcome === 'function') initVoiceCoachWelcome();
        } else {
            // 別タブに移動したら音声・録音を停止
            if (typeof stopSpeaking === 'function') stopSpeaking();
            if (typeof isRecording !== 'undefined' && isRecording && typeof stopRecording === 'function') stopRecording();
        }
    });
});

// ブラウザタブを離れたときも停止（別アプリに切り替えた場合など）
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (typeof stopSpeaking === 'function') stopSpeaking();
        if (typeof isRecording !== 'undefined' && isRecording && typeof stopRecording === 'function') stopRecording();
    }
});

// --- 用語の自動解説＆カテゴリ判定 (JSON出力要求) ---
async function generateExplanationWithOpenAI(term) {
    if (!appData.settings.apiKey) throw new Error('設定画面でOpenAI API Keyを設定してください。');
    const apiKey = appData.settings.apiKey;

    try {
        const url = 'https://api.openai.com/v1/chat/completions';
        const prompt = `あなたはAWS認定クラウドプラクティショナー試験の講師です。以下のAWS用語を、IT未経験の大学生でも一目でわかるように解説してください。

用語: ${term}

以下のJSON形式のみで出力してください：
{
  "category": "Compute, Storage, Database, Network, Security, または Other から1つ選択",
  "explanation": "以下の構成で説明してください。\n## ひと言で言うと\n（一文で超シンプルに。身近なモノに例えるとベスト）\n## 何ができるの？\n* （箇条書き2〜3行。具体的に）\n## 試験に出るポイント\n* （箇条書き1〜2行。これだけ覚えればOKな要点）\n## 関連サービス\n（関連する他のAWSサービスを1〜3個、一行で。なければ省略）\n\n全体で250文字以内に収めてください。"
}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error('API通信エラー: ' + (err.error?.message || ''));
        }
        const data = await response.json();
        const resultText = data.choices[0].message.content.trim();
        return JSON.parse(resultText); // { category, explanation }
    } catch (error) {
        console.error(error);
        throw error;
    }
}

// --- 用語図鑑機能 ---
const btnAddTerm = document.getElementById('btn-add-term');
const termLoading = document.getElementById('term-loading');
const dictionaryList = document.getElementById('dictionary-list');
const searchInput = document.getElementById('search-term');
const categoryFilter = document.getElementById('category-filter');

btnAddTerm.addEventListener('click', async () => {
    const nameInput = document.getElementById('new-term-name');
    const refInput = document.getElementById('new-term-ref');
    const name = nameInput.value.trim();
    const ref = refInput.value.trim() || 'なし';

    if (!name) return alert('用語名を入力してください。');

    try {
        btnAddTerm.disabled = true;
        termLoading.classList.remove('hidden');

        let desc = "";
        let category = "Other";
        if (appData.settings.apiKey) {
            const aiResult = await generateExplanationWithOpenAI(name);
            desc = aiResult.explanation;
            category = aiResult.category;
        } else {
            desc = "（APIキーが未設定のため解説生成はスキップされました）";
            alert('APIキーが未設定です。');
        }

        const today = new Date();
        const nextReview = new Date(today);
        nextReview.setDate(today.getDate() + 1);

        appData.terms.push({
            id: Date.now().toString(),
            name, ref, desc, category,
            createdAt: today.toISOString(),
            nextReviewDate: nextReview.toISOString()
        });

        saveData();
        nameInput.value = '';
        refInput.value = '';
        renderDictionary();
    } catch (error) {
        alert('エラー: ' + error.message);
    } finally {
        btnAddTerm.disabled = false;
        termLoading.classList.add('hidden');
    }
});

function renderDictionary() {
    dictionaryList.innerHTML = '';
    const filterText = searchInput.value.toLowerCase();
    const filterCat = categoryFilter.value;

    const filteredTerms = appData.terms.filter(t => {
        const matchName = t.name.toLowerCase().includes(filterText);
        const matchCat = filterCat === 'all' || t.category === filterCat;
        return matchName && matchCat;
    });

    filteredTerms.forEach(term => {
        const card = document.createElement('div');
        card.className = 'term-card';
        
        const isReviewTime = new Date() >= new Date(term.nextReviewDate);
        const badgeHTML = isReviewTime ? `<span class="term-status-badge">REVIEW NOW!</span>` : '';
        const catClass = `cat-${term.category.toLowerCase()}`;
        const catBadge = `<span class="category-badge ${catClass}">${term.category}</span>`;

        card.innerHTML = `
            ${badgeHTML}
            <div class="term-header">
                <div class="term-title">${term.name} ${catBadge}</div>
                <div class="term-ref"><i class="fa-solid fa-book"></i> ${term.ref}</div>
            </div>
            <div class="term-desc">${marked(term.desc)}</div>
            <div class="term-footer">
                登録日: ${new Date(term.createdAt).toLocaleDateString()} <br>
                <button class="cyber-btn mt-2" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; margin-top: 10px;" onclick="markReviewed('${term.id}')">復習完了</button>
                <button class="cyber-btn mt-2" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; margin-top: 10px; border-color: var(--cyber-red); color: var(--cyber-red);" onclick="deleteTerm('${term.id}')">削除</button>
            </div>
        `;
        dictionaryList.appendChild(card);
    });
}

searchInput.addEventListener('input', renderDictionary);
categoryFilter.addEventListener('change', renderDictionary);

window.markReviewed = function(id) {
    const term = appData.terms.find(t => t.id === id);
    if (term) {
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + 3);
        term.nextReviewDate = nextReview.toISOString();
        saveData();
        renderDictionary();
        renderDashboard();
    }
};

window.deleteTerm = function(id) {
    if (confirm('本当に削除しますか？')) {
        appData.terms = appData.terms.filter(t => t.id !== id);
        saveData();
        renderDictionary();
        renderDashboard();
    }
};

// 簡易Markdown変換
function marked(text) {
    let html = text
        .replace(/## (.*?)(?=\n|$)/g, '<h4 style="color: var(--cyber-blue); margin-top: 12px; margin-bottom: 4px; border-bottom: 1px solid rgba(0,240,255,0.3); padding-bottom: 2px;">$1</h4>')
        .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--aws-orange); text-shadow: 0 0 5px rgba(255,153,0,0.3);">$1</strong>')
        .replace(/^\* (.*?)(?=\n|$)/gm, '<li style="margin-left: 20px; list-style-type: square; color: #e0e0e0;">$1</li>')
        .replace(/\n/g, '<br>');
    html = html.replace(/<br><li/g, '<li').replace(/<\/li><br>/g, '</li>');
    return html;
}

// --- ダッシュボード機能 ---
function renderDashboard() {
    document.getElementById('streak-count').innerText = appData.streak.count;
    const countdownEl = document.getElementById('days-left-display');
    if (appData.settings.examDate) {
        const today = new Date(); today.setHours(0,0,0,0);
        const diffDays = Math.ceil((new Date(appData.settings.examDate) - today) / 86400000);
        countdownEl.innerText = diffDays > 0 ? `${diffDays} Days` : (diffDays === 0 ? "TODAY!" : "OVER");
        if(diffDays === 0) countdownEl.style.color = "var(--cyber-green)";
    } else {
        countdownEl.innerText = "未設定";
    }

    for (let i = 1; i <= 4; i++) {
        const cb = document.getElementById(`ms${i}`);
        cb.checked = appData.milestones[i-1];
        cb.onchange = (e) => { appData.milestones[i-1] = e.target.checked; saveData(); };
    }

    const reviewList = document.getElementById('review-list');
    reviewList.innerHTML = '';
    const termsToReview = appData.terms.filter(t => new Date(t.nextReviewDate) <= new Date());
    
    if (termsToReview.length === 0) {
        reviewList.innerHTML = '<p class="text-muted"><i class="fa-solid fa-circle-check" style="color: var(--cyber-green);"></i> 本日の復習ミッションはクリアしました！</p>';
    } else {
        termsToReview.slice(0, 4).forEach(term => {
            const div = document.createElement('div'); div.className = 'term-card';
            div.innerHTML = `<div class="term-header"><div class="term-title">${term.name}</div></div><div class="term-desc" style="font-size: 0.8rem; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${marked(term.desc)}</div>`;
            reviewList.appendChild(div);
        });
    }

    renderCLFChecklist();
    renderDailyGoal();
    generateDailyCoachAdvice();
}

function renderCLFChecklist() {
    const container = document.getElementById('clf-checklist-content');
    if (!container) return;
    container.innerHTML = '';
    CLF_DOMAINS.forEach(domain => {
        const checked = appData.clfProgress[domain.id] || {};
        const total = domain.topics.length;
        const done = domain.topics.filter((_, i) => checked[i]).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        const section = document.createElement('div');
        section.className = 'clf-domain';
        section.innerHTML = `
            <div class="clf-domain-header">
                <span style="color:${domain.color}; font-weight:bold;">${domain.label}</span>
                <span class="clf-pct-badge" style="border-color:${domain.color}; color:${domain.color};">出題 ${domain.pct}</span>
                <span class="clf-progress-text">${done}/${total}</span>
            </div>
            <div class="clf-mini-bar-wrap"><div class="clf-mini-bar" style="width:${pct}%; background:${domain.color};"></div></div>
            <ul class="clf-topic-list">
                ${domain.topics.map((topic, i) => `
                <li>
                    <label>
                        <input type="checkbox" data-domain="${domain.id}" data-idx="${i}" ${checked[i] ? 'checked' : ''}>
                        <span style="${checked[i] ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${topic}</span>
                    </label>
                </li>`).join('')}
            </ul>
        `;
        container.appendChild(section);
    });

    container.querySelectorAll('input[data-domain]').forEach(cb => {
        cb.addEventListener('change', () => {
            const domainId = cb.dataset.domain;
            const idx = cb.dataset.idx;
            if (!appData.clfProgress[domainId]) appData.clfProgress[domainId] = {};
            appData.clfProgress[domainId][idx] = cb.checked;
            saveData();
            renderCLFChecklist();
        });
    });
}

function renderDailyGoal() {
    const today = new Date().toISOString().split('T')[0];
    const todayTerms = appData.terms.filter(t => t.createdAt && t.createdAt.startsWith(today)).length;
    const goal = appData.settings.dailyGoal || 3;
    const pct = Math.min(100, Math.round((todayTerms / goal) * 100));

    const todayEl = document.getElementById('goal-today-terms');
    const targetEl = document.getElementById('goal-target-terms');
    const barEl = document.getElementById('goal-bar');
    const inputEl = document.getElementById('daily-goal-input');

    if (todayEl) todayEl.textContent = todayTerms;
    if (targetEl) targetEl.textContent = goal;
    if (barEl) {
        barEl.style.width = pct + '%';
        barEl.style.background = pct >= 100 ? 'var(--cyber-green)' : 'var(--cyber-blue)';
    }
    if (inputEl) inputEl.value = goal;
}

// --- 学習ログ (Chart.js 折れ線＋レーダー＋棒グラフ) ---
let scoreChartInstance = null;
let radarChartInstance = null;
let studyTimeChartInstance = null;

function renderChart() {
    // 1. 折れ線グラフ（模試スコア）
    for (let i = 0; i < 6; i++) document.getElementById(`score-${i+1}`).value = appData.scores[i] || '';
    const ctxScore = document.getElementById('scoreChart').getContext('2d');
    if (scoreChartInstance) {
        scoreChartInstance.data.datasets[0].data = appData.scores;
        scoreChartInstance.update();
    } else {
        scoreChartInstance = new Chart(ctxScore, {
            type: 'line',
            data: {
                labels: ['第1回', '第2回', '第3回', '第4回', '第5回', '第6回'],
                datasets: [{ label: '模試スコア', data: appData.scores, borderColor: '#FF9900', backgroundColor: 'rgba(255, 153, 0, 0.2)', borderWidth: 3, pointBackgroundColor: '#00f0ff', pointRadius: 5, fill: true, tension: 0.3 },
                { label: '合格ライン', data: [700, 700, 700, 700, 700, 700], borderColor: 'rgba(57, 255, 20, 0.5)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false }]
            },
            options: { responsive: true, scales: { y: { max: 1000, grid: { color: '#30363d' }, ticks: { color: '#8b949e' } }, x: { grid: { color: '#30363d' }, ticks: { color: '#8b949e' } } }, plugins: { legend: { labels: { color: '#c9d1d9', font: { family: 'Orbitron' } } } } }
        });
    }

    // 2. レーダーチャート（分野別）
    for (let i = 0; i < 4; i++) document.getElementById(`radar-${i+1}`).value = appData.radarScores[i] || 0;
    const ctxRadar = document.getElementById('radarChart').getContext('2d');
    if (radarChartInstance) {
        radarChartInstance.data.datasets[0].data = appData.radarScores;
        radarChartInstance.update();
    } else {
        radarChartInstance = new Chart(ctxRadar, {
            type: 'radar',
            data: {
                labels: ['クラウドの概念', 'セキュリティ', 'テクノロジー', '請求と料金'],
                datasets: [{
                    label: '分野別理解度 (%)',
                    data: appData.radarScores,
                    backgroundColor: 'rgba(0, 240, 255, 0.2)',
                    borderColor: '#00f0ff',
                    pointBackgroundColor: '#FF9900',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                scales: {
                    r: { angleLines: { color: '#30363d' }, grid: { color: '#30363d' }, pointLabels: { color: '#c9d1d9', font: { family: 'Noto Sans JP', size: 12 } }, ticks: { display: false, max: 100, min: 0 } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // 3. 棒グラフ（直近7日間の学習時間）
    const ctxTime = document.getElementById('studyTimeChart').getContext('2d');
    const labelsTime = [];
    const dataTime = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        labelsTime.push(`${d.getMonth()+1}/${d.getDate()}`);
        dataTime.push(appData.studyTime[dateStr] || 0);
    }
    
    if (studyTimeChartInstance) {
        studyTimeChartInstance.data.labels = labelsTime;
        studyTimeChartInstance.data.datasets[0].data = dataTime;
        studyTimeChartInstance.update();
    } else {
        studyTimeChartInstance = new Chart(ctxTime, {
            type: 'bar',
            data: {
                labels: labelsTime,
                datasets: [{
                    label: '学習時間 (分)',
                    data: dataTime,
                    backgroundColor: 'rgba(57, 255, 20, 0.5)',
                    borderColor: '#39ff14',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true, grid: { color: '#30363d' }, ticks: { color: '#8b949e' } },
                    x: { grid: { display: false }, ticks: { color: '#8b949e' } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

document.getElementById('btn-save-scores').addEventListener('click', () => {
    for (let i = 0; i < 6; i++) {
        const val = document.getElementById(`score-${i+1}`).value;
        appData.scores[i] = val !== '' ? Number(val) : null;
    }
    saveData(); renderChart(); alert('スコアを保存しました。');
});

document.getElementById('btn-save-radar').addEventListener('click', () => {
    for (let i = 0; i < 4; i++) {
        const val = document.getElementById(`radar-${i+1}`).value;
        appData.radarScores[i] = val !== '' ? Number(val) : 0;
    }
    saveData(); renderChart(); alert('分野別スコアを保存しました。');
});


// --- AIクイズ道場機能 ---
const btnStartQuiz = document.getElementById('btn-start-quiz');
const btnNextQuiz = document.getElementById('btn-next-quiz');
const quizContainer = document.getElementById('quiz-container');
const quizLoading = document.getElementById('quiz-loading');
const quizQuestion = document.getElementById('quiz-question');
const quizOptions = document.getElementById('quiz-options');
const quizResult = document.getElementById('quiz-result');

function resetQuizUI() {
    quizContainer.classList.add('hidden');
    quizLoading.classList.add('hidden');
    quizResult.classList.add('hidden');
    btnNextQuiz.classList.add('hidden');
    btnStartQuiz.style.display = 'inline-block';
}

async function generateQuiz() {
    if (!appData.settings.apiKey) return alert('設定画面でOpenAI API Keyを設定してください。');
    if (appData.terms.length < 3) return alert('クイズを生成するには、用語図鑑に最低3つ以上の用語を登録してください！');

    btnStartQuiz.style.display = 'none';
    btnNextQuiz.classList.add('hidden');
    quizContainer.classList.add('hidden');
    quizResult.classList.add('hidden');
    quizLoading.classList.remove('hidden');

    try {
        // 登録されている用語からランダムに1つピックアップ
        const targetTerm = appData.terms[Math.floor(Math.random() * appData.terms.length)];
        const apiKey = appData.settings.apiKey;
        const url = 'https://api.openai.com/v1/chat/completions';
        
        const prompt = `あなたはAWS認定クラウドプラクティショナー試験の問題作成者です。以下のAWS用語に関する「4択クイズ」を1問作成してください。
対象用語: ${targetTerm.name}
解説: ${targetTerm.desc}

出力は以下のJSONフォーマットのみにしてください：
{
  "question": "問題文（このサービスは何をするものか、などの問い）",
  "options": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
  "correctIndex": 正解のインデックス番号(0〜3の整数),
  "explanation": "正解の理由の短い解説"
}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error('API通信エラー: ' + (err.error?.message || ''));
        }
        const data = await response.json();
        const resultText = data.choices[0].message.content.trim();
        const quizData = JSON.parse(resultText);

        renderQuiz(quizData);
    } catch (error) {
        console.error(error);
        alert('クイズの生成に失敗しました: ' + error.message);
        resetQuizUI();
    } finally {
        quizLoading.classList.add('hidden');
    }
}

function renderQuiz(quizData) {
    quizQuestion.textContent = quizData.question;
    quizOptions.innerHTML = '';
    
    quizData.options.forEach((optText, index) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option-btn';
        btn.textContent = `${index + 1}. ${optText}`;
        btn.onclick = () => handleQuizAnswer(index, quizData.correctIndex, quizData.explanation, btn);
        quizOptions.appendChild(btn);
    });
    
    quizContainer.classList.remove('hidden');
}

function handleQuizAnswer(selectedIndex, correctIndex, explanation, clickedBtn) {
    // 全ボタンを無効化
    const buttons = quizOptions.querySelectorAll('.quiz-option-btn');
    buttons.forEach(b => b.disabled = true);

    if (selectedIndex === correctIndex) {
        clickedBtn.classList.add('correct');
        quizResult.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--cyber-green);"></i> 正解！<br><span style="font-size:0.9rem; font-weight:normal; color:#e0e0e0;">${explanation}</span>`;
        quizResult.style.color = 'var(--cyber-green)';
    } else {
        clickedBtn.classList.add('wrong');
        buttons[correctIndex].classList.add('correct'); // 正解を光らせる
        quizResult.innerHTML = `<i class="fa-solid fa-xmark" style="color: var(--cyber-red);"></i> 不正解...<br><span style="font-size:0.9rem; font-weight:normal; color:#e0e0e0;">${explanation}</span>`;
        quizResult.style.color = 'var(--cyber-red)';
    }
    
    quizResult.classList.remove('hidden');
    btnNextQuiz.classList.remove('hidden');
}

btnStartQuiz.addEventListener('click', generateQuiz);
btnNextQuiz.addEventListener('click', generateQuiz);


// --- 学習タイマー機能（ポモドーロ対応）---
let timerInterval = null;
let timerSeconds = 0;
let pomodoroPhase = 'work'; // 'work' | 'break'
const POMODORO_WORK = 25 * 60;
const POMODORO_BREAK = 5 * 60;

const timerDisplay = document.getElementById('study-timer');
const btnTimerStart = document.getElementById('btn-timer-start');
const btnTimerStop = document.getElementById('btn-timer-stop');
const pomodoroModeCheck = document.getElementById('pomodoro-mode');
const pomodoroBadge = document.getElementById('pomodoro-badge');

function formatTime(totalSeconds) {
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function isPomodoroMode() {
    return pomodoroModeCheck && pomodoroModeCheck.checked;
}

function addStudyMinutes(minutes) {
    if (minutes <= 0) return;
    const today = new Date().toISOString().split('T')[0];
    appData.studyTime[today] = (appData.studyTime[today] || 0) + minutes;
    saveData();
    renderChart();
    generateDailyCoachAdvice(true);
}

function startPomodoroCycle() {
    pomodoroPhase = 'work';
    timerSeconds = POMODORO_WORK;
    updatePomodoroBadge();
    timerDisplay.textContent = formatTime(timerSeconds);

    timerInterval = setInterval(() => {
        timerSeconds--;
        timerDisplay.textContent = formatTime(timerSeconds);

        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            if (pomodoroPhase === 'work') {
                addStudyMinutes(25);
                pomodoroPhase = 'break';
                timerSeconds = POMODORO_BREAK;
                updatePomodoroBadge();
                new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAA').play().catch(() => {});
                alert('🍅 25分集中お疲れ様！5分休憩しよう！');
                timerInterval = setInterval(() => {
                    timerSeconds--;
                    timerDisplay.textContent = formatTime(timerSeconds);
                    if (timerSeconds <= 0) {
                        clearInterval(timerInterval);
                        timerInterval = null;
                        alert('✅ 休憩終了！次のポモドーロを始めよう！');
                        resetTimerUI();
                    }
                }, 1000);
            }
        }
    }, 1000);
}

function updatePomodoroBadge() {
    if (!pomodoroBadge) return;
    if (isPomodoroMode()) {
        pomodoroBadge.classList.remove('hidden');
        pomodoroBadge.textContent = pomodoroPhase === 'work' ? '🍅 FOCUS TIME - 25:00' : '☕ BREAK TIME - 5:00';
        pomodoroBadge.style.color = pomodoroPhase === 'work' ? 'var(--cyber-blue)' : 'var(--cyber-green)';
    } else {
        pomodoroBadge.classList.add('hidden');
    }
}

function resetTimerUI() {
    timerSeconds = 0;
    timerDisplay.textContent = '00:00:00';
    if (btnTimerStart) { btnTimerStart.disabled = false; }
    if (btnTimerStop) { btnTimerStop.disabled = true; }
    if (pomodoroBadge) pomodoroBadge.classList.add('hidden');
}

if (btnTimerStart) {
    btnTimerStart.addEventListener('click', () => {
        if (timerInterval) return;
        btnTimerStart.disabled = true;
        btnTimerStop.disabled = false;

        if (isPomodoroMode()) {
            startPomodoroCycle();
        } else {
            timerSeconds = 0;
            timerInterval = setInterval(() => {
                timerSeconds++;
                timerDisplay.textContent = formatTime(timerSeconds);
            }, 1000);
        }
    });
}

if (btnTimerStop) {
    btnTimerStop.addEventListener('click', () => {
        if (!timerInterval) return;
        clearInterval(timerInterval);
        timerInterval = null;

        if (!isPomodoroMode()) {
            const minutes = Math.ceil(timerSeconds / 60);
            if (minutes > 0) {
                addStudyMinutes(minutes);
                alert(`本日の学習時間に ${minutes} 分追加しました！お疲れ様でした！`);
            }
        } else {
            if (pomodoroPhase === 'work') {
                const minutes = Math.ceil((POMODORO_WORK - timerSeconds) / 60);
                addStudyMinutes(minutes);
            }
            alert('ポモドーロを中断しました。');
        }
        resetTimerUI();
    });
}

const btnSaveDailyGoal = document.getElementById('btn-save-daily-goal');
if (btnSaveDailyGoal) {
    btnSaveDailyGoal.addEventListener('click', () => {
        const val = parseInt(document.getElementById('daily-goal-input').value);
        if (!isNaN(val) && val >= 1) {
            appData.settings.dailyGoal = val;
            saveData();
            renderDailyGoal();
        }
    });
}


// --- 設定画面 ---
function renderSettings() {
    document.getElementById('openai-api-key').value = appData.settings.apiKey || '';
    document.getElementById('exam-date').value = appData.settings.examDate || '';
}

document.getElementById('btn-save-settings').addEventListener('click', () => {
    appData.settings.apiKey = document.getElementById('openai-api-key').value.trim();
    appData.settings.examDate = document.getElementById('exam-date').value;
    saveData();
    
    // 設定変更に伴い講師のアドバイスを更新
    generateDailyCoachAdvice(true);
    
    const msg = document.getElementById('settings-msg');
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 3000);
});

// --- AIボイスコーチ機能 (MediaRecorder + Whisper + OpenAI TTS) ---
let coachUtterance = null;
let voiceCoachHistory = [];
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isTranscribing = false;
let micStream = null;

const chatLog = document.getElementById('chat-log');
const btnMic = document.getElementById('btn-mic');
const btnStopSpeak = document.getElementById('btn-stop-speak');
const voiceTextInput = document.getElementById('voice-text-input');
const btnSendVoiceText = document.getElementById('btn-send-voice-text');
const muteVoiceCheckbox = document.getElementById('mute-voice');
const autoMicCheckbox = document.getElementById('auto-mic');
const avatarWrapper = document.getElementById('avatar-wrapper');
const coachStatus = document.getElementById('coach-status');

// マイク録音開始
async function startRecording() {
    if (isRecording) return;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];

        // webm対応チェック（Safariはmp4）
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
        mediaRecorder = new MediaRecorder(micStream, { mimeType });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
            const blob = new Blob(audioChunks, { type: mimeType });
            await transcribeWithWhisper(blob, mimeType);
        };

        mediaRecorder.start();
        isRecording = true;

        avatarWrapper.classList.add('listening');
        avatarWrapper.classList.remove('speaking');
        btnMic.classList.add('recording');
        btnMic.innerHTML = '<i class="fa-solid fa-stop"></i> 停止して送信';
        coachStatus.textContent = '🔴 録音中... もう一度押すと送信';
    } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            addMessageToLog('COACH', '⚠️ マイクが許可されていないよ！Chromeのアドレスバー左のアイコン（🔒か⚙️）をクリックして、マイクを「許可」にしてね。それまではテキスト入力欄から話しかけてね！', false);
            coachStatus.textContent = 'マイク未許可';
        } else {
            addMessageToLog('COACH', `マイクエラー: ${err.message}`, false);
            coachStatus.textContent = 'エラー';
        }
    }
}

// マイク録音停止
function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;
    isTranscribing = true;
    avatarWrapper.classList.remove('listening');
    btnMic.classList.remove('recording');
    btnMic.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 文字起こし中...';
    coachStatus.textContent = '文字起こし中...';
    try { mediaRecorder.requestData(); } catch(e) {}
    setTimeout(() => {
        try { mediaRecorder.stop(); } catch(e) {
            console.warn(e);
            resetMicButton(); // stopが失敗してもリセット
        }
    }, 100);
}

function resetMicButton() {
    isTranscribing = false;
    btnMic.disabled = false;
    btnMic.innerHTML = '<i class="fa-solid fa-microphone"></i> 話しかける';
    btnMic.classList.remove('recording');
}

// Whisper APIで文字起こし
async function transcribeWithWhisper(audioBlob, mimeType) {
    if (!appData.settings.apiKey) {
        addMessageToLog('COACH', 'APIキーが未設定です。設定タブから登録してね！', false);
        coachStatus.textContent = '待機中';
        return;
    }
    try {
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const formData = new FormData();
        formData.append('file', audioBlob, `audio.${ext}`);
        formData.append('model', 'whisper-1');
        formData.append('language', 'ja');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${appData.settings.apiKey}` },
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'Whisper error');
        }

        const data = await response.json();
        const text = (data.text || '').trim();
        resetMicButton();
        coachStatus.textContent = '待機中';

        if (text) {
            sendUserMessage(text);
        } else {
            coachStatus.textContent = '声が聞き取れなかった';
            addMessageToLog('COACH', '声が聞き取れなかったみたい。もう少し大きな声で話してみて！', false);
        }
    } catch (err) {
        console.error('Whisperエラー:', err);
        resetMicButton();
        coachStatus.textContent = 'エラー';
        addMessageToLog('COACH', `❌ 文字起こしエラー: ${err.message}`, false);
    }
}

// 再生中のAudioオブジェクト（停止用）
let currentAudio = null;
let ttsAbortController = null; // TTS通信キャンセル用

// AIコーチの音声発話 - OpenAI TTS優先、フォールバックはブラウザTTS
async function speakText(text) {
    stopSpeaking();

    if (muteVoiceCheckbox && muteVoiceCheckbox.checked) {
        return;
    }

    if (appData.settings.apiKey) {
        await speakWithOpenAI(text);
    } else {
        speakWithBrowser(text);
    }
}

async function speakWithOpenAI(text) {
    avatarWrapper.classList.add('speaking');
    avatarWrapper.classList.remove('listening');
    coachStatus.textContent = '発話中...';

    // 前のTTS通信があればキャンセル
    if (ttsAbortController) ttsAbortController.abort();
    ttsAbortController = new AbortController();
    const signal = ttsAbortController.signal;

    try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${appData.settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'tts-1',
                input: text,
                voice: 'nova',
                speed: 1.1
            }),
            signal
        });

        if (!response.ok) throw new Error('TTS API error');

        coachStatus.textContent = '発話中... (OpenAI)';
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        currentAudio = new Audio(audioUrl);

        currentAudio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudio = null;
            avatarWrapper.classList.remove('speaking');
            coachStatus.textContent = '待機中';
            // 自動マイクONはチェックボックスが有効な場合のみ
            if (autoMicCheckbox && autoMicCheckbox.checked) startRecording();
        };

        currentAudio.onerror = () => {
            avatarWrapper.classList.remove('speaking');
            coachStatus.textContent = '待機中';
        };

        await currentAudio.play();
    } catch (e) {
        if (e.name === 'AbortError') return; // キャンセルは無視
        console.warn('OpenAI TTS失敗、ブラウザTTSにフォールバック:', e);
        speakWithBrowser(text);
    }
}

function speakWithBrowser(text) {
    window.speechSynthesis.cancel();
    avatarWrapper.classList.add('speaking');
    coachStatus.textContent = '発話中...';

    coachUtterance = new SpeechSynthesisUtterance(text);
    coachUtterance.lang = 'ja-JP';
    coachUtterance.rate = 1.15;
    coachUtterance.pitch = 1.05;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
        voices.find(v => v.lang === 'ja-JP' && v.name.includes('Otoya')) ||
        voices.find(v => v.lang === 'ja-JP' && v.name.includes('Kyoko')) ||
        voices.find(v => v.lang === 'ja-JP') ||
        voices.find(v => v.lang.includes('ja'));
    if (preferredVoice) coachUtterance.voice = preferredVoice;

    coachUtterance.onend = () => {
        avatarWrapper.classList.remove('speaking');
        coachStatus.textContent = '待機中';
    };
    coachUtterance.onerror = () => {
        avatarWrapper.classList.remove('speaking');
        coachStatus.textContent = '待機中';
    };

    window.speechSynthesis.speak(coachUtterance);
}

// 発話の強制停止
function stopSpeaking() {
    // TTS通信中ならキャンセル
    if (ttsAbortController) { ttsAbortController.abort(); ttsAbortController = null; }
    window.speechSynthesis.cancel();
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (avatarWrapper) avatarWrapper.classList.remove('speaking');
    if (coachStatus && !isRecording) coachStatus.textContent = '待機中';
}

// 学習状況の要約情報をプロンプト用に取得
function getStudyStatsContext() {
    // 登録用語数
    const termsCount = appData.terms.length;
    // ストリーク日数
    const streakCount = appData.streak.count;
    
    // 直近7日間の学習時間
    let weeklyStudyMinutes = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        weeklyStudyMinutes += appData.studyTime[dateStr] || 0;
    }

    // 直近の模試スコア
    let latestScore = '未受検';
    for (let i = 5; i >= 0; i--) {
        if (appData.scores[i] !== null) {
            latestScore = `${appData.scores[i]}点`;
            break;
        }
    }

    // 分野別スコア
    const radarData = `クラウドの概念:${appData.radarScores[0]}%, セキュリティ:${appData.radarScores[1]}%, テクノロジー:${appData.radarScores[2]}%, 請求と料金:${appData.radarScores[3]}%`;

    // 試験日カウントダウン
    let countdownText = '未設定';
    if (appData.settings.examDate) {
        const today = new Date(); today.setHours(0,0,0,0);
        const diffDays = Math.ceil((new Date(appData.settings.examDate) - today) / 86400000);
        countdownText = diffDays > 0 ? `あと ${diffDays} 日` : (diffDays === 0 ? "本日が試験日" : "試験日経過");
    }

    return `
【ユーザーの学習データ】
- 試験予定日: ${appData.settings.examDate || '未設定'} (${countdownText})
- 継続ログイン日数（ストリーク）: ${streakCount}日
- 登録されたAWS用語数: ${termsCount}個
- 直近7日間の合計学習時間: ${weeklyStudyMinutes}分
- 最近の模試の最高得点: ${latestScore}
- 分野別理解度: ${radarData}
`;
}

// チャットログにメッセージを追加
function addMessageToLog(sender, text, isUser = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isUser ? 'user-msg' : 'coach-msg'}`;
    
    const senderName = isUser ? 'YOU' : 'COACH';
    const icon = isUser ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';
    
    msgDiv.innerHTML = `
        <span class="sender">${icon} ${senderName}:</span>
        <span class="text">${text}</span>
    `;
    chatLog.appendChild(msgDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// ユーザーからの発言を処理し、OpenAIにAPIリクエストを送る
async function sendUserMessage(text) {
    if (!text.trim()) return;
    
    // UI表示
    addMessageToLog('YOU', text, true);
    voiceTextInput.value = '';

    if (!appData.settings.apiKey) {
        const errMsg = '設定画面でOpenAI API Keyを設定してください。';
        addMessageToLog('COACH', errMsg);
        speakText(errMsg);
        return;
    }

    // 一時的な思考ステータス
    coachStatus.textContent = '思考中...';
    
    try {
        const apiKey = appData.settings.apiKey;
        const url = 'https://api.openai.com/v1/chat/completions';
        
        // 講師のキャラクターと学習コンテキストを設定
        const systemPrompt = `あなたはAWSクラウドプラクティショナー試験の専任コーチです。友達みたいにフランクに、でも的確にサポートしてください。

${getStudyStatsContext()}

【話し方のルール】
- 友達っぽい自然なしゃべり口調で。「〜だよ」「〜じゃん」「いい感じ！」など。敬語不要。
- 音声で読み上げるので、記号や箇条書きは使わない。文章で話す感じで。
- 1〜3文の短い返答にまとめる。長々と説明しない。
- ユーザーの学習データを見て、具体的な一言アドバイスを必ず入れる。`;

        // チャット履歴の構築 (直近10往復)
        const messages = [
            { role: 'system', content: systemPrompt }
        ];
        
        voiceCoachHistory.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });
        
        messages.push({ role: 'user', content: text });

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: messages,
                max_tokens: 300,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'API通信エラー');
        }

        const data = await response.json();
        const reply = data.choices[0].message.content.trim();

        // 履歴の更新
        voiceCoachHistory.push({ role: 'user', content: text });
        voiceCoachHistory.push({ role: 'assistant', content: reply });
        if (voiceCoachHistory.length > 20) voiceCoachHistory.splice(0, 2); // 10往復分に制限

        // UI表示＆発話
        addMessageToLog('COACH', reply);
        speakText(reply);

    } catch (error) {
        console.error(error);
        const errMsg = 'すみません、通信が乱れてうまく考えがまとまりませんでした。もう一度話しかけてみてください！';
        addMessageToLog('COACH', errMsg);
        speakText(errMsg);
    }
}

// 初回のみ歓迎メッセージ（チャット履歴は保持）
let voiceCoachVisited = false;
function initVoiceCoachWelcome() {
    if (voiceCoachVisited) {
        stopSpeaking(); // 戻ったとき余計な音声を止める
        return;
    }
    voiceCoachVisited = true;
    const welcomeMsg = `こんにちは！AWS専任コーチだよ。試験合格に向けて全力でサポートするね！ストリーク${appData.streak.count}日、用語${appData.terms.length}個登録済み。何か質問ある？`;
    addMessageToLog('COACH', welcomeMsg);
    speakText(welcomeMsg);
}

// --- AI個別塾講師のダッシュボードアドバイス機能 ---
let lastAdviceStats = "";

async function generateDailyCoachAdvice(force = false) {
    const adviceContentEl = document.getElementById('coach-advice-content');
    if (!adviceContentEl) return;

    if (!appData.settings.apiKey) {
        adviceContentEl.innerHTML = '<p class="text-muted">設定画面でOpenAI API Keyを設定してください。APIキーを設定すると、本日の学習進捗に応じたAI個別塾講師からのアドバイスがここに表示されます。</p>';
        return;
    }

    // 学習データが前回から変わっていなければ、不要なAPI通信を避けるためにキャッシュを利用する（forceフラグ時は強制再生成）
    const currentStats = getStudyStatsContext();
    if (!force && lastAdviceStats === currentStats && adviceContentEl.innerHTML !== "" && !adviceContentEl.querySelector('.fa-spin')) {
        return; 
    }

    adviceContentEl.innerHTML = '<p class="text-muted"><i class="fa-solid fa-circle-notch fa-spin"></i> AI個別塾講師が本日の学習データを分析し、アドバイスを生成中...</p>';

    try {
        const apiKey = appData.settings.apiKey;
        const url = 'https://api.openai.com/v1/chat/completions';
        
        const prompt = `あなたはAWS認定クラウドプラクティショナー(CLF)の個別指導塾の講師です。
以下の「ユーザーの現在の学習データ」を分析し、今日の学習に対する温かいフィードバック、激励の言葉、および今日やるべき具体的なアドバイス（2〜3文程度、150文字以内）を簡潔に述べてください。
（例：タイマー時間が増えていたら「素晴らしい努力！」、用語図鑑が少なければ「今日中にあと2つ用語を登録しよう！」、特定の分野が低ければ「セキュリティについて復習しよう！」など）

${currentStats}

【回答ルール】
- 親しみやすく熱血で、ユーザーを励ます先生の口調（「〜だよ」「〜だね！」など）にしてください。
- 150文字以内で、要点を絞って簡潔に記述してください。
- マークダウンの太字（**テキスト**）などを用いて、重要なポイントを際立たせてください。`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 250,
                temperature: 0.7
            })
        });

        if (!response.ok) throw new Error('API通信エラー');
        const data = await response.json();
        const advice = data.choices[0].message.content.trim();

        adviceContentEl.innerHTML = `<div style="font-size: 0.95rem; line-height: 1.6;">${marked(advice)}</div>`;
        lastAdviceStats = currentStats; // キャッシュ用ステータス更新
    } catch (error) {
        console.error(error);
        adviceContentEl.innerHTML = '<p class="text-muted" style="color: var(--cyber-red);"><i class="fa-solid fa-triangle-exclamation"></i> アドバイスの生成に失敗しました。再分析ボタンを押すか、API設定を確認してください。</p>';
    }
}

// 音声コーチ初期化
function initVoiceCoach() {
    resetMicButton(); // 初期化時に確実にリセット

    btnMic.addEventListener('click', () => {
        if (isTranscribing) return; // 文字起こし中は無視
        stopSpeaking();
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    btnStopSpeak.addEventListener('click', () => {
        stopSpeaking();
        if (isRecording) stopRecording();
    });

    btnSendVoiceText.addEventListener('click', () => {
        const text = voiceTextInput.value.trim();
        if (text) {
            stopSpeaking();
            sendUserMessage(text);
        }
    });

    voiceTextInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = voiceTextInput.value.trim();
            if (text) {
                stopSpeaking();
                sendUserMessage(text);
            }
        }
    });

    // 再分析ボタンのイベントハンドラ追加
    const btnRefreshAdvice = document.getElementById('btn-refresh-advice');
    if (btnRefreshAdvice) {
        btnRefreshAdvice.addEventListener('click', () => {
            generateDailyCoachAdvice(true);
        });
    }
}

// --- 初期化実行 ---
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    renderDashboard();
    renderDictionary();
    initVoiceCoach();
});
