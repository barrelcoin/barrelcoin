const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const NULL_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

class BlockChain {

    constructor(dir) {

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        this.blocks_by_hash = {}
        
        let files = fs.readdirSync(dir);
        files.forEach((file) => {
            const block_path = path.join(dir, file);
            const data = fs.readFileSync(block_path, {encoding:'utf8', flag:'r'});
            const block = JSON.parse(data);
            const block_string = JSON.stringify(block, Object.keys(block).sort());
            const hash = crypto.createHash('sha256').update(block_string).digest('hex');
            this.blocks_by_hash[hash] = {block};
        })
        
        this.longest_chain = this.getLongestChain()
        console.log(this.longest_chain)
    }

    getBlockHeight(hash) {
        if (hash == NULL_HASH) return 0;
        if (hash in this.blocks_by_hash) {
            const blockData = this.blocks_by_hash[hash];
            if (!blockData.height) {
                blockData.height = 1 + this.getBlockHeight(blockData.block.prev_block);
            }
            return blockData.height;
        } else return NaN;
    }
    
    getHistoryForBlock(hash) {
        const chain = [];
        while (hash != NULL_HASH) {
            chain.push(hash);
            hash = this.blocks_by_hash[hash].block.prev_block;
        }
        return chain;
    }

    getLongestChain() {
        let maxHeight = 0;
        let maxHeightBlock = NULL_HASH;
        
        Object.keys(this.blocks_by_hash).forEach(hash => {
            const height = this.getBlockHeight(hash);
            if (height > maxHeight) {
                maxHeight = height;
                maxHeightBlock = hash;
            }
        });

        return this.getHistoryForBlock(maxHeightBlock);
    }
    
    addBlock(block) {
        const block_string = JSON.stringify(block, Object.keys(block).sort());
        const hash = crypto.createHash('sha256').update(block_string).digest('hex');
        this.blocks_by_hash[hash] = {block};
        const height = getBlockHeight(hash);
        if (height > this.longest_chain.length()) {
            this.longest_chain = getHistoryForBlock(hash);
        }

        fs.writeFile(`${hash}.json`, block_string, function (err) {
            if (err) throw err;
            console.log(`info: saved ${hash}`);
        });
    }
    
    getBlockAtHeight(height) {
        if (height > 0 && height < this.longest_chain.length) {
            return this.longest_chain[height - 1];
        } else return null;
    }

    getBlockWithHash(hash) {
        if (hash in this.blocks_by_hash) {
            return this.blocks_by_hash[hash];
        } else return null;
    }
};

module.exports = BlockChain;