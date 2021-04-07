const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const stringify = require('json-stable-stringify');
const Identity = require('./identity')

const COINBASE_QUANTITY = 64;
const NULL_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

class BlockChain {

    constructor(dir) {

        this.dir = path.join(dir, 'blocks')
        if (!fs.existsSync(this.dir)) {
            fs.mkdirSync(this.dir, { recursive: true });
        }
        
        this.blocks_by_hash = {}
        this.handlers = {}

        let files = fs.readdirSync(this.dir);
        files.forEach((file) => {
            const block_path = path.join(this.dir, file);
            const data = fs.readFileSync(block_path, {encoding:'utf8', flag:'r'});
            if (data.length == 0) console.log(block_path);
            const block = JSON.parse(data);
            const block_string = stringify(block);
            const hash = crypto.createHash('sha256').update(block_string).digest('hex');
            this.blocks_by_hash[hash] = {block};
        })
   
        this.longest_chain = this.getLongestChain()
    }

    on(event, handler) {
        this.handlers[event] = handler
    }
    
    handleEvent(event, ...args) {
        if (event in this.handlers) {
            this.handlers[event](...args);
        }
    }
    
    getBlockHeight(hash) {
        if (hash == NULL_HASH) return 0;
        if (hash in this.blocks_by_hash) {
            const blockData = this.blocks_by_hash[hash];
            if (!blockData.height) {
                blockData.height = 1 + this.getBlockHeight(blockData.block.prev_block);
            }
            return blockData.height;
        } else {
            return NaN;
        }
    }
    
    getHistoryForBlock(hash) {
        const chain = [hash];
        while (hash != NULL_HASH) {
            hash = this.blocks_by_hash[hash].block.prev_block;
            chain.push(hash);
        } 
        return chain.reverse();
    }

    getLength() {
        return this.longest_chain.length;
    }

    accountBalances() {
        const balances = this.getAccountValues(this.getLatestHash())
        return JSON.stringify(balances);
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
            const blockData = this.blocks_by_hash[hash];
            if (!blockData.account) {
                blockData.account = this.getAccountValues(blockData.block.prev_block);
                blockData.block.transactions.forEach((transaction) => {
                    transaction.outputs.forEach(output => {
                        if (output.public_key in blockData.account) {
                            blockData.account[output.public_key] += output.value;
                        } else {
                            blockData.account[output.public_key] = output.value;
                        }
                    });
                    transaction.inputs.forEach(input => {
                        if (input.public_key in blockData.account) {
                            blockData.account[input.public_key] -= input.value;
                        } else {
                            blockData.account[input.public_key] = -input.value;
                        }
                    })
                });
            }
            return blockData.account;
        } else {
            return null;
        }
    }

    addBlock(block) {
        const block_string = stringify(block, Object.keys(block).sort());
        const hash = crypto.createHash('sha256').update(block_string).digest('hex');
        
        if (!this.isBlockValid(block)) {
            console.log('error: invalid block');
            return;
        }

        this.blocks_by_hash[hash] = {block};
        const height = this.getBlockHeight(hash);
        if (height >= this.longest_chain.length) {
            this.longest_chain = this.getHistoryForBlock(hash)
            this.handleEvent('extended');
        }

        const block_path = path.join(this.dir, `${hash}.json`);
        fs.writeFile(block_path, block_string, function (err) {
            if (err) throw err;
        });
    }

    isHash(hash) {
        if (hash == null) throw new Error();
        if (typeof hash != 'string') throw new Error();
        if (hash.length != 64) throw new Error();
        if (!hash.split('').every(c => '0123456789abcdef'.includes(c))) throw new Error();
        return true;
    }
    
    isQuantityValid(quantity) {
        if (quantity == null) throw new Error();
        if (typeof quantity != 'object') throw new Error();
        if (Object.keys(quantity).length != 2) throw new Error();

        if (!('public_key' in quantity)) throw new Error();
        if (!Identity.isPublicKey(quantity.public_key)) throw new Error();

        if (!('value' in quantity)) throw new Error();
        if (!(Number.isInteger(quantity.value))) throw new Error();

        return true;
    }

    isSignature(sig) {

        if (sig == null) throw new Error()
        if (typeof sig != 'object') throw new Error()
        if (Object.keys(sig).length != 2) throw new Error()

        if (!('public_key' in sig)) throw new Error()
        if (!Identity.isPublicKey(sig.public_key)) throw new Error()

        if (!('signature' in sig)) throw new Error()
        if (!Identity.isSignature(sig.signature)) throw new Error()

        return true;
    }

    isTransactionValid(transaction) {

        if (transaction == null) throw new Error()
        if (typeof transaction != 'object') throw new Error()
        if (Object.keys(transaction).length != 3) throw new Error()
                
        if (!('inputs' in transaction)) throw new Error()
        if (typeof transaction.inputs != 'object') throw new Error()
        if (!(transaction.inputs instanceof Array)) throw new Error()
        if (!transaction.inputs.every((quantity) => this.isQuantityValid(quantity)));

        if (!('outputs' in transaction)) throw new Error()
        if (typeof transaction.outputs != 'object') throw new Error()
        if (!(transaction.outputs instanceof Array)) throw new Error()
        if (!transaction.outputs.every((quantity) => this.isQuantityValid(quantity)));
        
        if (!('signatures' in transaction)) throw new Error()
        if (typeof transaction.signatures != 'object') throw new Error()
        if (!(transaction.signatures instanceof Array)) throw new Error()
        if (!transaction.signatures.every((sig) => this.isSignature(sig)));

        // Check that the sum of input is equal to sum out outputs.
        // Note that on every block, new currency is created in the form of the
        // coinbase transaction. Take this into account.
        const input_quantity = transaction.inputs.reduce((acc, cur) => acc += cur.value, 0);
        const output_quantity = transaction.outputs.reduce((acc, cur) => acc += cur.value, 0);
        if (input_quantity + COINBASE_QUANTITY != output_quantity) throw new Error()

        const transaction_header = stringify({
            inputs: transaction.inputs,
            outputs: transaction.outputs
        });

        const transaction_hash = crypto.createHash('sha256').update(transaction_header).digest('hex');

        // Check that all signatures are valid
        if (!transaction.signatures.every((sig) => {
            return Identity.verify(sig.public_key, sig.signature, transaction_hash)
        })) throw new Error()

        // Create a list of all accounts from which money is being withdrawn.
        const requested_signers = {};
        transaction.inputs.forEach((input) => requested_signers[input.public_key] = true);

        // Check that all withdrawn accounts have enough money in their account to
        // complete the transaction and that they signed the transaction to
        // authorize the payment.
        const actual_signers = {};
        transaction.signatures.forEach((sig) => actual_signers[sig.public_key] = true);
        if (!Object.keys(requested_signers).every(pub_key => pub_key in actual_signers)) throw new Error()

        return true;
    }

    isBlockValid(block) {

        if (block == null) throw new Error()
        if (typeof block != 'object') throw new Error();
        if (Object.keys(block).length != 5) throw new Error()

        if (!('difficulty' in block)) throw new Error();
        if (!(Number.isInteger(block.difficulty))) throw new Error();

        if (!('nonce' in block)) throw new Error();
        if (!(Number.isInteger(block.nonce))) throw new Error();

        if (!('prev_block' in block)) throw new Error();
        if (!this.isHash(block.prev_block)) throw new Error()

        if (!('timestamp' in block)) throw new Error();
        if (!(Number.isInteger(block.timestamp))) throw new Error();

        if (!('transactions' in block)) throw new Error();
        if (typeof block.transactions != 'object') throw new Error();
        if (!(block.transactions instanceof Array)) throw new Error();
        if (!block.transactions.every(transaction => this.isTransactionValid(transaction))) throw new Error();

        // Retrieve the total account values for all users at the previous block.
        // Compute the total amount spent by all transactions at current block.
        const account = this.getAccountValues(block.prev_block);
        const spent = {}
        block.transactions.forEach(transaction => transaction.inputs.forEach(input => {
            if (input.public_key in spent) {
                spent[input.public_key] += input.value;
            } else {
                spent[input.public_key] = input.value;
            }
        }))
        
        // Checks that no account spent more currency than they currently have.
        if(!Object.keys(spent).every(pub_key => spent[pub_key] <= account[pub_key] || 0)) throw new Error();

        return true;
    }

    getLatestHash() {
        return this.longest_chain[this.longest_chain.length - 1];
    }

    getBlockAtHeight(height) {
        if (height >= 0 && height < this.longest_chain.length) {
            const hash = this.longest_chain[height];
            return this.blocks_by_hash[hash].block;
        } else return null;
    }

    getBlockWithHash(hash) {
        if (hash in this.blocks_by_hash) {
            return this.blocks_by_hash[hash];
        } else return null;
    }
};

module.exports = BlockChain;