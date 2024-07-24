import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { MongoClient } from 'mongodb';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// const MONGODB_URI = 'votre_uri_mongodb_atlas';

// async function connectToDatabase() {
//     const client = new MongoClient(MONGODB_URI);
//     try {
//         await client.connect();
//         console.log('Connecté à MongoDB Atlas');
//         return client.db('votre_nom_de_base_de_donnees');
//     } catch (error) {
//         console.error('Erreur de connexion à MongoDB:', error);
//         process.exit(1);
//     }
// }

async function startServer() {
    // const db = await connectToDatabase();

    io.on('connection', (socket) => {
        console.log('Un client s\'est connecté');

        socket.on('message', async (message) => {
            console.log('Message reçu:', message);

            // Enregistrer le message dans MongoDB
            await db.collection('messages').insertOne({ text: message, createdAt: new Date() });

            // Diffuser le message à tous les clients connectés
            io.emit('message', message);
        });

        socket.on('disconnect', () => {
            console.log('Un client s\'est déconnecté');
        });
    });

    server.listen(PORT, () => {
        console.log(`Serveur en écoute sur le port ${PORT}`);
    });
}

startServer();