const http = require("http");
const socketIO = require("socket.io");
const express = require("express");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" },
});

let rooms = {};

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("createRoom", (roomID) => {
    if (!rooms[roomID]) {
      rooms[roomID] = {
        players: [],
        choices: {},
        scores: {},
        ready: {},
      };
      console.log(`Room created ${roomID} by ${socket.id}`);
      socket.emit("playerSearching", { playerNumber: 1, roomID });
    } else {
      socket.emit("error", { message: "Room already exists" });
    }
  });

  socket.on("joinRoom", (roomID) => {
    if (!rooms[roomID]) {
      return socket.emit("Not a ValidToken", {
        message: "Room does not exist",
      });
    }
    if (rooms[roomID].players.length >= 2) {
      return socket.emit("roomFull", { message: "Room is full" });
    }
    if (!rooms[roomID].players.includes(socket.id)) {
      socket.join(roomID);
      rooms[roomID].players.push(socket.id);
      rooms[roomID].scores[socket.id] = rooms[roomID].scores[socket.id] || 0;
      console.log(`Player ${socket.id}: joined room ${roomID}`);
    } else {
      console.log(`Player ${socket.id} attempted to join room ${roomID} again`);
    }

    const playerNumber = rooms[roomID].players.indexOf(socket.id) + 1;
    socket.emit("playerSearching", { playerNumber, roomID });
    io.to(roomID).emit("playersConnected", {
      roomID,
      players: rooms[roomID].players.slice(),
    });

    if (rooms[roomID].players.length === 2) {
      console.log(`Starting game in room ${roomID}`);
      rooms[roomID].players.forEach((pid, index) => {
        io.to(pid).emit("startGame", { playerNumber: index + 1, roomID });
      });
      rooms[roomID].ready = {};
      rooms[roomID].choices = {};
    }
  });

  socket.on("submitChoice", (data) => {
    const { roomID, choice } = data;
    if (!rooms[roomID] || !["rock", "paper", "scissor"].includes(choice)) {
      socket.emit("error", { message: "Invalid room or choice" });
      return;
    }

    console.log(
      `Choice received from ${socket.id} in room ${roomID}: ${choice}`
    );
    rooms[roomID].choices[socket.id] = choice;

    const players = rooms[roomID].players;
    const both =
      players.length === 2 &&
      players.every((pid) => rooms[roomID].choices[pid]);
    if (!both) return;

    const p1Id = players[0];
    const p2Id = players[1];
    const p1Choice = rooms[roomID].choices[p1Id];
    const p2Choice = rooms[roomID].choices[p2Id];

    const result1 = getResult(p1Choice, p2Choice);
    const result2 = getResult(p2Choice, p1Choice);

    // Update scores: WIN +1, LOSE +0, DRAW +0
    if (!rooms[roomID].scores[p1Id]) rooms[roomID].scores[p1Id] = 0;
    if (!rooms[roomID].scores[p2Id]) rooms[roomID].scores[p2Id] = 0;
    if (result1 === "WIN") rooms[roomID].scores[p1Id] += 1;
    if (result2 === "WIN") rooms[roomID].scores[p2Id] += 1;

    console.log(
      `Sending to ${p1Id}: myChoice=${p1Choice}, opponentChoice=${p2Choice}, result=${result1}, myScore=${rooms[roomID].scores[p1Id]}, oppScore=${rooms[roomID].scores[p2Id]}`
    );
    console.log(
      `Sending to ${p2Id}: myChoice=${p2Choice}, opponentChoice=${p1Choice}, result=${result2}, myScore=${rooms[roomID].scores[p2Id]}, oppScore=${rooms[roomID].scores[p1Id]}`
    );

    io.to(p1Id).emit("gameResult", {
      myChoice: p1Choice,
      opponentChoice: p2Choice,
      result: result1,
      roomID,
    });
    io.to(p2Id).emit("gameResult", {
      myChoice: p2Choice,
      opponentChoice: p1Choice,
      result: result2,
      roomID,
    });
  });

  // Player requests play again
  socket.on("playAgain", (data) => {
    const { roomID } = data;
    if (!rooms[roomID]) return;
    rooms[roomID].ready[socket.id] = true;
    console.log(`Player ${socket.id} ready to play again in room ${roomID}`);
    io.to(roomID).emit("playerReady", { playerId: socket.id });

    const players = rooms[roomID].players;
    if (
      players.length === 2 &&
      players.every((pid) => rooms[roomID].ready[pid])
    ) {
      rooms[roomID].ready = {};
      rooms[roomID].choices = {};
      console.log(`Both players ready in room ${roomID}, starting next round`);
      players.forEach((pid, index) => {
        io.to(pid).emit("startGame", { playerNumber: index + 1, roomID });
      });
    } else {
      io.to(roomID).emit("waitingForOpponent", {
        waitingFor: players.filter((pid) => !rooms[roomID].ready[pid]),
      });
    }
  });

  socket.on("exitGame", (data) => {
    const { roomID } = data;
    if (!rooms[roomID]) return;
    rooms[roomID].players = rooms[roomID].players.filter(
      (pid) => pid !== socket.id
    );
    delete rooms[roomID].choices[socket.id];
    delete rooms[roomID].scores[socket.id];
    delete rooms[roomID].ready[socket.id];
    socket.leave(roomID);
    console.log(`Player ${socket.id} exited room ${roomID}`);
    if (rooms[roomID].players.length === 0) {
      delete rooms[roomID];
      console.log(`Room ${roomID} deleted (empty)`);
    } else {
      io.to(roomID).emit("playerLeft", {
        roomID,
        remaining: rooms[roomID].players.length,
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const roomID in rooms) {
      rooms[roomID].players = rooms[roomID].players.filter(
        (pid) => pid !== socket.id
      );
      delete rooms[roomID].choices[socket.id];
      delete rooms[roomID].scores[socket.id];
      delete rooms[roomID].ready[socket.id];
      if (rooms[roomID].players.length === 0) {
        delete rooms[roomID];
        console.log(`Room ${roomID} deleted due to all players disconnected`);
      } else {
        io.to(roomID).emit("playerLeft", {
          roomID,
          remaining: rooms[roomID].players.length,
        });
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
