const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "data.json");

function ensureDb() {
  if (!fs.existsSync(dbPath)) {
    const initialData = {
      users: [],
      friends: []
    };
    fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function getAllUsers() {
  return readDb().users;
}

function getUserByUsername(username) {
  return readDb().users.find((u) => u.username === username);
}

function getUserById(id) {
  return readDb().users.find((u) => u.id === id);
}

function createUser(username, password_hash) {
  const db = readDb();

  if (db.users.find((u) => u.username === username)) {
    return null;
  }

  const newUser = {
    id: Date.now(),
    username,
    password_hash,
    chips: 10000
  };

  db.users.push(newUser);
  writeDb(db);
  return newUser;
}

function addFriend(userId, friendId) {
  const db = readDb();

  const exists = db.friends.find(
    (f) => f.userId === userId && f.friendId === friendId
  );

  if (!exists) {
    db.friends.push({ userId, friendId });
  }

  const reverseExists = db.friends.find(
    (f) => f.userId === friendId && f.friendId === userId
  );

  if (!reverseExists) {
    db.friends.push({ userId: friendId, friendId: userId });
  }

  writeDb(db);
}

function getFriends(userId) {
  const db = readDb();

  const friendLinks = db.friends.filter((f) => f.userId === userId);
  return friendLinks
    .map((f) => db.users.find((u) => u.id === f.friendId))
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      username: u.username,
      chips: u.chips
    }));
}

module.exports = {
  getAllUsers,
  getUserByUsername,
  getUserById,
  createUser,
  addFriend,
  getFriends
};