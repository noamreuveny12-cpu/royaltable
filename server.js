const express = require("express");
const http = require("http");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const WebSocket = require("ws");
const db = require("./db");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "royaltable-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/lobby", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "public", "lobby.html"));
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (username.length < 3 || password.length < 4) {
      return res.status(400).json({ error: "Username or password too short" });
    }

    const existingUser = db.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const newUser = db.createUser(username, password_hash);

    req.session.user = {
      id: newUser.id,
      username: newUser.username,
      chips: newUser.chips
    };

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.getUserByUsername(username);

    if (!user) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      chips: user.chips
    };

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = db.getUserById(req.session.user.id);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({
    id: user.id,
    username: user.username,
    chips: user.chips
  });
});

app.get("/api/friends", requireAuth, (req, res) => {
  const friends = db.getFriends(req.session.user.id);
  res.json(friends);
});

app.post("/api/friends/add", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  const friendUser = db.getUserByUsername(username);

  if (!friendUser) {
    return res.status(404).json({ error: "User not found" });
  }

  if (friendUser.id === userId) {
    return res.status(400).json({ error: "You cannot add yourself" });
  }

  db.addFriend(userId, friendUser.id);

  res.json({
    success: true,
    friend: {
      id: friendUser.id,
      username: friendUser.username,
      chips: friendUser.chips
    }
  });
});

const lobbyClients = new Map();
const waitingPlayers = [];

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "LOBBY_JOIN") {
        ws.userId = data.userId;
        ws.username = data.username;
        lobbyClients.set(ws.userId, ws);
      }

      if (data.type === "PLAY_NOW") {
        const alreadyWaiting = waitingPlayers.find((p) => p.ws === ws);

        if (!alreadyWaiting) {
          waitingPlayers.push({
            ws,
            userId: ws.userId,
            username: ws.username
          });
        }

        if (waitingPlayers.length >= 2) {
          const p1 = waitingPlayers.shift();
          const p2 = waitingPlayers.shift();
          const tableId = "table_" + Math.random().toString(36).slice(2, 8);

          [p1.ws, p2.ws].forEach((client, index) => {
            client.send(
              JSON.stringify({
                type: "MATCH_FOUND",
                tableId,
                seat: index + 1,
                players: [p1.username, p2.username]
              })
            );
          });
        }
      }
    } catch (e) {
      console.error("WS message error:", e.message);
    }
  });

  ws.on("close", () => {
    if (ws.userId) {
      lobbyClients.delete(ws.userId);
    }

    const index = waitingPlayers.findIndex((p) => p.ws === ws);
    if (index !== -1) {
      waitingPlayers.splice(index, 1);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});