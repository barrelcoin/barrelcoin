const express = require('express');
const app = express()

class Server {
    constructor(db) {
        this.db = db;
        app.set('view engine', 'pug')        
        app.get('/blocks/:page', (req, res) => {
            const PAGE_SIZE = 16;
            const page = parseInt(req.params.page) || 0;
            const min = page * PAGE_SIZE;
            const max = (page + 1) * PAGE_SIZE;
            let blocks = this.db.longest_chain.slice(1).map(hash => this.db.blocks_by_hash[hash]);
            blocks = blocks.reverse().slice(min, max);
            res.render('blocks', { blocks })
        })

        app.get('/transactions/:page', (req, res) => {
            const PAGE_SIZE = 16;
            const page = parseInt(req.params.page) || 0;
            const min = page * PAGE_SIZE;
            const max = (page + 1) * PAGE_SIZE;
            let blocks = this.db.longest_chain.slice(1).map(hash => this.db.blocks_by_hash[hash]);
            let transactions = blocks.reduce((acc, curr) => acc.concat(curr.transactions), []).reverse().slice(min, max);
            res.render('transactions', { transactions })
        })
        
        app.get('/block/:hash', (req, res) => {
            const hash = req.params.hash;
            const block = this.db.blocks_by_hash[hash];
            res.render('block', { block })
        })

        app.get('/accounts/:pub_key', (req, res) => {
            const pub_key = req.params.pub_key;
            const account = this.db.getLatestBlock().account[pub_key];
            const history = this.db.longest_chain.slice(1).map(hash => {
                const account = this.db.getBlockWithHash(hash).account[pub_key];
                return account ? account.value: 0;
            });
            const transactions = [...account.transactions].reverse().slice(0, 8);
            res.render('account', { pub_key, value: account.value, transactions, history })
        })

        app.get('/transaction/:hash', (req, res) => {
            const hash = req.params.hash;
            const txn = this.db.transactions_by_hash[hash];
            res.render('transaction', { txn })
        })

        app.get('/', (req, res) => {

            // retrieve the latest 5 blocks.
            let blocks = this.db.longest_chain.slice(1).reverse().slice(0, 5).map(hash => this.db.blocks_by_hash[hash])
            
            // retrieve the latest 5 transactions
            let transactions = blocks.reduce((acc, curr) => acc.concat(curr.transactions), []).slice(0, 5);

            // iterate through all public keys found on the longest chain.
            let public_keys = []
            for (let pub_key in blocks[0].account) {
                public_keys.push(pub_key);
            }

            // calculate the cumulative value of all accounts.
            let total_supply = public_keys.reduce((acc, curr) => acc + blocks[0].account[curr].value, 0);
            
            // sort public keys by their current account value.
            let accounts = public_keys.sort((a, b) => blocks[0].account[b].value - blocks[0].account[a].value);

            // compute information about the accounts with the top 5 values.
            accounts = accounts.slice(0, 5).map(pub_key => ({
                pub_key,
                value: blocks[0].account[pub_key].value,
                percentage: blocks[0].account[pub_key].value / total_supply * 100.0
            }));

            res.render('index', { blocks, transactions, accounts})
        })
    };

    start() {
        app.listen(8080, () => {
            console.log(`Example app listening at http://localhost:${8080}`)
        })        
    }
}


module.exports = Server;