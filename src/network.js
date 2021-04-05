
const net = require('net');
const crypto = require('crypto');

class Network {

    constructor(options, db) {

        const VERSION_STRING = "1.0.0"
        const MAX_PEER_COUNT = 1024
        const server = net.createServer();
        this.connections = {};
        this.options = options;
        this.guid_history = [];
        this.handlers = {};

        server.on('close',function(){
            console.log('Server closed !');
        });

        server.on('connection', (client) => {
            this.setup_connection(client)
            this.handle_connection(client)

            client.on("error", () => {
                this.destroy_connection(client);
            })
            
            client.on("close", () => {
                this.destroy_connection(client);
            })
        })

        this.handle_connection = (client) => {
            this.send_message(client, {
                kind: "handshake",
                version: VERSION_STRING,
                listens: true,
                listeningPort: options.port,
            })
            
            if (Object.keys(this.connections).length < MAX_PEER_COUNT) {
                this.send_message(client, {
                    kind: "peer-discovery-request"
                })
            }

            this.send_message(client, {
                kind: "blocks-request",
                start_hash: db.longest_chain[db.longest_chain.length - 1]
            })

        }

        this.handle_message = (client, data) => {

            const message = JSON.parse(data);
            // maintain a queue of recent guids... only handle broadcasted messages
            // that have not yet been seen.
            if (message.broadcast && !message.guid) return;
            if (message.guid && this.guid_history.includes(message.guid)) return;
            if (message.guid) {
                this.guid_history.push(message.guid);
                if (this.guid_history.length > this.options.guid_history_length) {
                    this.guid_history.shift();
                }
            }

            this.handleEvent(message.kind, message);
            
            switch (message.kind) {
                case "handshake": 

                    // disconnect if the peer has an incompatible version
                    if (message.version != VERSION_STRING) {
                        this.send_message(client, {
                            kind: "error",
                            message: "incompatible version"
                        });
                        this.destroy_connection(client);
                        return;
                    }

                    // check if the peer accepts incoming connections
                    if (message.listens && message.listeningPort) {
                        client.data.listens = true;
                        client.data.listeningPort = message.listeningPort;
                        const peer = `${client.remoteAddress}:${client.data.listeningPort}`
                        this.connections[peer] = client;
                        console.log(`[+] ${peer}`)
                    } else {
                        console.log(`[*] ${client.remoteAddress}:${client.remotePort}`)
                    }
                    
                    break;

                case "peer-discovery-request":
                    const isLocalHost = client.remoteAddress.startsWith('127');
                    const isLocal = client.remoteAddress.startsWith('192');
                    
                    let peers = Object.keys(this.connections);
                    if (!isLocalHost) peers = peers.filter(peer => !peer.startsWith('127'));
                    if (!isLocalHost && !isLocal) peers = peers.filter(peer => !peer.startsWith('192'));

                    this.send_message(client, {
                        kind: "peer-discovery-response",
                        peers: peers
                    })
                    break;

                case "peer-discovery-response":
                    message.peers.forEach(this.connect_to_peer);
                    break;

                case "blocks-request":
                    const index = db.longest_chain.indexOf(message.start_hash);
                    if (index == -1) {
                        this.send_message(client, {
                            kind: "blocks-response",
                            start_hash: message.start_hash,
                            blocks: null
                        })
                    } else {
                        const blocks = [];
                        for (let i = index + 1; i < db.longest_chain.length; i++) {
                            const hash = db.longest_chain[i];
                            blocks.push(db.blocks_by_hash[hash].block);
                        }
                        this.send_message(client, {
                            kind: "blocks-response",
                            start_hash: message.start_hash,
                            blocks: blocks
                        })
                    }
                    break;

                case "blocks-response":
                    if (message.blocks == null) {
                        this.send_message(client, {
                            kind: "blocks-request",
                            start_hash: db.longest_chain[0]
                        })
                    } else {
                        message.blocks.forEach(block => {
                            db.addBlock(block);
                        })
                    }
                    break;

                case "block":
                    db.addBlock(message.block);
                    break;

                case "error":
                    console.error(`error: ${message.message}`);
                    break;

                default:
                    console.error(`error: unrecognized message type: ${message.kind}`);
            }

            if (message.broadcast) {
                Object.values(this.connections).forEach((client) => client.write(data + "\n"));
            }
        }

        this.send_message = (client, message) => {
            client.write(JSON.stringify(message) + "\n");
        }

        this.setup_connection = (client) => {

            client.data = {
                buffer: "",
                listens: false,
                listeningPort: null
            }

            client.on("data", data => {
                client.data.buffer += data
                let messages = client.data.buffer.split('\n');
                client.data.buffer = messages.pop();
                messages.forEach((message) => this.handle_message(client, message));
            })
        }

        this.destroy_connection = (client) => {

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

        this.connect_to_peer = (peer) => {
        
            // Ensure that only one connection exists between each pair of nodes
            if (peer in this.connections) return;
            if (peer == `127.0.0.1:${options.port}`) return;
            this.connections[peer] = null;

            const addr = peer.split(':')[0]
            const port = parseInt(peer.split(':')[1])
            const client = new net.Socket();

            client.connect(port, addr, () => {
                this.connections[peer] = client;
                this.setup_connection(client);
                this.handle_connection(client);
            });

            client.on("error", () => {
                this.destroy_connection(client);
            })
            
            client.on("close", () => {
                this.destroy_connection(client);
            })
        } 

        options.initial_connections.forEach(this.connect_to_peer)

        server.listen(options.port, '0.0.0.0');

    }

    on(event, handlers) {
        this.eventHandlers[event] = handlers;
    }
 
    handleEvent(event, ...args) {
        if (event in this.handlers) {
            this.handlers[event](...args);
        }
    }

    broadcast_message(message) {
        message.guid = crypto.randomBytes(16).toString("hex");
        message.broadcast = true;
        const data = JSON.stringify(message) + '\n';
        this.guid_history.push(message.guid);
        if (this.guid_history.length > this.options.guid_history_length) {
            this.guid_history.shift();
        }
        Object.values(this.connections).forEach((client) => client.write(data));
    }
}


module.exports = Network;