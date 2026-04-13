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

    const password_hash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (username, password_hash, chips) VALUES (?, ?, 10000)`,
      [username, password_hash],
      function (err) {
        if (err) {
          return res.status(400).json({ error: "Username already exists" });
        }

        req.session.user = {
          id: this.lastID,
          username,
          chips: 10000
        };

        res.json({ success: true });
      }
    );
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    `SELECT * FROM users WHERE username = ?`,
    [username],
    async (err, user) => {
      if (err || !user) {
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
    }
  );
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  db.get(
    `SELECT id, username, chips FROM users WHERE id = ?`,
    [req.session.user.id],
    (err, user) => {
      if (err || !user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    }
  );
});

app.get("/api/friends", requireAuth, (req, res) => {
  const userId = req.session.user.id;

  db.all(
    `
    SELECT u.id, u.username, u.chips
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username ASC
    `,
    [userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Failed to load friends" });
      }
      res.json(rows);
    }
  );
});

app.post("/api/friends/add", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  db.get(
    `SELECT id, username FROM users WHERE username = ?`,
    [username],
    (err, friendUser) => {
      if (err || !friendUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (friendUser.id === userId) {
        return res.status(400).json({ error: "You cannot add yourself" });
      }

      db.run(
        `INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)`,
        [userId, friendUser.id],
        function (insertErr) {
          if (insertErr) {
            return res.status(500).json({ error: "Failed to add friend" });
          }

          db.run(
            `INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)`,
            [friendUser.id, userId],
            () => {
              res.json({ success: true, friend: friendUser });
            }
          );
        }
      );
    }
  );
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
          waitingPlayers.push({ ws, userId: ws.userId, username: ws.username });
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