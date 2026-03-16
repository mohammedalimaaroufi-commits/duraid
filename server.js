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

// 1. إعداد المجلد العام لخدمة الملفات الساكنة (CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// 2. توجيه الروابط بناءً على هيكل مجلداتك الفعلي
// رابط الطلاب: يفتح ملف player.html الموجود داخل مجلد candidat
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/candidat/player.html'));
});

// رابط لوحة التحكم: يفتح ملف admin.html الموجود داخل مجلد admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/admin.html'));
});

// رابط شاشة العرض الكبيرة
app.get('/presenter', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/presenter.html'));
});

// ────────────────────────────────────────────────
// الحالة العامة للعبة (保持 الحالة كما هي لضمان عمل الوظائف)
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
  console.log(`[connexion] ${socket.id}`);

  if (gameState.currentQuestion) {
    socket.emit('next-question', gameState.currentQuestion);
  }

  if (gameState.revealedAnswer !== null) {
    socket.emit('reveal-answer', gameState.revealedAnswer);
  }

  broadcastGameState();

  socket.on('join-game', (name) => {
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      socket.emit('error', 'الاسم قصير جداً');
      return;
    }
    const cleanName = name.trim().slice(0, 20);
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    gameState.players.push({ id: socket.id, name: cleanName, score: 0, answered: false });
    
    broadcastPlayersList();
    broadcastLeaderboard();
    broadcastGameState();
  });

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

  socket.on('reveal-answer', () => {
    if (!gameState.currentQuestion || gameState.status !== 'playing') return;

    gameState.revealedAnswer = gameState.currentQuestion.question.answer;
    gameState.status = 'revealing';

    io.emit('reveal-answer', gameState.revealedAnswer);
    broadcastLeaderboard();
    broadcastGameState();
  });

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

  socket.on('request-current-question', () => {
    if (gameState.currentQuestion) {
      socket.emit('next-question', gameState.currentQuestion);
    }
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

// 3. المنفذ الخاص بـ Koyeb (يستخدم 8000 افتراضياً)
const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 السيرفر يعمل بنجاح على المنفذ ${PORT}`);
});