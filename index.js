import http from "http";
import { Server } from "socket.io";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import cors from "cors";
import ip from "ip";

// Charger les variables d'environnement
dotenv.config();

const mongoDb_uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}/${process.env.DB_NAME}${process.env.DB_OPTIONS}`;

// Vérification de la configuration
if (!mongoDb_uri) {
  console.error("L'URI MongoDB n'est pas défini dans les variables d'environnement");
  process.exit(1);
}

let dbConnection;
let clientCount = 0;
const clients = {};
const scores = {};
const MAX_PLAYERS = 2; // Nombre maximum de joueurs autorisés
const MIN_PLAYERS = 2; // Nombre minimum de joueurs pour démarrer le jeu
const MAX_ROUNDS = 5; // Nombre maximum de manches
let currentRound = 0;
const POSITIONS = ["verticale", "horizontale", "diagonale", "selfie"];
let gameStarted = false;
let gameTimeout;

/**
 * Vérifie si le nombre minimum de joueurs est atteint pour démarrer le jeu
 */
function checkAndStartGame() {
  if (Object.keys(clients).length >= MIN_PLAYERS) {
    io.emit("start_game", { message: "Le jeu va bientôt commencer!" });
    console.log("Le jeu va bientôt commencer!");
    startCountdown(startNextRound);
  }
}

/**
 * Lance le compte à rebours
 * @param {Function} callback - Fonction à appeler à la fin du compte à rebours
 */
function startCountdown(callback) {
  let count = 5;
  const countdown = setInterval(() => {
    io.emit("countdown", { count });
    console.log(count);
    if (count === 0) {
      clearInterval(countdown);
      callback();
    }
    count--;
  }, 1000);
}

/**
 * Sélectionne un joueur au hasard
 */
function getRandomPlayer() {
  const playerIds = Object.keys(clients);
  const randomIndex = Math.floor(Math.random() * playerIds.length);
  return playerIds[randomIndex];
}

/**
 * Démarre la prochaine manche du jeu
 */
function startNextRound() {
  if (currentRound < MAX_ROUNDS) {
    currentRound++;
    const position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)];
    const randomPlayer = getRandomPlayer();
    clients[randomPlayer].score += 1; // Ajouter +1 au score du joueur choisi au hasard

    const gameState = {
      joueurs: Object.keys(clients).map((id) => ({
        nom: clients[id].name,
        score: clients[id].score,
        max_round: MAX_ROUNDS,
        position: position,
        round_actuel: currentRound,
      })),
      round_actuel: currentRound,
      nombre_joueur_dans_la_partie: Object.keys(clients).length,
      position: position,
    };

    io.emit("new_round", gameState);
    console.log(`Manche ${currentRound} commencée avec position: ${position}`);
    gameStarted = true;
    gameTimeout = setTimeout(() => {
      endRound();
    }, 5000); // Durée de la manche de 5 secondes
  } else {
    endGame();
  }
}

/**
 * Termine la manche et annonce le joueur perdant
 */
function endRound() {
  const loserId = getRandomPlayer(); // Simuler le joueur qui a perdu
  io.emit("player_moved", { player: clients[loserId].name });

  clearTimeout(gameTimeout);
  startNextRound();
}

/**
 * Termine le jeu et annonce les résultats
 */
function endGame() {
  const gameState = {
    joueurs: Object.keys(clients).map((id) => ({
      nom: clients[id].name,
      score: clients[id].score,
    })),
    round_actuel: currentRound,
    nombre_joueur_dans_la_partie: Object.keys(clients).length,
    perdant: getLoser(),
  };
  io.emit("end_game", gameState);
  console.log("Le jeu est terminé");
  gameStarted = false;
}

/**
 * Retourne le joueur avec le score le plus bas
 */
function getLoser() {
  let minScore = Infinity;
  let loser = null;
  Object.keys(clients).forEach((id) => {
    if (clients[id].score < minScore) {
      minScore = clients[id].score;
      loser = clients[id].name;
    }
  });
  return loser;
}

/**
 * Établit une connexion à la base de données MongoDB
 * @returns {Promise<Db>} L'objet de base de données connecté
 */
async function connectToDatabase() {
  if (dbConnection) return dbConnection;

  try {
    const client = new MongoClient(mongoDb_uri);
    await client.connect();
    console.log("Connecté à MongoDB Atlas");
    dbConnection = client.db(process.env.DB_NAME);
    return dbConnection;
  } catch (error) {
    console.error("Erreur de connexion à MongoDB:", error);
    process.exit(1);
  }
}

// Créer le serveur HTTP
const server = http.createServer(async (req, res) => {
  // Ajouter les en-têtes CORS
  cors()(req, res, () => {
    if (req.url === "/api/messages" && req.method === "GET") {
      handleGetMessages(req, res);
    } else if (req.url === "/" && req.method === "GET") {
      serveHtmlFile(req, res);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });
});

async function handleGetMessages(req, res) {
  try {
    const db = await connectToDatabase();
    const messages = await db.collection("messages").find().toArray();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(messages));
  } catch (error) {
    console.error("Erreur lors de la récupération des messages:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Erreur lors de la récupération des messages" }));
  }
}

function serveHtmlFile(req, res) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const filePath = join(__dirname, "index.html");
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end("Erreur lors du chargement de la page");
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
    }
  });
}

// Initialiser Socket.IO avec CORS
const io = new Server(server, {
  cors: {
    origin: "*", // Permet toutes les origines
    methods: ["GET", "POST"],
  },
});

/**
 * Gère la connexion d'un socket client
 * @param {Socket} socket - L'objet socket du client connecté
 */
function handleSocketConnection(socket) {
  console.log("Nouvelle connexion:", socket.name || socket.id);

  if (Object.keys(clients).length >= MAX_PLAYERS) {
    console.log("Connexion refusée : nombre maximum de joueurs atteint");
    socket.emit("connection_refused", "Le nombre maximum de joueurs est atteint. Veuillez réessayer plus tard.");
    socket.disconnect(true);
    return;
  }

  socket.on("join_game", ({ playerName }) => {
    const clientName = playerName;
    clients[socket.id] = { name: clientName, score: 0 };

    console.log(`${clientName} s'est connecté`);

    io.emit("player_joined", { name: clientName });

    socket.emit("message", { text: `Bienvenue, ${clientName}!`, createdAt: new Date(), clientName: "Serveur" });

    checkAndStartGame(); // Vérifiez et démarrez le jeu si le nombre de joueurs est atteint

    socket.on("response", (response) => {
      handlePlayerResponse(socket.id, response);
    });

    socket.on("disconnect", () => {
      console.log(`${clientName} s'est déconnecté`);
      delete clients[socket.id];
      io.emit("player_left", { name: clientName });
    });
  });
}

/**
 * Gère la réponse d'un joueur
 * @param {string} socketId - L'identifiant du socket du joueur
 * @param {Object} response - La réponse du joueur
 */
function handlePlayerResponse(socketId, response) {
  if (response.status === "failure") {
    clients[socketId].score += 1;
    io.emit("player_failed", { playerId: socketId, score: clients[socketId].score });
  }

  if (Object.keys(clients).length === MIN_PLAYERS) {
    startNextRound();
  }
}

// Gestion des erreurs
io.on("error", (error) => {
  console.error("Erreur Socket.IO:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Exception non gérée:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Rejet non géré:", reason);
  process.exit(1);
});

/**
 * Démarre le serveur WebSocket
 */
async function startServer() {
  try {
    await connectToDatabase();

    io.on("connection", handleSocketConnection);

    const localIp = ip.address();
    const port = process.env.PORT || 3000;

    // Ajouter un joueur par défaut (Bot)
    const botId = `bot_${Date.now()}`;
    clients[botId] = { name: "Bot", score: 0 };

    console.log(`Bot ajouté avec l'identifiant: ${botId}`);
    io.emit("player_joined", { name: "Bot" });

    server.listen(port, "0.0.0.0", () => {
      console.log(`Serveur en écoute sur http://localhost:${port}`);
      console.log(`Accessible sur le réseau local à http://${localIp}:${port}`);
      console.log(`Nombre maximum de joueurs autorisés : ${MAX_PLAYERS}`);
    });

    // Vérifiez et démarrez le jeu si le nombre de joueurs est atteint
    checkAndStartGame();
  } catch (error) {
    console.error("Échec du démarrage du serveur:", error);
    process.exit(1);
  }
}

// Lancer le serveur
startServer();
