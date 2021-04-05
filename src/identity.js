const fs = require('fs')
const path = require('path')
const EC = require('elliptic').ec;

class Identity {
    constructor(dir) {

        const ec = new EC('secp256k1');
        const private_key_path = path.join(dir, 'private_key.txt');

        if (fs.existsSync(private_key_path)) {
            const pri_key_hex = fs.readFileSync(private_key_path, {encoding: 'utf8'});
            this.key = ec.keyFromPrivate(pri_key_hex);
        } else {

            this.key = ec.genKeyPair();
            let pri_key = this.key.getPrivate();
            let pri_key_hex = pri_key.toString('hex');
      
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(private_key_path, pri_key_hex);
        }
    }

    publicKey() {
        let pub_key = this.key.getPublic();
        var pub_key_hex = pub_key.x.toString('hex') + pub_key.y.toString('hex');
        return pub_key_hex;
    }

    sign(data) {
        let signature = this.key.sign(data);
        let signature_hex = signature.r.toString('hex') + signature.s.toString('hex')
        return signature_hex;
    }

    verify(data, signature_hex) {
        return this.key.verify(data, {
            r: signature_hex.slice(0, 64),
            s: signature_hex.slice(64, 128)
        });
    }
};

module.exports = Identity;