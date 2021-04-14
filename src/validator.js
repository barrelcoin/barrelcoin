const validator = new (require('jsonschema').Validator)();

const transaction_schema = {
    id: "/Transaction",
    type: "object",
    properties: {
        sender: {
            type: "string",
            pattern: "^[0-9a-f]{128}$"
        },
        recipient: {
            type: "string",
            pattern: "^[0-9a-f]{128}$"
        },
        value: {
            type: "integer",
            minimum: 0,
        },
        signature: {
            type: "string",
            pattern: "^[0-9a-f]{128}$"
        },
        nonce: {
            type: "integer",
            minimum: 0,
        }
    },
    additionalProperties: false,
    required: ['sender', 'recipient', 'value', 'nonce']
}

const block_header_schema = {
    id: "/Header",
    type: "object",
    properties: {
        prev_block: {
            type: "string",
            pattern: "^[0-9a-f]{64}$"
        },
        merkle_root: {
            type: "string",
            pattern: "^[0-9a-f]{64}$"
        },
        timestamp: {
            type: "integer",
            minimum: 0,
        },
        difficulty: {
            type: "integer",
            minimum: 0,
        },
        nonce: {
            type: "integer",
            minimum: 0,
        },
    },
    additionalProperties: false,
    minProperties: 5
}

const block_schema = {
    id: "/Block",
    type: "object",
    properties: {
        header: {"$ref": "/Header"},
        transactions: {
            type: "array",
            items: {
                $ref: "/Transaction"
            }
        },
    },
    additionalProperties: false,
    minProperties: 2
}

validator.addSchema(transaction_schema, '/Transaction');
validator.addSchema(block_header_schema, '/Header');
validator.addSchema(block_schema, '/Block');

class Validator {
    static isBlock(block) {
        return validator.validate(block, block_schema).valid;
    }
    static isHeader(header) {
        return validator.validate(header, block_header_schema).valid;
    }
    static isTransaction(txn) {
        return validator.validate(txn, transaction_schema).valid;
    }
}

module.exports = Validator;