const http = require("http").createServer();
const io = require('socket.io')(http, {
    transports: ['websocket'],
    allowUpgrades: false,
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

let nicks = {};
const colors = ["red", "yellow", "green", "cyan", "blue"];
let connCounter = 0;
let timer = false;
let msgPoints = {};
let timedOut = [];
let nickChanged = [];
let colorChanged = [];
let msgCounter = 0;

function continuous() {
    if (io.engine.clientsCount === 0) {
        // Deactivate continuous functions
        clearInterval(timer);
        timer = false;
    }

    msgCounter += 0.5
    if (msgCounter === 1) {
        msgCounter = 0;
        Object.keys(msgPoints).forEach((socketId) => {
            if (!timedOut.includes(socketId)) {
                delete msgPoints[socketId];
            }
        })
    }
}

io.on('connection', function (socket) {
    console.log('a user connected');
    // Activate continuous functions
    if (!timer) {
        timer = setInterval(continuous, 500);
    }

    if (connCounter++ >= 5) {
        connCounter = 0;
        io.fetchSockets().then((sockets) => {
            let connClients = sockets.map((socket) => socket.id);
            let modified = false;
            for (const id in nicks) {
                if (!(connClients.includes(id))) {
                    delete nicks[id];
                    modified = true;
                }
            }
            if (modified) {
                console.log("nicks array out of sync, resyncing");
                io.emit('set nickname list', nicks);
            }
        });
    }

    socket.on('disconnect', function () {
        delete nicks[socket.id];
        io.emit('user disconnect', socket.id);
        console.log('user disconnected');
    });

    socket.on('chat message', function (msg, target) {
        if (socket.id in nicks) {
            if (timedOut.includes(socket.id)) {
                socket.emit('timed out');
            } else {
                if (!(socket.id in msgPoints)) {
                    msgPoints[socket.id] = 1;
                } else {
                    msgPoints[socket.id] += 1;
                }

                if (msgPoints[socket.id] >= 3) {
                    msgPoints[socket.id] = 0;
                    timedOut.push(socket.id);
                    setTimeout(() => {
                        const index = timedOut.indexOf(socket.id);
                        if (index > -1) {
                            timedOut.splice(index, 1);
                        }
                    }, 10000);

                    socket.emit('timed out');
                } else {
                    msg = sanitize(msg);
                    if (msg !== "") {
                        if (target === "global") {
                            socket.broadcast.emit('chat message', socket.id, msg, target);
                        } else {
                            io.to(target).emit('chat message', socket.id, msg, target);
                        }
                    }
                }
            }
        } else {
            socket.disconnect();
        }
    });

    socket.on('set nickname', function (msg) {
        msg = sanitize(msg);
        let unique = true;
        let upper = msg.toUpperCase();
        Object.entries(nicks).forEach(function ([id, info]) {
            if (info.nick.toUpperCase() === upper && id !== socket.id) {
                unique = false;
            }
        });
        if (unique) {
            if (nickChanged.includes(socket.id)) {
                socket.emit('nickname error', "Nickname can only be changed every 10 seconds");
            } else if (msg.length > 20) {
                socket.emit('nickname error', "Nickname must be less than 20 characters");
            } else if (msg === "") {
                socket.emit('nickname error', "Nickname cannot be blank");
            } else if (!msg.match(/^[0-9a-z]+$/i)) {
                socket.emit('nickname error', "Nickname must only use a-z and 0-9");
            } else {
                nickChanged.push(socket.id);
                setTimeout(() => {
                    const index = nickChanged.indexOf(socket.id);
                    if (index > -1) {
                        nickChanged.splice(index, 1);
                    }
                }, 10000);

                let newUser = false;
                if (!(socket.id in nicks)) {
                    // New user connected
                    newUser = true;
                    nicks[socket.id] = { color: colors[Math.floor(Math.random() * 5)] };
                }
                nicks[socket.id].nick = msg;
                io.emit('set nickname', socket.id, msg);
                if (newUser) {
                    io.emit('set color', socket.id, nicks[socket.id].color);
                    socket.emit('set nickname list', nicks);
                }
            }
        } else {
            socket.emit('nickname error', "That nickname is already in use");
        }
    });

    socket.on('set color', function (color) {
        if (socket.id in nicks) {
            if (colors.includes(color)) {
                if (!colorChanged.includes(socket.id)) {
                    nicks[socket.id].color = color;
                    io.emit('set color', socket.id, color);
                    colorChanged.push(socket.id);
                    setTimeout(() => {
                        const index = colorChanged.indexOf(socket.id);
                        if (index > -1) {
                            colorChanged.splice(index, 1);
                        }
                    }, 200);
                }
            }
        } else {
            socket.disconnect();
        }
    });
});

let port = process.env.PORT || 8080;

http.listen(port, function () {
    console.log(`listening on *:${port}`);
});

function sanitize(string) {
    if (typeof string === "string" || typeof string === "number") {
        const sanitizeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            "/": '&#x2F;',
            "`": '&grave',
            "%": '&#37;',
            "=": '&#61;',
            "$": '&#36;'
        };
        const reg = /[&<>"'/`%=$]/ig;
        return string.toString().substr(0, 300).replace(reg, (match) => (sanitizeMap[match]));
    }
    return "";
}