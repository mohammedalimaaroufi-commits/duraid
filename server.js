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

// إعداد المسارات لتعمل على السيرفر (Koyeb/Render)
app.use(express.static(__dirname)); 

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ────────────────────────────────────────────────
// État global du jeu (الحفاظ على حالة اللعبة كاملة)
const gameState = {
  currentQuestion: null,        
  questionStartTime: 0,
  currentQuestionIndex: -1,
  status: 'waiting',            
  players: [],                  
  answers: new Map(),           
  revealedAnswer: null          
};

// ── Helpers (الوظائف المساعدة كما هي) ───────────────────────────────
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
      socket.emit('error', 'Nom invalide');
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
    const correctIndex = gameState.currentQuestion.question.answer;
    gameState.revealedAnswer = correctIndex;
    gameState.status = 'revealing';
    io.emit('reveal-answer', correctIndex);
    io.emit('update-leaderboard', getSortedLeaderboard());
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
      if (gameState.revealedAnswer !== null) socket.emit('reveal-answer', gameState.revealedAnswer);
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

// ── الإعداد النهائي للمنفذ (المتوافق مع Koyeb و Local) ──────────────
const PORT = process.env.PORT || 8000; 
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur Quiz démarré sur port ${PORT}`);
});