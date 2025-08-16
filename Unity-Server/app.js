const http = require("http");
const socketIO = require("socket.io");
const express = require("express");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
  },
});

let rooms = {};

io.on("connection", (socket) => {
  console.log("Client connected: ", socket.id);

  socket.on("createRoom", (roomID) => {
    if (!rooms[roomID]) {
      rooms[roomID] = {
        players: [],
        scores: {},
        choices: {},
      };
      socket.join(roomID);
      rooms[roomID].players.push(socket);
      console.log(`Player 1 created and joined room ${roomID}: ${socket.id}`);
      socket.emit("playerSearching", { playerNumber: 1, roomID });
    } else {
      socket.emit("error", { message: "Room already exists" });
    }
  });

  socket.on("joinRoom", (roomID) => {
    if (!rooms[roomID]) {
      return socket.emit("Not a ValidToken", { message: "Room does not exist" });
    }

    if (rooms[roomID].players.length >= 2) {
      return socket.emit("roomFull", { message: "Room is full" });
    }

    socket.join(roomID);
    rooms[roomID].players.push(socket);
    console.log(`Player 2 joined room ${roomID}: ${socket.id}`);
    socket.emit("playerSearching", { playerNumber: 2, roomID });
    io.to(roomID).emit("playersConnected", { roomID });

    if (rooms[roomID].players.length === 2) {
      console.log(`Starting game in room ${roomID}`);
      rooms[roomID].players.forEach((player, index) => {
        player.emit("startGame", { playerNumber: index + 1, roomID });
      });
    }
  });

  socket.on("submitChoice", (data) => {
    const { roomID, choice } = data;
    if (!rooms[roomID] || !["rock", "paper", "scissor"].includes(choice)) {
      socket.emit("error", { message: "Invalid room or choice" });
      return;
    }

    console.log(`Choice received from ${socket.id} in room ${roomID}: ${choice}`);
    rooms[roomID].choices[socket.id] = choice;

    if (Object.keys(rooms[roomID].choices).length === 2) {
      const playerIds = Object.keys(rooms[roomID].choices);
      const p1 = { id: playerIds[0], choice: rooms[roomID].choices[playerIds[0]] };
      const p2 = { id: playerIds[1], choice: rooms[roomID].choices[playerIds[1]] };

      const result1 = getResult(p1.choice, p2.choice);
      const result2 = getResult(p2.choice, p1.choice);

      console.log(`Sending to ${p1.id}: myChoice=${p1.choice}, opponentChoice=${p2.choice}, result=${result1}`);
      console.log(`Sending to ${p2.id}: myChoice=${p2.choice}, opponentChoice=${p1.choice}, result=${result2}`);

      io.to(p1.id).emit("gameResult", {
        myChoice: p1.choice,
        opponentChoice: p2.choice,
        result: result1,
        roomID,
      });
      io.to(p2.id).emit("gameResult", {
        myChoice: p2.choice,
        opponentChoice: p1.choice,
        result: result2,
        roomID,
      });

      setTimeout(() => {
        rooms[roomID].choices = {};
        io.to(roomID).emit("gameReset", { message: "Game has been reset" });
      }, 10000);
    }
  });

  socket.on("playerClicked", (data) => {
    const { roomID } = data;
    if (rooms[roomID]) {
      rooms[roomID].choices = {};
      io.to(roomID).emit("playAgain", { roomID });
    }
  });

  socket.on("exitGame", (data) => {
    const { roomID, player } = data;
    if (rooms[roomID]) {
      socket.leave(roomID);
      io.to(roomID).emit(player === 1 ? "player1Left" : "player2Left");
      delete rooms[roomID];
      console.log(`Room ${roomID} deleted due to player exit`);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const roomID in rooms) {
      rooms[roomID].players = rooms[roomID].players.filter((p) => p.id !== socket.id);
      delete rooms[roomID].choices[socket.id];
      if (rooms[roomID].players.length === 0) {
        delete rooms[roomID];
        console.log(`Room ${roomID} deleted due to all players disconnected`);
      } else {
        io.to(roomID).emit(rooms[roomID].players.length === 1 ? "player1Left" : "player2Left");
      }
    }
  });
});

function getResult(myChoice, opponentChoice) {
  if (myChoice === opponentChoice) return "DRAW";
  if (myChoice === "rock" && opponentChoice === "scissor") return "WIN";
  if (myChoice === "paper" && opponentChoice === "rock") return "WIN";
  if (myChoice === "scissor" && opponentChoice === "paper") return "WIN";
  return "LOSE";
}

server.listen(8000, () => {
  console.log("Server is running on port 8000");
});