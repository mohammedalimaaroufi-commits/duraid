const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: { origin: "*" } 
});

// 1. إعداد المجلد العام للملفات الساكنة (CSS, JS, Images)
app.use(express.static(path.join(__dirname, 'public')));

// 2. تعريف المسارات (Routes) للوصول للصفحات من المجلدات الفرعية
// رابط الطلاب (Candidat)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/candidat/index.html'));
});

// رابط لوحة التحكم (Admin)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/admin.html'));
});

// رابط شاشة العرض الكبيرة (Presenter)
app.get('/presenter', (req, res) => {
  // إذا كان الملف داخل public مباشرة أو داخل مجلد فرعي، تأكد من المسار هنا
  res.sendFile(path.join(__dirname, 'public/presenter.html'));
});

// ────────────────────────────────────────────────
// الحالة العامة للعبة (GameState)
const gameState = {
  currentQuestion: null,
  questionStartTime: 0,
  currentQuestionIndex: -1,
  status: 'waiting',
  players: [],
  answers: new Map(),
  revealedAnswer: null
};

// ── Helpers ───────────────────────────────────────────────────────
function getSortedLeaderboard() {
  return [...gameState.players]
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));
}

function broadcastPlayersList() {
  io.emit('update-player-list', gameState.players.map(p => ({ name: p.name })));
}

function broadcastLeaderboard() {
  io.emit('update-leaderboard', getSortedLeaderboard());
}

function broadcastGameState() {
  io.emit('game-state', {
    status: gameState.status,
    currentQuestionIndex: gameState.currentQuestionIndex,
    totalQuestions: gameState.currentQuestion?.total || 0,
    revealedAnswer: gameState.revealedAnswer
  });
}

// ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[متصل] ${socket.id}`);

  if (gameState.currentQuestion) {
    socket.emit('next-question', gameState.currentQuestion);
  }
  if (gameState.revealedAnswer !== null) {
    socket.emit('reveal-answer', gameState.revealedAnswer);
  }
  broadcastGameState();

  // انضمام لاعب
  socket.on('join-game', (name) => {
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      socket.emit('error', 'الاسم غير صالح');
      return;
    }
    const cleanName = name.trim().slice(0, 20);
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    gameState.players.push({ id: socket.id, name: cleanName, score: 0, answered: false });
    
    broadcastPlayersList();
    broadcastLeaderboard();
    broadcastGameState();
  });

  // إرسال سؤال
  socket.on('send-question', (data) => {
    if (!data?.question?.text) return;

    gameState.currentQuestion = {
      question: data.question,
      timer: Number(data.timer) || 15,
      index: data.index,
      total: data.total
    };

    gameState.questionStartTime = Date.now();
    gameState.currentQuestionIndex = data.index;
    gameState.status = 'playing';
    gameState.revealedAnswer = null;

    gameState.players.forEach(p => p.answered = false);
    gameState.answers.clear();

    io.emit('next-question', gameState.currentQuestion);
    broadcastGameState();
  });

  // كشف الإجابة
  socket.on('reveal-answer', () => {
    if (!gameState.currentQuestion || gameState.status !== 'playing') return;

    gameState.revealedAnswer = gameState.currentQuestion.question.answer;
    gameState.status = 'revealing';

    io.emit('reveal-answer', gameState.revealedAnswer);
    broadcastLeaderboard();
    broadcastGameState();
  });

  // استقبال الإجابات
  socket.on('submit-answer', (choiceIndex) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || gameState.status !== 'playing' || player.answered) return;

    const isCorrect = Number(choiceIndex) === gameState.currentQuestion?.question?.answer;

    if (isCorrect) {
      const elapsed = (Date.now() - gameState.questionStartTime) / 1000;
      const maxTime = gameState.currentQuestion.timer;
      const timeBonus = Math.max(0, Math.round((maxTime - elapsed) * 10));
      player.score += 100 + timeBonus;
    }

    player.answered = true;
    gameState.answers.set(socket.id, Number(choiceIndex));
    broadcastLeaderboard();
  });

  socket.on('request-leaderboard', () => {
    socket.emit('update-leaderboard', getSortedLeaderboard());
  });

  socket.on('disconnect', () => {
    const wasPlayer = gameState.players.some(p => p.id === socket.id);
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (wasPlayer) {
      broadcastPlayersList();
      broadcastLeaderboard();
    }
  });
});

// 3. تشغيل الخادم على منفذ Koyeb (8000) أو المنفذ الديناميكي
const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 السيرفر جاهز على المنفذ ${PORT}`);
});