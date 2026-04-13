const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

let rooms = {};

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.type === "JOIN_ROOM") {
      const roomId = data.roomId;

      if (!rooms[roomId]) {
        rooms[roomId] = [];
      }

      rooms[roomId].push(ws);
      ws.roomId = roomId;

      rooms[roomId].forEach(client => {
        client.send(JSON.stringify({
          type: "PLAYERS",
          count: rooms[roomId].length
        }));
      });
    }
  });

  ws.on("close", () => {
    const room = rooms[ws.roomId];
    if (room) {
      rooms[ws.roomId] = room.filter(client => client !== ws);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


