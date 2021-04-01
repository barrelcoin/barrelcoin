const net = require('net');
const crypto = require('crypto');
const BlockChain = require('./blockchain')
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');


const VERSION_STRING = "1.0.0"
const MAX_PEER_COUNT = 1024

let options = {
    port: 1960,
    initial_connections: []
}

process.argv.forEach((val) => {
    if (val.match(/-port=[0-9]+/)) {
        options.port = parseInt(val.split('=')[1])
    } else if (val.match(/-connect=[0-9.:]*/)) {
        options.initial_connections.push(val.split('=')[1])
    }
});

const db = new BlockChain(`./${options.port}/blocks`);

const server = net.createServer();
const connections = {}

const GUID_HISTORY_LENGTH = 1024
const guid_history = [];

server.on('close',function(){
    console.log('Server closed !');
});

server.on('connection', (client) => {
    setup_connection(client)
    handle_connection(client)

    const addr = client.remoteAddress;
    const port = client.data.listens ? client.data.listeningPort: client.remotePort

    client.on("error", () => {
        delete connections[`${addr}:${port}`]
        destroy_connection(client);
    })
    
    client.on("close", () => {
        delete connections[`${addr}:${port}`]
        destroy_connection(client);
    })
})

options.initial_connections.forEach(connect_to_peer)

server.listen(options.port, '127.0.0.1');


function handle_connection(client) {
    send_message(client, {
        kind: "handshake",
        version: VERSION_STRING,
        listens: true,
        listeningPort: options.port,
    })
    
    if (Object.keys(connections).length < MAX_PEER_COUNT) {
        send_message(client, {
            kind: "peer-discovery-request"
        })
    }
}

function handle_message(client, data) {

    const message = JSON.parse(data);

    // maintain a queue of recent guids... only handle broadcasted messages
    // that have not yet been seen.
    if (message.broadcast && !message.guid) return;
    if (message.guid && guid_history.includes(message.guid)) return;
    if (message.guid) {
        guid_history.push(message.guid);
        if (guid_history.length > GUID_HISTORY_LENGTH) {
            guid_history.shift();
        }
    }

    switch (message.kind) {
        case "handshake": 

            // disconnect if the peer has an incompatible version
            if (message.version != VERSION_STRING) {
                send_message(client, {
                    kind: "error",
                    message: "incompatible version"
                });
                destroy_connection(client);
                return;
            }

            // check if the peer accepts incoming connections
            if (message.listens && message.listeningPort) {
                client.data.listens = true;
                client.data.listeningPort = message.listeningPort;
                const peer = `${client.remoteAddress}:${client.data.listeningPort}`
                if (!(peer in connections)) connections[peer] = client;
                console.log(`[+] ${peer}`)
            } else {
                console.log(`[*] ${client.remoteAddress}:${client.remotePort}`)
            }
            
            break;

        case "peer-discovery-request":
            send_message(client, {
                kind: "peer-discovery-response",
                peers: Object.keys(connections)
            })
            break;

        case "peer-discovery-response":
            message.peers.forEach(connect_to_peer);
            break;

        case "block":
            break;

        case "error":
            console.error(`error: ${message.message}`);
            break;

        default:
            console.error(`error: unrecognized message type: ${message.kind}`);
    }

    if (message.broadcast) {
        clients.forEach((client) => client.write(data));
    }
}

function send_message(client, message) {
    client.write(JSON.stringify(message) + "\n");
}

function broadcast_message(message) {
    message.guid = crypto.randomBytes(16).toString("hex");
    message.broadcast = true;
    const data = JSON.stringify(message) + "\n";
    Object.values(connections).forEach((client) => client.write(data));
}

function setup_connection(client) {

    client.data = {
        buffer: "",
        listens: false,
        listeningPort: null
    }

    client.on("data", data => {
        client.data.buffer += data
        let messages = client.data.buffer.split('\n');
        client.data.buffer = messages.pop();
        messages.forEach((message) => handle_message(client, message));
    })
}

function destroy_connection(client) {

    if (client.data.listens) {
        const port = client.data.listeningPort;
        const addr = client.remoteAddress;
        console.log(`[-] ${addr}:${port}`)
    } else {
        const port = client.remotePort;
        const addr = client.remoteAddress;
        console.log(`[-] ${addr}:${port}`)
    }

    client.destroy()
}

function connect_to_peer(peer) {
   
    // Ensure that only one connection exists between each pair of nodes
    if (peer in connections) return;
    if (peer == `127.0.0.1:${options.port}`) return;
    connections[peer] = null;

    const addr = peer.split(':')[0]
    const port = parseInt(peer.split(':')[1])
    const client = new net.Socket();

    client.connect(port, addr, function() {
        connections[peer] = client;
        setup_connection(client);
        handle_connection(client);
    });

    client.on("error", () => {
        delete connections[`${addr}:${port}`]
        destroy_connection(client);
    })
    
    client.on("close", () => {
        delete connections[`${addr}:${port}`]
        destroy_connection(client);
    })
} 

