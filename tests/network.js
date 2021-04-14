const Network = require('../src/network')

let options = {
    port: 1960,
    initial_connections: [],
}

process.argv.forEach((val) => {
    if (val.match(/-port=[0-9]+/)) {
        options.port = parseInt(val.split('=')[1])
    } else if (val.match(/-connect=[0-9.:]*/)) {
        options.initial_connections.push(val.split('=')[1])
    }
});

const network = new Network({port: options.port});

options.initial_connections.forEach((peer) => network.connect(peer))

network.on('connect', (peer) => {

    network.send(peer, {
        kind: "handshake",
        version: options.VERSION_STRING,
        port: options.port,
    });
    
    network.send(peer, {
        kind: "peer-discovery-request"
    })

});

network.on('handshake', (message, peer) => {
    
    if (message.version != options.VERSION_STRING) {
        network.send(peer, {
            kind: "error",
            message: "incompatible version"
        });
        network.destroy_connection(peer);
        return;
    }

    // check if the peer accepts incoming connections
    if (message.port) {
        peer.data.port = message.port;
    }

    const addr = peer.remoteAddress;
    const port = peer.data.port ? peer.data.port: peer.remotePort;
    console.log(`[+] ${addr}:${port}`)

})

network.on('disconnect', (peer) => {
    const addr = peer.remoteAddress;
    const port = peer.data.port ? peer.data.port: peer.remotePort;
    console.log(`[-] ${addr}:${port}`)
})

network.on('peer-discovery-request', (message, peer) => {

    // Get a list of all connected nodes that have a known listening port.
    const peers = network.nodes.filter(n => n.data.port)
                               .map(n => `${n.remoteAddress}:${n.data.port}`);
    
    // Send a response to the peer with a list of address strings.
    network.send(peer, {
        kind: "peer-discovery-response",
        peers: peers
    })
})

network.on('peer-discovery-response', (message) => {

    // In order to avoid multiple redundent connections between nodes,
    // build a list of currently connected peer address strings. Before
    // connecting to a node, we will check that we are not already
    // connected.
    const peer_addr_strings = network.nodes.map(n => {
        const addr = n.remoteAddress;
        const port = n.data.port ? n.data.port: n.remotePort;
        return `${addr}:${port}`;
    });

    // Iterate through all peer address strings obtained from message.
    // Initiate a connection with the peer if not already connected.
    message.peers.forEach((peer) => {  
        if (peer_addr_strings.includes(peer)) return;
        if (peer == `127.0.0.1:${options.port}`) return;
        network.connect(peer)
    });

});

network.on('error', (message) => {
    console.error(`error: ${message.message}`);
});
