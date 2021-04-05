const { workerData, parentPort } = require('worker_threads')
const crypto = require('crypto')
const stringify = require('json-stable-stringify');

const block = workerData.block;
const difficulty = workerData.difficulty;

function doesHashSatisfyDifficulty(hash, difficulty) {
    for (let i = 0; i < difficulty; i++) {
        if (hash[i] != '0') return false;
    }
    return hash;
}

while (true) {
    block.timestamp = Math.floor(new Date().getTime() / 1000);
    for (let i = 0; i < 0xFFFFFFFF; i++) {
        block.nonce = i;
        const block_string = stringify(block, Object.keys(block).sort());
        const hash = crypto.createHash('sha256').update(block_string).digest('hex');
        if (doesHashSatisfyDifficulty(hash, difficulty)) {
            parentPort.postMessage({ block, hash });
        }
    }    
}
