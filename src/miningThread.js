const { workerData, parentPort } = require('worker_threads')
const crypto = require('crypto')
const stringify = require('json-stable-stringify');

const block = workerData;
const difficulty = block.header.difficulty;

/**
 * Return true if the hash starts with difficulty zeros and false otherwise.
 * 
 * For instance, the following hash satisfies difficulties 0 - 5:
 * 00000a0d38291805831ae2d1c94074376c752b83255e89fcbdb865af36f79e3d
 * 
 * @param {string} hash 
 * @param {int} difficulty 
 * @returns 
 */
function doesHashSatisfyDifficulty(hash, difficulty) {
    for (let i = 0; i < difficulty; i++) {
        if (hash[i] != '0') return false;
    }
    return true;
}

while (true) {
    block.header.timestamp = Math.floor(new Date().getTime() / 1000);
    for (let i = 0; i < 0xFFFFFFFF; i++) {
        block.header.nonce = i;
        const block_string = stringify(block.header);
        const hash = crypto.createHash('sha256').update(block_string).digest('hex');
        if (doesHashSatisfyDifficulty(hash, difficulty)) {
            parentPort.postMessage({ block, hash });
        }
    }    
}
