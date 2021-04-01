const { Worker } = require('worker_threads')

const runService = (workerData) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./miningThread.js', { workerData });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0)
        reject(new Error(`Worker stopped with exit code ${code}`));
    })
  })
}

const next_block = async (block) => {
    const result = await runService({
        "prev_block": "12605a76d342ad672d6b029f3c4965a6ac984b07b20d74dc73e18dca2ae73feb",
        "merkle_root": "0000000000000000000000000000000000000000000000000000000000000000",
        "timestamp": 1617210913,
        "difficulty": 0,
        "nonce": 0,
        "transactions": []
    })
    console.log(result);
}

exports