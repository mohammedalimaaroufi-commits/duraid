const socket = io();
let questions = [];
let currentQuestionIndex = 0;
let timerInterval = null;
let lastLeaderboardData = []; // تخزين آخر بيانات الترتيب لضمان عمل المنصة

// العناصر
const btnSetup = document.getElementById('btn-setup');
const btnStart = document.getElementById('btn-start');
const fileInput = document.getElementById('file-input');
const timerInput = document.getElementById('timer-input');
const settingsSection = document.getElementById('settings-section');
const dashboardSection = document.getElementById('dashboard-section');
const podiumSection = document.getElementById('podium-section');
// أضف بعد btnStart
const btnPresent = document.createElement('button');
btnPresent.innerText = '🎥 عرض على شاشة كبيرة (Full Screen)';
btnPresent.className = 'btn-success-cinematic';
btnPresent.style.marginLeft = '20px';
btnPresent.style.background = 'linear-gradient(45deg, #e94560, #ff6b6b)';
document.querySelector('.control-header').appendChild(btnPresent);

btnPresent.addEventListener('click', () => {
    const win = window.open('presenter.html', '_blank', 'fullscreen=yes');
    // أو إذا أردت نفس النافذة: location.href = 'presenter.html';
});
// 1. تحميل ملف الأسئلة
btnSetup.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file) return alert("الرجاء اختيار ملف JSON!");

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            questions = JSON.parse(e.target.result);
            settingsSection.style.display = "none";
            dashboardSection.style.display = "block";
        } catch (err) {
            alert("خطأ في تنسيق الملف! تأكد من أنه ملف JSON صحيح.");
        }
    };
    reader.readAsText(file);
});

// 2. إدارة زر التشغيل والمنصة
btnStart.addEventListener('click', () => {
    if (btnStart.getAttribute('data-action') === 'show-podium') {
        showPodium();
        return;
    }

    if (currentQuestionIndex < questions.length) {
        startQuestionCycle();
    }
});

function startQuestionCycle() {
    btnStart.disabled = true;
    document.getElementById('correct-answer-alert').style.display = "none";
    document.getElementById('active-question-container').style.display = "block";
    
    const currentQ = questions[currentQuestionIndex];
    const timeLimit = parseInt(timerInput.value) || 15;

    document.getElementById('display-q-text').innerText = currentQ.text;
    document.getElementById('display-options').innerHTML = currentQ.options
        .map((opt, i) => `<div class="opt-item" id="opt-${i}">${opt}</div>`).join('');

    socket.emit('send-question', {
        question: currentQ,
        timer: timeLimit,
        index: currentQuestionIndex,
        total: questions.length
    });

    startAdminTimer(timeLimit, currentQ);
}

function startAdminTimer(seconds, question) {
    let timeLeft = seconds;
    const timerDisplay = document.getElementById('admin-timer');
    timerDisplay.innerText = timeLeft;

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            handleTimeUp(question);
        }
    }, 1000);
}

function handleTimeUp(question) {
    // انتظار 6 ثوانٍ للتشويق
    setTimeout(() => {
        const correctIdx = question.answer;
        document.getElementById('answer-text').innerText = question.options[correctIdx];
        document.getElementById('correct-answer-alert').style.display = "block";
        
        const opt = document.getElementById(`opt-${correctIdx}`);
        if(opt) { 
            opt.style.background = "#4ecca3"; 
            opt.style.color = "#050505"; 
            opt.style.fontWeight = "bold";
        }

        currentQuestionIndex++;
        btnStart.disabled = false;

        if (currentQuestionIndex < questions.length) {
            btnStart.innerText = `إطلاق السؤال ${currentQuestionIndex + 1}`;
        } else {
            btnStart.innerText = "عرض النتائج النهائية 🏆";
            btnStart.setAttribute('data-action', 'show-podium');
            btnStart.style.borderColor = "#ffd700";
            btnStart.style.color = "#ffd700";
            btnStart.classList.add('btn-gold-glow'); 
        }
    }, 6000); 
}

// 3. عرض المنصة النهائية (الإصلاح الجذري هنا)
function showPodium() {
    if (lastLeaderboardData.length === 0) {
        alert("لا يوجد متسابقون لعرضهم!");
        return;
    }

    dashboardSection.style.display = "none";
    podiumSection.style.display = "block";

    const podiumDisplay = document.getElementById('podium-display');
    
    // ترتيب العرض الجمالي: الثاني (يسار)، الأول (منتصف)، الثالث (يمين)
    const podiumLayout = [
        { data: lastLeaderboardData[1], class: 'rank-2', label: '٢' },
        { data: lastLeaderboardData[0], class: 'rank-1', label: '١' },
        { data: lastLeaderboardData[2], class: 'rank-3', label: '٣' }
    ];

    podiumDisplay.innerHTML = podiumLayout.map(item => {
        if (!item.data) return `<div class="podium-item empty"></div>`; // مكان فارغ إذا قل المتسابقون عن 3
        return `
            <div class="podium-item ${item.class}">
                <div class="podium-name">${item.data.name}</div>
                <div class="podium-score">${item.data.score} نقطة</div>
                <div class="podium-rank">${item.label}</div>
            </div>
        `;
    }).join('');
}

// استلام تحديثات السوكيت
socket.on('update-player-list', (players) => {
    document.getElementById('player-count').innerText = players.length;
    document.getElementById('player-list').innerHTML = players.map(p => `<li>${p.name} ✅</li>`).join('');
});

socket.on('update-leaderboard', (leaderboard) => {
    lastLeaderboardData = leaderboard; // حفظ البيانات للمنصة
    const tbody = document.querySelector('#leaderboard-table tbody');
    if (!tbody) return;
    tbody.innerHTML = leaderboard.map((p, i) => `
        <tr class="${i === 0 ? 'first-place' : ''}">
            <td>${i+1}</td>
            <td>${p.name}</td>
            <td>${p.score}</td>
        </tr>
    `).join('');
});