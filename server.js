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

// 1. إعداد المجلد العام
app.use(express.static(path.join(__dirname, 'public')));

// 2. توجيه الروابط
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/candidat/player.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/admin.html'));
});

app.get('/presenter', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/presenter.html'));
});

// الحالة العامة للعبة
let gameState = {
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

  // --- أزرار الإدارة (يجب أن تكون داخل اتصال السوكيت) ---
  
  // 1. إعادة تشغيل السيرفر بالكامل
  socket.on('admin-restart-server', () => {
    console.log('⚠️ طلب إعادة تشغيل السيرفر من الأدمن...');
    process.exit(0); 
  });

  // 2. تصفير اللعبة وإعادة ضبط الحالة
  socket.on('admin-reset-game', () => {
    console.log('🔄 إعادة ضبط اللعبة...');
    gameState = {
      currentQuestion: null,
      questionStartTime: 0,
      currentQuestionIndex: -1,
      status: 'waiting',
      players: [],
      answers: new Map(),
      revealedAnswer: null
    };
    io.emit('force-reload'); // إجبار الجميع على تحديث الصفحة
  });

  // ------------------------------------------------

  if (gameState.currentQuestion) {
    socket.emit('next-question', gameState.currentQuestion);
  }

  broadcastGameState();

  socket.on('join-game', (name) => {
    if (!name || name.trim().length < 2) return;
    const cleanName = name.trim().slice(0, 20);
    gameState.players.push({ id: socket.id, name: cleanName, score: 0, answered: false });
    broadcastPlayersList();
    broadcastLeaderboard();
  });

  socket.on('send-question', (data) => {
    gameState.currentQuestion = {
      question: data.question,
      timer: Number(data.timer) || 15,
      index: data.index,
      total: data.total
    };
    gameState.questionStartTime = Date.now();
    gameState.status = 'playing';
    gameState.revealedAnswer = null;
    gameState.players.forEach(p => p.answered = false);
    io.emit('next-question', gameState.currentQuestion);
  });

  socket.on('reveal-answer', () => {
    if (!gameState.currentQuestion) return;
    gameState.revealedAnswer = gameState.currentQuestion.question.answer;
    gameState.status = 'revealing';
    io.emit('reveal-answer', gameState.revealedAnswer);
  });

  socket.on('submit-answer', (choiceIndex) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || gameState.status !== 'playing' || player.answered) return;
    const isCorrect = Number(choiceIndex) === gameState.currentQuestion?.question?.answer;
    if (isCorrect) {
      const elapsed = (Date.now() - gameState.questionStartTime) / 1000;
      const timeBonus = Math.max(0, Math.round((gameState.currentQuestion.timer - elapsed) * 10));
      player.score += 100 + timeBonus;
    }
    player.answered = true;
    broadcastLeaderboard();
  });

  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    broadcastPlayersList();
    broadcastLeaderboard();
  });
});

const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});