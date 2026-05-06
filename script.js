// --- データ管理 ---
const STORAGE_KEY = 'clf_wiki_data';
let appData = {
    terms: [], // { id, name, ref, desc, category, createdAt, nextReviewDate }
    scores: [null, null, null, null, null, null],
    radarScores: [0, 0, 0, 0], // 分野別スコア
    studyTime: {}, // 追加: { 'YYYY-MM-DD': 分 }
    settings: {
        apiKey: '',
        examDate: ''
    },
    milestones: [false, false, false, false],
    streak: { count: 0, lastLogin: '' }
};

// 初期ロード
function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        appData = JSON.parse(saved);
        // 古いデータへの互換性対応
        if (!appData.settings) appData.settings = { apiKey: '', examDate: '' };
        if (!appData.studyTime) appData.studyTime = {};
        if (!appData.radarScores) appData.radarScores = [0, 0, 0, 0];
        appData.terms.forEach(t => {
            if (!t.category) t.category = 'Other';
        });
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
        if (targetId === 'quiz') resetQuizUI(); // クイズ画面を開いた時はUIリセット
    });
});

// --- API通信用 共通モデル取得関数 ---
async function getGeminiModel(apiKey) {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const listRes = await fetch(listUrl);
    if (!listRes.ok) {
        const err = await listRes.json();
        throw new Error('APIキーの認証に失敗しました。: ' + (err.error?.message || ''));
    }
    const listData = await listRes.json();
    const models = listData.models || [];
    const validModels = models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent') && m.name.includes('gemini'));
    if (validModels.length === 0) throw new Error('利用可能なGeminiモデルが見つかりませんでした。');
    
    return validModels.find(m => m.name.includes('1.5-flash')) || 
           validModels.find(m => m.name.includes('1.5-pro')) || 
           validModels.find(m => m.name.includes('1.0-pro')) || validModels[0];
}

// --- 用語の自動解説＆カテゴリ判定 (JSON出力要求) ---
async function generateExplanationWithGemini(term) {
    if (!appData.settings.apiKey) throw new Error('設定画面でGemini API Keyを設定してください。');
    const apiKey = appData.settings.apiKey;

    try {
        const targetModel = await getGeminiModel(apiKey);
        const url = `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${apiKey}`;
        
        // JSON出力のためのプロンプト工夫
        const prompt = `あなたはAWS認定クラウドプラクティショナー試験の優秀な講師です。以下のAWS用語について解説し、さらに適切なカテゴリを分類してください。
用語: ${term}
以下のJSON形式のみで出力してください（マークダウンのコードブロックは不要です）：
{
  "category": "Compute, Storage, Database, Network, Security, または Other から1つ選択",
  "explanation": "初学者向けに「どんなサービスか」「試験で問われやすいポイント」を簡潔に（200文字程度で、見出しや箇条書きを用いて）説明したもの"
}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" } // JSON出力を強制
            })
        });

        if (!response.ok) throw new Error('API通信エラーが発生しました');
        const data = await response.json();
        let resultText = data.candidates[0].content.parts[0].text;
        
        // コードブロックが含まれている場合は除去
        resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
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
            const aiResult = await generateExplanationWithGemini(name);
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
    if (!appData.settings.apiKey) return alert('設定画面でGemini API Keyを設定してください。');
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
        const targetModel = await getGeminiModel(apiKey);
        const url = `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${apiKey}`;
        
        const prompt = `あなたはAWS認定クラウドプラクティショナー試験の問題作成者です。以下のAWS用語に関する「4択クイズ」を1問作成してください。
対象用語: ${targetTerm.name}
解説: ${targetTerm.desc}

出力は以下のJSONフォーマットのみにしてください（コードブロックは不要です）:
{
  "question": "問題文（このサービスは何をするものか、などの問い）",
  "options": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
  "correctIndex": 正解のインデックス番号(0〜3の整数),
  "explanation": "正解の理由の短い解説"
}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        if (!response.ok) throw new Error('APIエラーが発生しました');
        const data = await response.json();
        let resultText = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
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


// --- 学習タイマー機能 ---
let timerInterval = null;
let timerSeconds = 0;

const timerDisplay = document.getElementById('study-timer');
const btnTimerStart = document.getElementById('btn-timer-start');
const btnTimerStop = document.getElementById('btn-timer-stop');

function formatTime(totalSeconds) {
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

btnTimerStart.addEventListener('click', () => {
    if (timerInterval) return;
    btnTimerStart.disabled = true;
    btnTimerStop.disabled = false;
    timerInterval = setInterval(() => {
        timerSeconds++;
        timerDisplay.textContent = formatTime(timerSeconds);
    }, 1000);
});

btnTimerStop.addEventListener('click', () => {
    if (!timerInterval) return;
    clearInterval(timerInterval);
    timerInterval = null;
    
    // 分単位に変換（1分未満でも学習したなら1分としてカウント）
    const minutes = Math.ceil(timerSeconds / 60);
    
    if (minutes > 0) {
        const today = new Date().toISOString().split('T')[0];
        appData.studyTime[today] = (appData.studyTime[today] || 0) + minutes;
        saveData();
        renderChart();
        alert(`本日の学習時間に ${minutes} 分追加しました！お疲れ様でした！`);
    }
    
    timerSeconds = 0;
    timerDisplay.textContent = formatTime(timerSeconds);
    btnTimerStart.disabled = false;
    btnTimerStop.disabled = true;
});


// --- 設定画面 ---
function renderSettings() {
    document.getElementById('gemini-api-key').value = appData.settings.apiKey;
    document.getElementById('exam-date').value = appData.settings.examDate;
}

document.getElementById('btn-save-settings').addEventListener('click', () => {
    appData.settings.apiKey = document.getElementById('gemini-api-key').value.trim();
    appData.settings.examDate = document.getElementById('exam-date').value;
    saveData();
    
    const msg = document.getElementById('settings-msg');
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 3000);
});

// --- 初期化実行 ---
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    renderDashboard();
    renderDictionary();
});
