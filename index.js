import http from 'http';
import { Server } from 'socket.io';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import cors from 'cors';

// Charger les variables d'environnement
dotenv.config();

const mongoDb_uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}/${process.env.DB_NAME}${process.env.DB_OPTIONS}`;

// Vérification de la configuration
if (!mongoDb_uri) {
    console.error('L\'URI MongoDB n\'est pas défini dans les variables d\'environnement');
    process.exit(1);
}

let dbConnection;

/**
 * Établit une connexion à la base de données MongoDB
 * @returns {Promise<Db>} L'objet de base de données connecté
 */
async function connectToDatabase() {
    if (dbConnection) return dbConnection;

    try {
        const client = new MongoClient(mongoDb_uri);
        await client.connect();
        console.log('Connecté à MongoDB Atlas');
        dbConnection = client.db(process.env.DB_NAME);
        return dbConnection;
    } catch (error) {
        console.error('Erreur de connexion à MongoDB:', error);
        process.exit(1);
    }
}

// Créer le serveur HTTP
const server = http.createServer(async (req, res) => {
    // Ajouter les en-têtes CORS
    cors()(req, res, () => {
        if (req.url === '/api/messages' && req.method === 'GET') {
            handleGetMessages(req, res);
        } else if (req.url === '/' && req.method === 'GET') {
            serveHtmlFile(req, res);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });
});

async function handleGetMessages(req, res) {
    try {
        const db = await connectToDatabase();
        const messages = await db.collection('messages').find().toArray();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(messages));
    } catch (error) {
        console.error('Erreur lors de la récupération des messages:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erreur lors de la récupération des messages' }));
    }
}

function serveHtmlFile(req, res) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const filePath = join(__dirname, 'index.html');
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end('Erreur lors du chargement de la page');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        }
    });
}

// Initialiser Socket.IO avec CORS
const io = new Server(server, {
    cors: {
        origin: "*", // Permet toutes les origines
        methods: ["GET", "POST"]
    }
});

/**
 * Gère la connexion d'un socket client
 * @param {Socket} socket - L'objet socket du client connecté
 */
function handleSocketConnection(socket) {
    console.log('Un client s\'est connecté');

    socket.on('message', async (message) => {
        try {
            console.log('Message reçu:', message);

            const db = await connectToDatabase();
            const newMessage = { text: message, createdAt: new Date() };
            await db.collection('messages').insertOne(newMessage);

            // Émettre le message à tous les clients connectés
            io.emit('message', newMessage);
        } catch (error) {
            console.error('Erreur lors du traitement du message:', error);
            socket.emit('error', 'Une erreur s\'est produite lors du traitement de votre message');
        }
    });

    socket.on('disconnect', () => {
        console.log('Un client s\'est déconnecté');
    });
}

// Gestion des erreurs
io.on('error', (error) => {
    console.error('Erreur Socket.IO:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Exception non gérée:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejet non géré:', reason);
    process.exit(1);
});

/**
 * Démarre le serveur WebSocket
 */
async function startServer() {
    try {
        await connectToDatabase();

        io.on('connection', handleSocketConnection);

        server.listen(process.env.PORT, () => {
            console.log(`Serveur en écoute sur le port ${process.env.PORT}`);
        });
    } catch (error) {
        console.error('Échec du démarrage du serveur:', error);
        process.exit(1);
    }
}

// Lancer le serveur
startServer();