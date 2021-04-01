const { workerData, parentPort } = require('worker_threads')
const crypto = require('crypto')

const block = workerData.block;
const difficulty = workerData.difficulty;

function doesBlockSatisfyDifficulty(block, difficulty) {
    const block_string = JSON.stringify(block, Object.keys(block).sort());
    const hash = crypto.createHash('sha256').update(block_string).digest('hex');
    for (let i = 0; i < difficulty; i++) {
        if (hash[i] != '0') return false;
    }
    return true;
}

for (let i = 0; i < Number.MAX_SAFE_INTEGER; i++) {
    block.nonce = i;
    if (doesBlockSatisfyDifficulty(block, difficulty)) {
        parentPort.postMessage({ block })
    }
}
