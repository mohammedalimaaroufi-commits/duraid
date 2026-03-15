const socket = io();

// Éléments UI
const loginScreen = document.getElementById('login-screen');
const waitingScreen = document.getElementById('waiting-screen');
const questionScreen = document.getElementById('question-screen');
const btnJoin = document.getElementById('btn-join');
const optionsContainer = document.getElementById('options-container');
const feedbackMsg = document.getElementById('feedback-msg');

let timerInterval = null;

// 1. REJOINDRE LA PARTIE
btnJoin.addEventListener('click', () => {
    const name = document.getElementById('username').value.trim();
    if (name.length < 2) return alert("Nom trop court !");

    socket.emit('join-game', name);
    
    document.getElementById('display-name').innerText = name;
    loginScreen.style.display = "none";
    waitingScreen.style.display = "flex";
});

// 2. RÉCEPTION D'UNE NOUVELLE QUESTION
socket.on('next-question', (data) => {
    // Nettoyage et affichage
    waitingScreen.style.display = "none";
    questionScreen.style.display = "block";
    feedbackMsg.style.display = "none";
    optionsContainer.innerHTML = "";
    
    document.getElementById('question-text').innerText = data.question.text;
    document.getElementById('question-counter').innerText = `Question ${data.index + 1}/${data.total}`;

    // Génération des boutons d'options
    data.question.options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.innerText = opt;
        btn.className = "btn-option";
        btn.onclick = () => submitAnswer(index);
        optionsContainer.appendChild(btn);
    });

    startTimer(data.timer);
});

// 3. ENVOI DE LA RÉPONSE
function submitAnswer(index) {
    // Désactiver tous les boutons immédiatement
    const allBtns = document.querySelectorAll('.btn-option');
    allBtns.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('disabled');
    });

    // Mettre en évidence le choix sélectionné
    allBtns[index].classList.add('selected');

    // Envoyer au serveur
    socket.emit('submit-answer', index);
    
    // Afficher un message de confirmation
    feedbackMsg.style.display = "block";
}

// 4. GESTION DU CHRONO CLIENT
function startTimer(duration) {
    let timeLeft = duration;
    const timerDisplay = document.getElementById('timer-display');
    timerDisplay.innerText = timeLeft;
    timerDisplay.style.color = "white";

    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = timeLeft;

        if (timeLeft <= 5) timerDisplay.style.color = "#e94560"; // Alerte rouge

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            disableAllButtons(); // Bloquer si le temps est écoulé
        }
    }, 1000);
}

function disableAllButtons() {
    const allBtns = document.querySelectorAll('.btn-option');
    allBtns.forEach(btn => btn.disabled = true);
}