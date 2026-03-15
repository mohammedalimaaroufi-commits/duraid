const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: { origin: "*" } // À sécuriser en production → limiter les origines
});

// 1. قم بتغيير هذا السطر ليعمل من المجلد الرئيسي مباشرة
app.use(express.static(__dirname)); 

// 2. أضف هذا المسار للتأكد من أن الصفحة الرئيسية تفتح دائماً
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. تأكد من أن المنفذ يقرأ إعدادات Koyeb (المنفذ 8000)
const PORT = process.env.PORT || 8000; 
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur Quiz démarré sur port ${PORT}`);
});
// ────────────────────────────────────────────────
// État global du jeu
const gameState = {
  currentQuestion: null,        // { question, timer, index, total }
  questionStartTime: 0,
  currentQuestionIndex: -1,
  status: 'waiting',            // waiting | playing | revealing | finished
  players: [],                  // [{ id, name, score, answered }]
  answers: new Map(),           // socket.id → choix du joueur
  revealedAnswer: null          // index de la bonne réponse une fois révélée
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

  // 1. Envoyer immédiatement l'état actuel au nouveau connecté
  if (gameState.currentQuestion) {
    console.log(`[envoi auto] Question #${gameState.currentQuestionIndex + 1} → ${socket.id}`);
    socket.emit('next-question', gameState.currentQuestion);
  }

  if (gameState.revealedAnswer !== null) {
    socket.emit('reveal-answer', gameState.revealedAnswer);
  }

  broadcastGameState();

  // ── Joueur rejoint ──────────────────────────────────────────────
  socket.on('join-game', (name) => {
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      socket.emit('error', 'Nom invalide (minimum 2 caractères)');
      return;
    }

    const cleanName = name.trim().slice(0, 20);

    // Éviter doublon sur le même socket
    gameState.players = gameState.players.filter(p => p.id !== socket.id);

    gameState.players.push({
      id: socket.id,
      name: cleanName,
      score: 0,
      answered: false
    });

    console.log(`[join] ${cleanName} (${socket.id}) - Total: ${gameState.players.length}`);
    broadcastPlayersList();
    broadcastLeaderboard();
    broadcastGameState();
  });

  // ── Admin lance une nouvelle question ───────────────────────────
  socket.on('send-question', (data) => {
    if (!data?.question?.text || !Array.isArray(data.question.options) || data.question.answer == null) {
      socket.emit('error', 'Format de question invalide');
      return;
    }

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

    // Reset des réponses pour la nouvelle question
    gameState.players.forEach(p => p.answered = false);
    gameState.answers.clear();

    console.log(`[nouvelle question #${data.index + 1}] ${data.question.text.slice(0, 50)}...`);

    io.emit('next-question', gameState.currentQuestion);
    broadcastGameState();
  });

  // ── Admin révèle la bonne réponse ──────────────────────────────
  socket.on('reveal-answer', () => {
    if (!gameState.currentQuestion) return;
    if (gameState.status !== 'playing') return;

    const correctIndex = gameState.currentQuestion.question.answer;
    gameState.revealedAnswer = correctIndex;
    gameState.status = 'revealing';

    console.log(`[reveal] Bonne réponse : ${correctIndex}`);

    io.emit('reveal-answer', correctIndex);
    // Très important : diffuser le classement juste après la révélation
    io.emit('update-leaderboard', getSortedLeaderboard());
    broadcastGameState();
  });

  // ── Joueur soumet sa réponse ────────────────────────────────────
  socket.on('submit-answer', (choiceIndex) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;
    if (gameState.status !== 'playing') return;
    if (player.answered) return;

    const isCorrect = Number(choiceIndex) === gameState.currentQuestion?.question?.answer;

    if (isCorrect) {
      const elapsed = (Date.now() - gameState.questionStartTime) / 1000;
      const maxTime = gameState.currentQuestion.timer;
      const timeBonus = Math.max(0, Math.round((maxTime - elapsed) * 10));
      player.score += 100 + timeBonus;
    }

    player.answered = true;
    gameState.answers.set(socket.id, Number(choiceIndex));

    console.log(`[réponse] ${player.name} → ${choiceIndex} (${isCorrect ? 'correct' : 'faux'})`);

    broadcastLeaderboard();
  });

  // ── Demande manuelle de la question courante (écran géant) ──────
  socket.on('request-current-question', () => {
    if (gameState.currentQuestion) {
      socket.emit('next-question', gameState.currentQuestion);
      if (gameState.revealedAnswer !== null) {
        socket.emit('reveal-answer', gameState.revealedAnswer);
      }
      console.log(`[réémission demandée] → ${socket.id}`);
    } else {
      socket.emit('next-question', null);
    }
  });

  // ── Demande explicite du classement (utilisé par presenter.html) ─
  socket.on('request-leaderboard', () => {
    socket.emit('update-leaderboard', getSortedLeaderboard());
    console.log(`[demande classement] → ${socket.id}`);
  });

  // ── Déconnexion ─────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[déconnexion] ${socket.id}`);

    const wasPlayer = gameState.players.some(p => p.id === socket.id);

    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    gameState.answers.delete(socket.id);

    if (wasPlayer) {
      broadcastPlayersList();
      broadcastLeaderboard();
    }
  });
});

// ── Fonction de reset complet (optionnel, à appeler depuis admin si besoin) ──
function resetGame() {
  gameState.players = [];
  gameState.currentQuestion = null;
  gameState.questionStartTime = 0;
  gameState.currentQuestionIndex = -1;
  gameState.status = 'waiting';
  gameState.revealedAnswer = null;
  gameState.answers.clear();

  io.emit('game-reset');
  broadcastPlayersList();
  broadcastLeaderboard();
  broadcastGameState();
  console.log('[reset] Jeu complètement réinitialisé');
}

// ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n┌─────────────────────────────────────────────┐`);
  console.log(`│   Serveur Quiz démarré sur port ${PORT}       │`);
  console.log(`│   → http://localhost:${PORT}                  │`);
  console.log(`└─────────────────────────────────────────────┘\n`);
});