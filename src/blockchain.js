const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const stringify = require('json-stable-stringify');
const Identity = require('./identity')
const Validator = require('./validator');

const COINBASE_QUANTITY = 64;
const NULL_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const NULL_PUBLIC_KEY = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

class BlockChain {

    constructor(dir) {

        this.dir = path.join(dir, 'blocks')
        if (!fs.existsSync(this.dir)) {
            fs.mkdirSync(this.dir, { recursive: true });
        }

        this.blocks_by_hash = {}
        this.handlers = {}
        this.transactions_by_hash = {}
        
        let files = fs.readdirSync(this.dir);
        files.forEach((file) => {
            const block_path = path.join(this.dir, file);
            const data = fs.readFileSync(block_path, {encoding:'utf8', flag:'r'});
            if (data.length == 0) {
                fs.unlinkSync(block_path)
                return;
            }
            const block = JSON.parse(data);
            if (Validator.isBlock(block)) {
                const block_string = stringify(block);
                const header_string = stringify(block.header);
                const hash = crypto.createHash('sha256').update(header_string).digest('hex');
                block.hash = hash;
                block.size = block_string.length;
                block.string = block_string;
                
                this.blocks_by_hash[hash] = block;
                block.transactions.forEach(txn => {
                    const transaction_header = {...txn};
                    delete transaction_header.signature;
                    const transaction_header_string = stringify(transaction_header);
                    const hash = crypto.createHash('sha256').update(transaction_header_string).digest('hex');
                    txn.hash = hash;
                    txn.block = block;
                    this.transactions_by_hash[hash] = txn;
                });
            } else {
                throw Error("invalid block found");
            }
        })
   
        Object.keys(this.blocks_by_hash).forEach(hash => {
            this.getAccountValues(hash);
            this.getBlockHeight(hash);
        });
        this.longest_chain = this.getHeaviestChain()
        console.log(this.longest_chain)
    }

    on(event, handler) {
        this.handlers[event] = handler
    }
    
    handleEvent(event, ...args) {
        if (event in this.handlers) {
            this.handlers[event](...args);
        }
    }
    
    /**
     * Computes the weight of the block, where the weight is defined as the
     * expected number of hashes required to construct the block. 
     * 
     * The weight is dependent on the difficulty of the block. A block with k
     * difficulty must have a hash that starts with k zeros. The expected
     * number of hashes required to construct this block is 16^k.
     * 
     * The weight is also dependent on the previous blocks in the chain. A
     * block's weight is equal to the weight of the previous block plus it's
     * individual weight 16^k.
     * 
     * Note that under this construction, the block with the largest weight
     * is the block with the highest expected number of hashes, and thus the
     * highest expected computational power required. We consider this block
     * to be the "head" of our hash chain.
     * 
     * @param hash - the hash of the block
     * @returns the weight of the block
     */
    getBlockWeight(hash) {
        if (hash == NULL_HASH) return 0;
        if (hash in this.blocks_by_hash) {
            const block = this.blocks_by_hash[hash];
            if (!block.weight) {
                block.weight = Math.pow(16, block.header.difficulty) + this.getBlockWeight(block.header.prev_block);
            }
            return block.weight;
        } else {
            return NaN;
        }
    }

    /**
     * Compute the height of the block, where the height is defined as the
     * number of blocks removed from the NULL_HASH root node. 
     * 
     * @param hash - the hash of the block
     * @returns the height of the block
     */
    getBlockHeight(hash) {
        if (hash == NULL_HASH) return 0;
        if (hash in this.blocks_by_hash) {
            const block = this.blocks_by_hash[hash];
            if (!block.height) {
                block.height = 1 + this.getBlockHeight(block.header.prev_block);
            }
            return block.height;
        } else {
            return NaN;
        }
    }
    
    getHistoryForBlock(hash) {
        const chain = [hash];
        while (hash != NULL_HASH) {
            hash = this.blocks_by_hash[hash].header.prev_block;
            chain.push(hash);
        } 
        return chain.reverse();
    }

    getLength() {
        return this.longest_chain.length;
    }
    
    getHeaviestChain() {
        let maxWeight = 0;
        let maxWeightBlock = NULL_HASH;
        
        Object.keys(this.blocks_by_hash).forEach(hash => {
            const weight = this.getBlockWeight(hash);
            if (weight > maxWeight) {
                maxWeight = weight;
                maxWeightBlock = hash;
            }
        });

        return this.getHistoryForBlock(maxWeightBlock)
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

        return this.getHistoryForBlock(maxHeightBlock)
    }
    
    getAccountValues(hash) {

        if (hash == NULL_HASH) return {};
        if (hash in this.blocks_by_hash) {
            const block = this.blocks_by_hash[hash];
            if (!block.account) {

                // Create a new account object whose prototype is the account object
                // of the previous block. By prototyping the previous block, we form
                // a linked list where every node contains the updated values for only
                // the accounts that were affected by that block. This allows us
                // to implicitly maintain a full history of all account values at every
                // timestep.
                block.account = Object.create(this.getAccountValues(block.header.prev_block));   

                // Iterate though each transaction and create an updated account entry for
                // all modified accounts. 
                block.transactions.forEach(txn => {
                    if (txn.sender != NULL_PUBLIC_KEY) {
                        const prev_transactions = block.account[txn.sender]?.transactions || [];
                        const prev_value = block.account[txn.sender]?.value || 0;
                        block.account[txn.sender] = {
                            transactions: [...prev_transactions, txn],
                            value: prev_value - txn.value
                        }
                    }
                    if (txn.recipient != NULL_PUBLIC_KEY) {
                        const prev_transactions = block.account[txn.recipient]?.transactions || [];
                        const prev_value = block.account[txn.recipient]?.value || 0;
                        block.account[txn.recipient] = {
                            transactions: [...prev_transactions, txn],
                            value: prev_value + txn.value
                        }
                    }
                });
            }
            return block.account;
        } else {
            return null;
        }
    }

    addBlock(block) {

        if (!Validator.isBlock(block)) throw Error('invalid block');

        const block_string = stringify(block);
        const header_string = stringify(block.header);
        const hash = crypto.createHash('sha256').update(header_string).digest('hex');
        block.hash = hash;
        block.size = block_string.length;
        block.string = block_string;

        block.transactions.forEach(txn => {
            const transaction_header = {...txn};
            delete transaction_header.signature;
            const transaction_header_string = stringify(transaction_header);
            const hash = crypto.createHash('sha256').update(transaction_header_string).digest('hex');
            txn.hash = hash;
            txn.block = block;
        });

        if (!this.isBlockValid(block)) throw Error('invalid block');

        this.blocks_by_hash[hash] = block;
        block.transactions.forEach(txn => {
            this.transactions_by_hash[txn.hash] = txn;
        });

        block.height = this.getBlockHeight(hash);
        block.weight = this.getBlockWeight(hash);
        if (this.getLatestHash() == NULL_HASH || block.weight >= this.getBlockWithHash(this.getLatestHash()).weight) {
            this.longest_chain = this.getHistoryForBlock(hash)
            this.handleEvent('extended');
        }

        this.getAccountValues(block.hash);

        const block_path = path.join(this.dir, `${hash}.json`);
        fs.writeFile(block_path, block_string, function (err) {
            if (err) throw err;
        });
    }

    isBlockValid(block) {
        
        const hashes = block.transactions.map(txn => txn.hash);
        if (BlockChain.computeMerkleRoot(hashes) != block.header.merkle_root) throw new Error();

        if (!block.transactions.every((txn, i) => {
            if (txn.sender != NULL_PUBLIC_KEY) {
                if (!Identity.verify(txn.public_key, txn.signature, hashes[i])) return false;
            }
            return true;
        })) throw new Error("invalid signature");
               
        // Retrieve the total account values for all users at the previous block.
        // Compute the total amount spent by all transactions at current block.
        const spent = {}
        const account = Object.create(this.getAccountValues(block.header.prev_block));
        account[NULL_PUBLIC_KEY] = {value: COINBASE_QUANTITY};
        block.transactions .forEach(txn => {
            if (txn.sender in spent) {
                spent[txn.sender] -= txn.value;
            } else {
                spent[txn.sender] = txn.value;
            }
        })
        
        // Checks that no account spent more currency than they currently have.
        if(!Object.keys(spent).every(pub_key => spent[pub_key] <= account[pub_key].value || 0)) throw new Error();

        return true;
    }

    getLatestHash() {
        return this.longest_chain[this.longest_chain.length - 1];
    }

    getLatestBlock() {
        return this.getBlockWithHash(this.getLatestHash());
    }

    getBlockAtHeight(height) {
        if (height >= 0 && height < this.longest_chain.length) {
            const hash = this.longest_chain[height];
            return this.getBlockWithHash(hash);
        } else return null;
    }

    getBlockWithHash(hash) {
        if (hash in this.blocks_by_hash) {
            return this.blocks_by_hash[hash];
        } else return null;
    }

    static computeMerkleRoot(hashes) {
        while (hashes > 1) {
            const result = [];
            for (let i = 0; i < hashes.length; i += 2) {
                if (i + 1 == hashes.length) {
                    const hash = hashes[i]; 
                    result.push(crypto.createHash('sha256').update(hash + hash).digest('hex'));
                } else {
                    const hash1 = hashes[i]; 
                    const hash2 = hashes[i + 1]; 
                    result.push(crypto.createHash('sha256').update(hash1 + hash2).digest('hex'));
                }
            }
            hashes = result;
        }
        return hashes[0];
    }
};

module.exports = BlockChain;