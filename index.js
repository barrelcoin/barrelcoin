const net = require('net');
const crypto = require('crypto');
const BlockChain = require('./blockchain')
const { Worker } = require('worker_threads')

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

class Miner {

    constructor(onBlockMined) {
        this.worker = null;
        this.onBlockMined = onBlockMined;
    }

    mine_block(block, difficulty) {
        if (this.worker) this.worker.terminate();
        this.worker = new Worker('./miningThread.js', { workerData: {
            block,
            difficulty
        }});
    
        this.worker.on('message', (res) => {
            this.worker.terminate();
            this.worker = null;
            this.onBlockMined(res.block);
        });
    }
}

function account_balances() {
    balances = {}
    db.longest_chain.forEach(hash => {
        if (hash == "0000000000000000000000000000000000000000000000000000000000000000") return;
        const port = db.blocks_by_hash[hash].block.port;
        if (!(port in balances)) balances[port] = 1
        else balances[port] += 1
    })
    return balances;
}

const miner = new Miner((block) => {
    
    broadcast_message({
        kind: "block",
        block: block,
    });

    db.addBlock(block);
    console.log(account_balances());


    miner.mine_block({
        "prev_block": db.longest_chain[db.longest_chain.length - 1],
        "timestamp": Math.floor(new Date().getTime() / 1000),
        "difficulty": 5,
        "nonce": 0,
        "port": options.port,
        "transactions": []
    }, 5);
})


miner.mine_block({
    "prev_block": db.longest_chain[db.longest_chain.length - 1],
    "timestamp": Math.floor(new Date().getTime() / 1000),
    "difficulty": 5,
    "nonce": 0,
    "port": options.port,
    "transactions": []
}, 5); 

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

    client.on("error", () => {
        destroy_connection(client);
    })
    
    client.on("close", () => {
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

    send_message(client, {
        kind: "blocks-request",
        start_hash: db.longest_chain[db.longest_chain.length - 1]
    })

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
                connections[peer] = client;
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

        case "blocks-request":
            const index = db.longest_chain.indexOf(message.start_hash);
            if (index == -1) {
                send_message(client, {
                    kind: "blocks-response",
                    start_hash: message.start_hash,
                    blocks: null
                })
            } else {
                blocks = [];
                for (let i = index + 1; i < db.longest_chain.length; i++) {
                    const hash = db.longest_chain[i];
                    blocks.push(db.blocks_by_hash[hash].block);
                }
                send_message(client, {
                    kind: "blocks-response",
                    start_hash: message.start_hash,
                    blocks: blocks
                })
            }
            break;

        case "blocks-response":
            if (message.blocks == null) {
                send_message(client, {
                    kind: "blocks-request",
                    start_hash: db.longest_chain[0]
                })
            } else {
                const initial_chain_length = db.longest_chain.length;
                message.blocks.forEach(block => {
                    db.addBlock(block);
                })
                const final_chain_length = db.longest_chain.length;
                if (final_chain_length > initial_chain_length) {
                    miner.mine_block({
                        "prev_block": db.longest_chain[db.longest_chain.length - 1],
                        "timestamp": Math.floor(new Date().getTime() / 1000),
                        "difficulty": 5,
                        "nonce": 0,
                        "port": options.port,
                        "transactions": []
                    }, 5);
                }
            }
            break;

        case "block":
            const initial_chain_length = db.longest_chain.length;
            db.addBlock(message.block);
            const final_chain_length = db.longest_chain.length;
            if (final_chain_length > initial_chain_length) {
                miner.mine_block({
                    "prev_block": db.longest_chain[db.longest_chain.length - 1],
                    "timestamp": Math.floor(new Date().getTime() / 1000),
                    "difficulty": 5,
                    "nonce": 0,
                    "port": options.port,
                    "transactions": []
                }, 5);
            }
            console.log(account_balances());
            break;

        case "error":
            console.error(`error: ${message.message}`);
            break;

        default:
            console.error(`error: unrecognized message type: ${message.kind}`);
    }

    if (message.broadcast) {
        Object.values(connections).forEach((client) => client.write(data + "\n"));
    }
}

function send_message(client, message) {
    client.write(JSON.stringify(message) + "\n");
}

function broadcast_message(message) {
    message.guid = crypto.randomBytes(16).toString("hex");
    message.broadcast = true;
    const data = JSON.stringify(message) + '\n';
    guid_history.push(message.guid);
    if (guid_history.length > GUID_HISTORY_LENGTH) {
        guid_history.shift();
    }
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
        destroy_connection(client);
    })
    
    client.on("close", () => {
        destroy_connection(client);
    })
} 

