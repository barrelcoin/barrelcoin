const { Worker } = require('worker_threads')

class Miner {

    constructor(getNextBlock, onBlockMined) {
        this.worker = null;
        this.getNextBlock = getNextBlock;
        this.onBlockMined = onBlockMined;
    }

    mineBlock() {

        const block = this.getNextBlock();

        if (this.worker) this.worker.terminate();
        this.worker = new Worker('./src/miningThread.js', { workerData: {
            block: block,
            difficulty: block.difficulty
        }});
    
        this.worker.on('message', (res) => {
            this.worker.terminate();
            this.worker = null;
            this.onBlockMined(res.block);
        });
    }
}

module.exports = Miner;