
const net = require('net');
const crypto = require('crypto');
const stringify = require('json-stable-stringify');

/**
 * The Network class creates a message passing peer-to-peer network.
 * This serves as the "medium" over which our ledger is distributed
 * and synchronized. It has a few important functions:
 * 
 * connect: connect to a new peer.
 * send: send a message to a single peer.
 * broadcast: send a message that propogates to all nodes in the network.
 * on: register for message events.
 */
class Network {

    constructor(options) {

        this.options = {
            msg_history_length: options.msg_history_length || 1024,
            port: options.port || 1960
        }

        this.nodes = [];
        this.guid_history = [];
        this.options = options;
        this.handlers = {};

        const server = net.createServer();
        server.on('connection', (client) => {

            this.setupConnection(client)
            this.handleEvent('connect', client);
            
            client.on("close", () => {
                this.destroyConnection(client);
            })

        });

        server.listen(this.options.port, '0.0.0.0');
    }

    setupConnection (client) {

        client.data = {
            buffer: "",
        }

        client.on("data", data => {
            client.data.buffer += data
            let messages = client.data.buffer.split('\n');
            client.data.buffer = messages.pop();
            messages.forEach((message) => this.handleMessage(client, message));
        })

        this.nodes.push(client);
    }

    destroyConnection (client) {

        if (this.nodes.includes(client)) {
            this.handleEvent('disconnect', client);
            this.nodes = this.nodes.filter(n => n !== client);
        }
        
        client.destroy()
    }
 
    handleEvent(event, ...args) {
        if (event in this.handlers) {
            this.handlers[event](...args);
        }
    }

    handleMessage (client, data) {

        const message = JSON.parse(data);

        // maintain a queue of recent guids... only handle broadcasted messages
        // that have not yet been seen.
        if (message.broadcast && !message.guid) return;
        if (message.guid && this.guid_history.includes(message.guid)) return;
        if (message.guid) {
            this.guid_history.push(message.guid);
            if (this.guid_history.length > this.options.msg_history_length) {
                this.guid_history.shift();
            }
        }

        this.handleEvent(message.kind, message, client);

        // if the message is meant to be broadcasted... forward the message to
        // all connected nodes.
        if (message.broadcast) {
            this.nodes.forEach((node) => node.write(data + "\n"));
        }
    }

    on(event, handler) {
        this.handlers[event] = handler;
    }
    
    connect(peer) {
    
        const addr = peer.split(':')[0]
        const port = parseInt(peer.split(':')[1])
        const client = new net.Socket();
        
        client.connect(port, addr, () => {
            this.setupConnection(client);
            client.data.port = port;
            this.handleEvent('connect', client);
        });

        client.on("error", (err) => {
            console.log(`unable to connect to ${addr}:${port}`);
        })

        client.on("close", () => {
            this.destroyConnection(client);
        })
    }

    /**
     * @brief send a json message to a specific peer. 
     * 
     * This method simply sends the stringified json object to the specified
     * tcp socket as well as an end-of-message delimiter '\n'. 
     * 
     * @param peer the tcp socket on which to send the message
     * @param message the json object to send to the specified peer
     */
    send (peer, message) {
        peer.write(stringify(message) + "\n");
    }

    /**
     * @brief send a json message to all nodes in the network.
     * 
     * This method generates a unique message guid and appends it to the
     * message as the 'guid' property. Additionally, it create a new 
     * 'broadcast' property the is set to true. Finally, the stringified
     * message is send to all peers. When recieving this message, each 
     * peer will send the message to all their peers. The message will 
     * propogate in this manner until all peers have recieved the message.
     * 
     * @param message the json object to broadcast to the network.
     */
    broadcast (message) {
        message.guid = crypto.randomBytes(16).toString("hex");
        message.broadcast = true;
        const data = stringify(message) + '\n';
        this.guid_history.push(message.guid);
        if (this.guid_history.length > this.options.msg_history_length) {
            this.guid_history.shift();
        }
        this.nodes.forEach((client) => client.write(data));
    }
}


module.exports = Network;